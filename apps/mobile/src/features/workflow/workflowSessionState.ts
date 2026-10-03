import { useEffect, useState } from "react";
import {
  TopicWireFrameAssembler,
  applyWorkflowRunRemoved,
  applyWorkflowRunUpdated,
  conversationTopic,
  conversationTopicFrameSchema,
  type BackgroundWorkSummary,
  type CommandEnvelope,
  type ConversationDelta,
  type ConversationRow,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type GoalState,
  type PlanState,
  type QueueState,
  type SessionControl,
  type WorkflowRunsState,
} from "@zcode/shared/zcode-protocol-v4";
import {
  ensureHandshake,
  type ConversationAgentService,
  type WorkspaceTargetLite,
} from "../../lib/conversationChannel.js";
import { getV4ClientId, newCommandId } from "../../lib/v4ClientId.js";

/**
 * workflow / status / queue 三个移动端 surface 的本地数据层。
 *
 * 桌面这三个 surface 读的是会话投影 store（packages/ui/src/v4/agentConversationTransport.ts）；
 * 移动端现有 `lib/conversationChannel.ts` 只保留 rows / control / meta（queue、
 * backgroundWorks、workflowRuns、goal、plan 在快照与 state.updated 里被丢弃）。
 * 按「desktop store deps adapt locally」的规则，这里在本特性目录内维护这些键：
 * 同一条 wire 协议、同一套共享归约原语（applyWorkflowRunUpdated / applyWorkflowRunRemoved），
 * 行归约与 conversationChannel 逐字同形。
 */

export interface WorkflowSessionState {
  status: "connecting" | "ready" | "error";
  errorMessage: string | null;
  control: SessionControl | null;
  queue: QueueState | null;
  backgroundWorks: BackgroundWorkSummary[];
  workflowRuns: WorkflowRunsState | undefined;
  goal: GoalState | null;
  plan: PlanState | null;
  rows: ConversationRow[];
  /** 快照 / 最新 state.updated 的投影 revision；queue 命令的 CAS baseRevision 读它。 */
  revision: number | null;
}

export const EMPTY_WORKFLOW_SESSION_STATE: WorkflowSessionState = {
  status: "connecting",
  errorMessage: null,
  control: null,
  queue: null,
  backgroundWorks: [],
  workflowRuns: undefined,
  goal: null,
  plan: null,
  rows: [],
  revision: null,
};

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

/** 行归约：与 lib/conversationChannel.applyDeltaToRows 同形（流式 text/inputText 追加）。 */
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
      return rows;
    }
    default:
      return rows;
  }
}

/** 一帧增量 → 下一个状态。A 区键是键级整体替换（state.updated patch = Object.assign），绝不深合并。 */
function reduceWorkflowSessionState(
  state: WorkflowSessionState,
  deltas: readonly ConversationDelta[],
): WorkflowSessionState {
  let next = state;
  for (const delta of deltas) {
    switch (delta.op) {
      case "row.appended":
      case "row.upserted":
      case "row.removed":
      case "row.delta":
        next = { ...next, rows: applyDeltaToRows(next.rows, delta) };
        break;
      case "state.updated": {
        const patch = delta.patch;
        next = {
          ...next,
          ...(patch.revision !== undefined ? { revision: patch.revision } : {}),
          ...(patch.control ? { control: { ...next.control, ...patch.control } } : {}),
          ...(patch.queue ? { queue: patch.queue } : {}),
          ...(patch.backgroundWorks ? { backgroundWorks: patch.backgroundWorks } : {}),
          ...(patch.workflowRuns ? { workflowRuns: patch.workflowRuns } : {}),
          ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
          ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        };
        break;
      }
      case "workflowRun.updated":
        next = {
          ...next,
          workflowRuns: applyWorkflowRunUpdated(next.workflowRuns, delta),
        };
        break;
      case "workflowRun.removed":
        next = {
          ...next,
          workflowRuns: applyWorkflowRunRemoved(next.workflowRuns, delta),
        };
        break;
    }
  }
  return next;
}

export class WorkflowSessionChannel {
  private readonly agentService: ConversationAgentService;
  private readonly workspace: WorkspaceTargetLite;
  private readonly sessionId: string;
  private readonly onState: (state: WorkflowSessionState) => void;
  private readonly assembler = new TopicWireFrameAssembler<ConversationTopicFrame>(
    conversationTopicFrameSchema,
  );
  private detachFrames: { dispose: () => void } | null = null;
  private subscriptionId: string | null = null;
  private disposed = false;
  private state: WorkflowSessionState = EMPTY_WORKFLOW_SESSION_STATE;

  constructor(
    agentService: ConversationAgentService,
    workspace: WorkspaceTargetLite,
    sessionId: string,
    onState: (state: WorkflowSessionState) => void,
  ) {
    this.agentService = agentService;
    this.workspace = workspace;
    this.sessionId = sessionId;
    this.onState = onState;
  }

  private publish(state: WorkflowSessionState): void {
    if (this.disposed) return;
    this.state = state;
    this.onState(state);
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
      this.publish({ ...this.state, status: "ready", errorMessage: null });
    } catch (error) {
      if (this.disposed) return;
      this.publish({
        ...this.state,
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
          control: snapshot.control,
          queue: snapshot.queue,
          backgroundWorks: snapshot.backgroundWorks,
          workflowRuns: snapshot.workflowRuns,
          goal: snapshot.goal,
          plan: snapshot.plan,
          rows: [...snapshot.rows.window],
          revision: snapshot.revision,
        });
        continue;
      }
      this.publish(reduceWorkflowSessionState(this.state, frame.payload.deltas));
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

/**
 * 订阅会话并维护 workflow/status/queue 三个 surface 需要的投影键。
 * 与 `lib/useConversation` 的会话订阅并存（后者不携带这些键）；合流是后续事项，
 * 不在本特性的新文件规则内。
 */
export function useWorkflowSessionState(
  agentService: ConversationAgentService | null,
  workspace: WorkspaceTargetLite | null,
  sessionId: string | null,
): WorkflowSessionState {
  const [state, setState] = useState<WorkflowSessionState>(EMPTY_WORKFLOW_SESSION_STATE);

  useEffect(() => {
    if (!agentService || !workspace || !sessionId) {
      setState(EMPTY_WORKFLOW_SESSION_STATE);
      return;
    }
    setState(EMPTY_WORKFLOW_SESSION_STATE);
    const channel = new WorkflowSessionChannel(agentService, workspace, sessionId, setState);
    void channel.start();
    return () => {
      channel.dispose();
    };
  }, [agentService, workspace, sessionId]);

  return state;
}

async function sendCommandEnvelope(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  sessionId: string,
  type: CommandEnvelope["type"],
  payload: unknown,
  baseRevision?: number,
): Promise<void> {
  await ensureHandshake(agentService);
  const ack = await agentService.sendConversationCommandV4({
    workspacePath: workspace.workspacePath,
    envelope: {
      commandId: newCommandId(),
      clientId: getV4ClientId(),
      sessionId,
      ...(baseRevision === undefined ? {} : { baseRevision }),
      type,
      payload,
      issuedAt: Date.now(),
    },
  });
  // noop = 幂等重放（命令已生效）；与桌面对 queue 命令的裁决一致（accepted/noop 都算成功）。
  if (ack.status !== "accepted" && ack.status !== "duplicate" && ack.status !== "noop") {
    const detail = [ack.reasonCode, ack.message].filter(Boolean).join(": ");
    throw new Error(`command ${type} ${ack.status}${detail ? ` (${detail})` : ""}`);
  }
}

export interface WorkflowSessionCommands {
  /** deleteQueueItem：删除一条排队消息。 */
  deleteQueueItem: (queueItemId: string) => Promise<void>;
  /** sendQueuedNow：停当前 + 立即消费该项。 */
  sendQueuedNow: (queueItemId: string) => Promise<void>;
  /** reorderQueueItem：移到锚点前；beforeQueueItemId=null 即队尾。 */
  reorderQueueItem: (queueItemId: string, beforeQueueItemId: string | null) => Promise<void>;
  /** setAutoDrain(true)：恢复队列自动消费。 */
  resumeQueue: () => Promise<void>;
  /** editQueueItem：就地改一条排队消息的文本。 */
  editQueueItem: (queueItemId: string, newText: string) => Promise<void>;
  /** cancelBackgroundWork { workId ≡ runId }：停止后台任务 / workflow run。 */
  cancelBackgroundWork: (workId: string) => Promise<void>;
  /** resumeWorkflowRun { workId ≡ runId }：恢复被打断的 run。 */
  resumeWorkflowRun: (runId: string, name?: string) => Promise<void>;
}

/**
 * 队列 / 编辑类命令在桌面带 baseRevision（CAS）发送（SessionPane.dispatchCommand 的第四参）。
 * 移动端同样从投影 revision 取；`getBaseRevision` 缺席时不带（旧 CLI 不裁）。
 */
export function createWorkflowSessionCommands(
  agentService: ConversationAgentService,
  workspace: WorkspaceTargetLite,
  sessionId: string,
  getBaseRevision?: () => number | undefined,
): WorkflowSessionCommands {
  const send = (type: CommandEnvelope["type"], payload: unknown) =>
    sendCommandEnvelope(agentService, workspace, sessionId, type, payload, getBaseRevision?.());
  return {
    deleteQueueItem: (queueItemId) => send("deleteQueueItem", { queueItemId }),
    sendQueuedNow: (queueItemId) => send("sendQueuedNow", { queueItemId }),
    reorderQueueItem: (queueItemId, beforeQueueItemId) =>
      send("reorderQueueItem", { queueItemId, beforeQueueItemId }),
    resumeQueue: () => send("setAutoDrain", { autoDrain: true }),
    editQueueItem: (queueItemId, newText) => send("editQueueItem", { queueItemId, newText }),
    cancelBackgroundWork: (workId) => send("cancelBackgroundWork", { workId }),
    resumeWorkflowRun: (runId, name) =>
      send("resumeWorkflowRun", name === undefined ? { workId: runId } : { workId: runId, name }),
  };
}
