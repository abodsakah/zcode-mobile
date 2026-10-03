/**
 * Turn-group builder for the mobile conversation timeline.
 *
 * The desktop groups rows via `buildConversationTurnRenderUnits`
 * (packages/ui/src/v4/conversationTurnRenderUnits.js) and the render-item
 * projection in `conversationAssistantWorkItems.js`, neither of which is
 * exported from @zcode/ui. This module re-implements the grouping the mobile
 * view needs, locally, over the same ConversationRow[] wire projection:
 *
 * - rows are grouped into product turns (`productTurnId ?? turnId`), in rowId
 *   order — "turn 是 row 上的标签不是容器" (packages/shared/src/zcode-protocol-v4/rows.ts:3);
 * - timeline markers land by lane with the legacy snapshot fallback the
 *   protocol prescribes (rows.ts:395-408: assistantWork / turnTailBoundary /
 *   lightBoundary, missing lane falls back by marker type);
 * - agent tool-call rows pair with their SubagentRow via
 *   `parentToolCallId` (same join ConversationAgentToolCallRow.tsx:46-48 consumes);
 * - background-result turns resolve their title with the same source
 *   whitelist as ConversationTurnGroup.tsx:912-926;
 * - work items split into history (before the latest assistant text) and
 *   following (after it), mirroring ConversationTurnGroup.tsx:1065-1095.
 */

import type {
  ArtifactRow,
  AssistantTextRow,
  ConversationRow,
  HookInvocationRow,
  ReasoningRow,
  SubagentRow,
  TimelineMarkerRow,
  ToolCallRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";

export type TurnWorkItem =
  | { kind: "reasoning"; row: ReasoningRow }
  | { kind: "toolCall"; row: ToolCallRow; subagent: SubagentRow | null }
  | { kind: "subagent"; row: SubagentRow }
  | { kind: "artifact"; row: ArtifactRow }
  | { kind: "hookInvocation"; row: HookInvocationRow }
  | { kind: "marker"; row: TimelineMarkerRow };

export interface TurnWorkStatus {
  state: TurnHeaderRow["state"];
  /** 权威工时（activeMs）；缺省回落到 endedAt - startedAt。 */
  durationMs: number | null;
}

export interface TurnGroup {
  key: string;
  turnId: string;
  header: TurnHeaderRow | null;
  /** 轮顶轻边界（modelChange 等），渲染在 user 输入之前。 */
  leadingMarkers: TimelineMarkerRow[];
  userInputs: UserInputRow[];
  /** 最新 assistant 正文之前的工作行。 */
  history: TurnWorkItem[];
  assistantTexts: AssistantTextRow[];
  /** 最新 assistant 正文之后的工作行。 */
  following: TurnWorkItem[];
  /** 轮尾边界（goalVerify / forkNotice），留轮结尾不折叠。 */
  tailMarkers: TimelineMarkerRow[];
  isRunning: boolean;
  isLast: boolean;
  backgroundResultTitle: string | null;
  workStatus: TurnWorkStatus | null;
}

/** ConversationTurnGroup.tsx:912-916 — 后台结果头渲染白名单。 */
const BACKGROUND_RESULT_TITLE_SOURCES: ReadonlySet<string> = new Set(["bash", "subagent", "workflow"]);

export function isRowRunning(row: ConversationRow): boolean {
  switch (row.kind) {
    case "assistantText":
    case "reasoning":
      return row.state === "streaming";
    case "toolCall":
      return (
        row.status === "running" ||
        row.status === "inputStreaming" ||
        row.status === "pendingApproval"
      );
    case "subagent":
      return row.status === "running";
    case "hookInvocation":
      return row.state === "running";
    case "turnHeader":
      return row.state === "running";
    default:
      return false;
  }
}

/**
 * lane 缺省（老 snapshot）时按 marker type 回落映射，口径即 rows.ts:395-408 注释：
 * compact → assistantWork；goalVerify / forkNotice → turnTailBoundary；
 * 其余（modelChange / forkCreated / checkpointRestored）→ lightBoundary。
 */
function resolveMarkerLane(
  row: TimelineMarkerRow,
): "assistantWork" | "turnTailBoundary" | "lightBoundary" {
  if (row.lane) return row.lane;
  switch (row.marker.type) {
    case "compact":
      return "assistantWork";
    case "goalVerify":
    case "forkNotice":
      return "turnTailBoundary";
    default:
      return "lightBoundary";
  }
}

function resolveBackgroundResultTitle(header: TurnHeaderRow | null): string | null {
  if (header?.origin !== "backgroundResult") return null;
  const originMeta = header.originMeta;
  if (!originMeta?.workId.trim() || !originMeta.title.trim()) return null;
  if (!BACKGROUND_RESULT_TITLE_SOURCES.has(originMeta.backgroundSource)) return null;
  return originMeta.title.trim();
}

function resolveWorkStatus(header: TurnHeaderRow | null): TurnWorkStatus | null {
  if (!header) return null;
  let durationMs: number | null = null;
  if (typeof header.activeMs === "number") {
    durationMs = header.activeMs;
  } else if (typeof header.endedAt === "number" && typeof header.startedAt === "number") {
    durationMs = Math.max(0, header.endedAt - header.startedAt);
  }
  return { state: header.state, durationMs };
}

/** 运行中的轮不展示权威终态工时；用 nowMs 推导 live 时长（对齐 running work duration tick）。 */
export function resolveTurnDurationLabel(group: TurnGroup, nowMs: number): string | null {
  if (group.isRunning && group.header) {
    const startedAt = group.header.startedAt;
    if (typeof startedAt === "number") {
      return formatWorkDurationLabel(Math.max(0, nowMs - startedAt));
    }
    return null;
  }
  const durationMs = group.workStatus?.durationMs;
  return typeof durationMs === "number" ? formatWorkDurationLabel(durationMs) : null;
}

function formatWorkDurationLabel(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function pushWorkItem(work: TurnWorkItem[], row: ConversationRow): void {
  switch (row.kind) {
    case "reasoning":
      work.push({ kind: "reasoning", row });
      return;
    case "toolCall":
      work.push({ kind: "toolCall", row, subagent: null });
      return;
    case "subagent":
      work.push({ kind: "subagent", row });
      return;
    case "artifact":
      work.push({ kind: "artifact", row });
      return;
    case "hookInvocation":
      work.push({ kind: "hookInvocation", row });
      return;
    default:
      return;
  }
}

function finalizeGroup(accumulator: TurnGroupAccumulator, isLast: boolean): TurnGroup {
  // 历史/正文/后续切分：以最后一条 assistantText 为界（对齐 ConversationTurnGroup
  // 的 history / latest text / following 三段结构，ConversationTurnGroup.tsx:1065-1095）。
  const lastAssistantTextRowId = accumulator.assistantTexts.reduce(
    (latest, row) => Math.max(latest, row.rowId),
    -1,
  );
  const hasAssistantText = lastAssistantTextRowId >= 0;
  const history: TurnWorkItem[] = [];
  const following: TurnWorkItem[] = [];
  for (const item of accumulator.work) {
    if (hasAssistantText && item.row.rowId > lastAssistantTextRowId) {
      following.push(item);
    } else {
      history.push(item);
    }
  }
  const isRunning =
    accumulator.header?.state === "running" ||
    accumulator.work.some((item) => isRowRunning(item.row)) ||
    accumulator.assistantTexts.some((row) => row.state === "streaming");
  return {
    key: accumulator.key,
    turnId: accumulator.turnId,
    header: accumulator.header,
    leadingMarkers: accumulator.leadingMarkers,
    userInputs: accumulator.userInputs,
    history,
    assistantTexts: accumulator.assistantTexts,
    following,
    tailMarkers: accumulator.tailMarkers,
    isRunning,
    isLast,
    backgroundResultTitle: resolveBackgroundResultTitle(accumulator.header),
    workStatus: resolveWorkStatus(accumulator.header),
  };
}

interface TurnGroupAccumulator {
  key: string;
  turnId: string;
  header: TurnHeaderRow | null;
  leadingMarkers: TimelineMarkerRow[];
  userInputs: UserInputRow[];
  work: TurnWorkItem[];
  assistantTexts: AssistantTextRow[];
  tailMarkers: TimelineMarkerRow[];
}

/**
 * rows 已是 CLI 投影后的全序（mobile ConversationChannel 已按 rowId 归并排序）。
 * 分组键 = productTurnId ?? turnId；无任何键的行进「无轮」桶（不应出现，兜底不丢行）。
 */
export function buildTurnGroups(rows: readonly ConversationRow[]): TurnGroup[] {
  const accumulators: TurnGroupAccumulator[] = [];
  const byKey = new Map<string, TurnGroupAccumulator>();
  const unkeyed: TurnGroupAccumulator = {
    key: "unkeyed",
    turnId: "unkeyed",
    header: null,
    leadingMarkers: [],
    userInputs: [],
    work: [],
    assistantTexts: [],
    tailMarkers: [],
  };

  for (const row of rows) {
    const key = row.productTurnId ?? row.turnId;
    let accumulator = key ? byKey.get(key) : undefined;
    if (!accumulator && key) {
      accumulator = {
        key,
        turnId: row.turnId,
        header: null,
        leadingMarkers: [],
        userInputs: [],
        work: [],
        assistantTexts: [],
        tailMarkers: [],
      };
      byKey.set(key, accumulator);
      accumulators.push(accumulator);
    }
    const target = accumulator ?? unkeyed;

    switch (row.kind) {
      case "turnHeader":
        target.header = row;
        break;
      case "userInput":
        target.userInputs.push(row);
        break;
      case "assistantText":
        target.assistantTexts.push(row);
        break;
      case "timelineMarker": {
        const lane = resolveMarkerLane(row);
        if (lane === "lightBoundary") target.leadingMarkers.push(row);
        else if (lane === "turnTailBoundary") target.tailMarkers.push(row);
        else target.work.push({ kind: "marker", row });
        break;
      }
      default:
        pushWorkItem(target.work, row);
        break;
    }
  }

  // 子代理配对：同一轮内 parentToolCallId 命中 toolCall → 挂到该工具行；
  // 独立 spawn 行（无父工具行可见）保持原位。一次建表、一次重组，不打乱 rowId 顺序。
  for (const accumulator of accumulators) {
    const toolCallIds = new Set(
      accumulator.work.flatMap((item) => (item.kind === "toolCall" ? [item.row.toolCallId] : [])),
    );
    const subagentsByParent = new Map<string, SubagentRow>();
    for (const item of accumulator.work) {
      if (item.kind !== "subagent") continue;
      const parentId = item.row.parentToolCallId;
      if (parentId && toolCallIds.has(parentId)) {
        subagentsByParent.set(parentId, item.row);
      }
    }
    if (subagentsByParent.size === 0) continue;
    accumulator.work = accumulator.work.flatMap((item): TurnWorkItem[] => {
      if (item.kind === "subagent") {
        const parentId = item.row.parentToolCallId;
        if (parentId && subagentsByParent.has(parentId)) return [];
      }
      if (item.kind === "toolCall") {
        return [
          { ...item, subagent: subagentsByParent.get(item.row.toolCallId) ?? item.subagent },
        ];
      }
      return [item];
    });
  }

  return accumulators.map((accumulator, index) =>
    finalizeGroup(accumulator, index === accumulators.length - 1),
  );
}
