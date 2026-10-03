import type { IDisposable } from "@zcode/rpc";
import type { IZCodeAgentService } from "@zcode/services";
import {
  TopicWireFrameAssembler,
  V4_WIRE_PROTOCOL_VERSION,
  conversationTopic,
  conversationTopicFrameSchema,
  helloMessageSchema,
  hostSupportsWorkflowRunDeltas,
  type ClientHello,
  type CommandAck,
  type CommandEnvelope,
  type ConversationDelta,
  type ConversationRow,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type HelloMessage,
  type SessionControl,
  type SessionMetaState,
} from "@zcode/shared/zcode-protocol-v4";
import { getV4ClientId, newCommandId } from "./v4ClientId.js";

/**
 * v4 conversation 通道的移动端精简实现（与桌面 packages/ui/src/v4/agentConversationTransport.ts
 * 同一 wire 协议）：hello/clientHello 握手 → subscribeConversationV4 →
 * onDynamicConversationFrame 帧流（TopicWireFrameAssembler 重组分片）→
 * 行快照 + 七种增量 op 归约 → sendConversationCommandV4 发送。
 */

export type ConversationChannelStatus = "connecting" | "ready" | "error";

export interface ConversationViewState {
  status: ConversationChannelStatus;
  errorMessage: string | null;
  rows: ConversationRow[];
  control: SessionControl | null;
  meta: SessionMetaState | null;
  /** 服务器全序行数（快照 window 可能只含尾部）。 */
  totalCount: number;
}

export interface WorkspaceTargetLite {
  workspacePath: string;
}

export type ConversationAgentService = Pick<
  IZCodeAgentService,
  | "subscribeConversationV4"
  | "unsubscribeConversationV4"
  | "sendConversationCommandV4"
  | "helloConversationV4"
  | "initializeConversationV4"
  | "onDynamicConversationFrame"
>;

// hello/clientHello 每条 RPC attachment 只做一次（与桌面 agentV4ConnectionHandshake.ts 一致）。
const handshakes = new WeakMap<ConversationAgentService, Promise<HelloMessage>>();

export function ensureHandshake(agentService: ConversationAgentService): Promise<HelloMessage> {
  const existing = handshakes.get(agentService);
  if (existing) return existing;
  const handshake = (async () => {
    const hello = helloMessageSchema.parse(await agentService.helloConversationV4());
    // workflowRunDeltas 声明是单向的：Host hello 先宣告，客户端才能回声明
    // （clientHello capabilities 是 strict 的，老 Host 见到陌生键会握手失败）。
    const capabilities: NonNullable<ClientHello["capabilities"]> = {
      workspaceHookReviewUi: true,
      ...(hostSupportsWorkflowRunDeltas(hello.capabilities) ? { workflowRunDeltas: true } : {}),
    };
    await agentService.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: getV4ClientId(),
      clientKind: "mobileApp",
      appVersion: "unknown",
      capabilities,
    });
    return hello;
  })();
  handshakes.set(agentService, handshake);
  void handshake.catch(() => {
    if (handshakes.get(agentService) === handshake) handshakes.delete(agentService);
  });
  return handshake;
}

function insertRowSorted(rows: ConversationRow[], row: ConversationRow): ConversationRow[] {
  const next = rows.filter((existing) => existing.rowId !== row.rowId);
  const index = next.findIndex((existing) => existing.rowId > row.rowId);
  if (index < 0) {
    next.push(row);
  } else {
    next.splice(index, 0, row);
  }
  return next;
}

/** 七种增量 op 的行归约（workflowRun.* 只作用于 run 表，mobile v1 不渲染，安全忽略）。 */
function applyDeltaToRows(rows: ConversationRow[], delta: ConversationDelta): ConversationRow[] {
  switch (delta.op) {
    case "row.appended":
    case "row.upserted":
      return insertRowSorted(rows, delta.row);
    case "row.removed":
      return rows.filter((row) => row.rowId < delta.fromRowId);
    case "row.delta": {
      const target = rows.find((row) => row.rowId === delta.rowId);
      if (!target) return rows;
      if (delta.path === "text" && (target.kind === "assistantText" || target.kind === "reasoning")) {
        return insertRowSorted(rows, { ...target, text: target.text + delta.append });
      }
      if (delta.path === "inputText" && target.kind === "toolCall") {
        return insertRowSorted(rows, { ...target, inputText: target.inputText + delta.append });
      }
      // output.text / summaryText 的流式载体 mobile v1 不渲染，丢弃增量不影响行完整性。
      return rows;
    }
    default:
      return rows;
  }
}

export interface ConversationChannelCallbacks {
  onState: (state: ConversationViewState) => void;
}

export class ConversationChannel {
  private readonly agentService: ConversationAgentService;
  private readonly workspace: WorkspaceTargetLite;
  private readonly sessionId: string;
  private readonly callbacks: ConversationChannelCallbacks;
  private readonly assembler = new TopicWireFrameAssembler<ConversationTopicFrame>(
    conversationTopicFrameSchema,
  );
  private detachFrames: IDisposable | null = null;
  private subscriptionId: string | null = null;
  private disposed = false;
  private state: ConversationViewState = {
    status: "connecting",
    errorMessage: null,
    rows: [],
    control: null,
    meta: null,
    totalCount: 0,
  };

  constructor(
    agentService: ConversationAgentService,
    workspace: WorkspaceTargetLite,
    sessionId: string,
    callbacks: ConversationChannelCallbacks,
  ) {
    this.agentService = agentService;
    this.workspace = workspace;
    this.sessionId = sessionId;
    this.callbacks = callbacks;
  }

  private publish(partial: Partial<ConversationViewState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    this.callbacks.onState(this.state);
  }

  async start(): Promise<void> {
    const topic = conversationTopic(this.sessionId);
    this.detachFrames = this.agentService.onDynamicConversationFrame(this.workspace)((candidate) => {
      this.acceptWireCandidate(topic, candidate);
    });
    try {
      await ensureHandshake(this.agentService);
      const result = await this.agentService.subscribeConversationV4({
        workspacePath: this.workspace.workspacePath,
        sessionId: this.sessionId,
        visibility: "foreground",
      });
      if (this.disposed) return;
      this.subscriptionId = result.ack.subscriptionId;
      this.publish({ status: "ready", errorMessage: null });
    } catch (error) {
      if (this.disposed) return;
      this.publish({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private acceptWireCandidate(topic: string, candidate: ConversationTopicWireCandidate): void {
    if (this.disposed || candidate.topic !== topic) return;
    for (const event of this.assembler.accept(candidate)) {
      if (event.kind !== "complete") continue;
      const frame = event.frame;
      if (frame.topic !== topic) continue;
      if (frame.payload.kind === "snapshot") {
        const snapshot = frame.payload.snapshot;
        this.publish({
          status: "ready",
          errorMessage: null,
          rows: [...snapshot.rows.window],
          control: snapshot.control,
          meta: snapshot.meta,
          totalCount: snapshot.rows.totalCount,
        });
        continue;
      }
      let rows = this.state.rows;
      let control = this.state.control;
      let meta = this.state.meta;
      for (const delta of frame.payload.deltas) {
        rows = applyDeltaToRows(rows, delta);
        if (delta.op === "state.updated") {
          if (delta.patch.control) {
            control = { ...(control as SessionControl), ...delta.patch.control };
          }
          if (delta.patch.meta) {
            meta = { ...(meta as SessionMetaState), ...delta.patch.meta };
          }
        }
      }
      this.publish({ rows, control, meta });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachFrames?.dispose();
    this.detachFrames = null;
    const subscriptionId = this.subscriptionId;
    if (subscriptionId) {
      void this.agentService
        .unsubscribeConversationV4({
          workspacePath: this.workspace.workspacePath,
          subscriptionId,
        })
        .catch(() => {
          // 断线/会话已关闭时的退订失败无需处理
        });
    }
  }
}

async function sendCommand(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  envelope: CommandEnvelope,
): Promise<CommandAck> {
  const ack = await agentService.sendConversationCommandV4({
    workspacePath: workspace.workspacePath,
    envelope,
  });
  if (ack.status !== "accepted" && ack.status !== "duplicate") {
    const detail = [ack.reasonCode, ack.message].filter(Boolean).join(": ");
    throw new Error(`command ${envelope.type} ${ack.status}${detail ? ` (${detail})` : ""}`);
  }
  return ack;
}

/** sendText：已存在会话的普通文本输入（admission 由 CLI 裁决：startNow/queue/guide）。 */
export async function sendTextCommand(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  sessionId: string,
  text: string,
): Promise<void> {
  // v4 连接级握手：每条 attachment 只做一次，任何 v4 方法都必须在 hello/clientHello 之后。
  await ensureHandshake(agentService);
  await sendCommand(agentService, workspace, {
    commandId: newCommandId(),
    clientId: getV4ClientId(),
    sessionId,
    type: "sendText",
    payload: { text },
    issuedAt: Date.now(),
  });
}

/** stop：中断当前 turn（composer 在 control.canStop 时把发送键换成 Stop）。 */
export async function sendStopCommand(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  sessionId: string,
): Promise<void> {
  await ensureHandshake(agentService);
  await sendCommand(agentService, workspace, {
    commandId: newCommandId(),
    clientId: getV4ClientId(),
    sessionId,
    type: "stop",
    payload: {},
    issuedAt: Date.now(),
  });
}

/** createSession + firstInput：mobile 的「新聊天首条消息即建会话」路径。 */
export async function sendCreateSessionCommand(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  text: string,
): Promise<string> {
  // v4 连接级握手：draft 发送可能早于任何订阅发生。
  await ensureHandshake(agentService);
  const ack = await sendCommand(agentService, workspace, {
    commandId: newCommandId(),
    clientId: getV4ClientId(),
    sessionId: null,
    type: "createSession",
    payload: {
      workspaceId: workspace.workspacePath,
      firstInput: { text },
    },
    issuedAt: Date.now(),
  });
  if (ack.result?.type !== "createSession") {
    throw new Error(`createSession ack missing result (status=${ack.status})`);
  }
  return ack.result.sessionId;
}
