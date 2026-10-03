import type {
  BackgroundWorkSummary,
  GoalState,
  PlanState,
  QueueState,
  RunningSubagentSummary,
  SessionControl,
  WorkflowRunState,
} from "@zcode/shared/zcode-protocol-v4";
import { workflowRunStepCounts } from "@zcode/shared/zcode-protocol-v4";
import type { MobileWorkflowNotification } from "./workflowDigestsModel.js";

/**
 * 一眼状态面板的模型层：桌面版是 packages/ui/src/v4/conversationStatusPanelModel.ts
 * （+ 2086 行的 ConversationStatusPanel 分区渲染）。移动端只有一个 glance，所以这里把
 * 「收起态摘要的优先级链」与「Workflows 分区的 workId ≡ runId 联接」保留，分区折叠 /
 * mini 胶囊 / Git 区 / 宽度自适应等桌面壳全部不搬。
 *
 * 保留的桌面不变量：
 * - Workflows 行字段分三簇（status/步数来自投影；title/startedAt 来自后台任务；workId/cancellable
 *   只在 work 仍 running 时给），**缺席用字段不存在表达，不用假 0**；
 * - 联接用 workId ≡ runId 主键直配；work 有、run 无（旧 CLI）时降级成只有题名/时长/Stop 的行，
 *   **追加在 run 支撑的行之后**（它没有启动序上的位置）；
 * - 不排序：顺序 = 投影 runs 序 = 启动序。
 */

/** Workflows 分区的一行（桌面 ConversationStatusPanelWorkflowRun 的同形移植）。 */
export interface MobileWorkflowRunRow {
  runId: string;
  toolCallId?: string;
  status?: "pending" | "running";
  nodesSettled?: number;
  nodesTotal?: number;
  /** `title ≡ runId` 即「未命名」，渲染层换兜底名（core 的 workflowTaskSubject 兜底样子）。 */
  title?: string;
  startedAt?: number;
  workId?: string;
  cancellable?: boolean;
}

export type MobileStatusGlance = "attention" | "running" | "done" | "idle";

export interface MobileStatusAttentionItem {
  kind: "question" | "workflowError" | "failedWork" | "stalledRun" | "queuePaused" | "sessionError";
  label: string;
  detail?: string;
  runId?: string;
}

export interface MobileStatusDoneItem {
  kind: "workflow" | "work";
  label: string;
  /** 终态词：Completed / Stopped · by you / …。 */
  outcome: string;
  errored: boolean;
}

export interface MobileStatusModel {
  glance: MobileStatusGlance;
  runningWorkflows: MobileWorkflowRunRow[];
  runningBashCount: number;
  runningSubagents: RunningSubagentSummary[];
  attention: MobileStatusAttentionItem[];
  done: MobileStatusDoneItem[];
  queuePaused: boolean;
  hasContent: boolean;
}

/** run 整体状态灯（桌面 run-status-presentation.ts RUN_STATUS_DOT 的移动端 token 版）。 */
export const RUN_STATUS_DOT: Record<WorkflowRunState["status"], string> = {
  pending: "border-[1.5px] border-foreground-subtlest bg-transparent",
  running: "animate-pulse bg-warning motion-reduce:animate-none",
  completed: "bg-success",
  errored: "bg-destructive ring-2 ring-destructive/30",
  stopped: "border-[1.5px] border-foreground-subtlest bg-transparent",
};

/** 状态词语义色：状态永远有词，绝不只靠颜色（桌面同一判据）。 */
export const RUN_STATUS_TEXT: Record<WorkflowRunState["status"], string> = {
  pending: "text-foreground-subtle",
  running: "text-warning",
  completed: "text-success",
  errored: "text-destructive",
  stopped: "text-foreground-subtle",
};

export const RUN_STATUS_LABEL: Record<WorkflowRunState["status"], string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  errored: "Errored",
  stopped: "Stopped",
};

/** `stopped` 的原因词（与桌面 en-US 文案逐字同源）。 */
export const STOP_REASON_LABEL: Record<NonNullable<WorkflowRunState["stopReason"]>, string> = {
  user: "by you",
  model: "by the agent",
  provider: "model error",
  interrupted: "process exited",
  superseded: "superseded",
};

export function workflowRunStatusLabel(run: Pick<WorkflowRunState, "status" | "stopReason">): string {
  const label = RUN_STATUS_LABEL[run.status];
  if (run.status !== "stopped" || run.stopReason === undefined) return label;
  return `${label} · ${STOP_REASON_LABEL[run.stopReason]}`;
}

/**
 * Workflows 活动行：run 与 workflow 后台任务按 workId ≡ runId 联接。
 * 桌面 buildRunningWorkflowRuns 的同形移植（分簇缺席规则见文件头）。
 */
function buildRunningWorkflowRows(
  runs: readonly WorkflowRunState[],
  workflowWorkByWorkId: ReadonlyMap<string, BackgroundWorkSummary>,
): MobileWorkflowRunRow[] {
  const rows: MobileWorkflowRunRow[] = [];
  const joinedWorkIds = new Set<string>();
  for (const run of runs) {
    // pending 也是活动态：run 已起跑、只是还没派发第一个节点，藏起来就是一段空窗。
    if (run.status !== "pending" && run.status !== "running") continue;
    const work = workflowWorkByWorkId.get(run.runId);
    if (work) joinedWorkIds.add(run.runId);
    const steps = workflowRunStepCounts(run);
    rows.push({
      runId: run.runId,
      ...(run.toolCallId ? { toolCallId: run.toolCallId } : {}),
      status: run.status,
      nodesSettled: steps.settled,
      nodesTotal: steps.total,
      ...(work ? { title: work.title, startedAt: work.startedAt } : {}),
      ...(work?.status === "running"
        ? {
            workId: work.workId,
            // 缺省即可停，与桌面同款 `!== false`：能停而不给按钮比反过来更糟。
            cancellable: work.cancellable !== false,
          }
        : {}),
    });
  }
  // work 有、run 无 = 旧 CLI：降级成只有题名/时长/Stop 的行，追加在 run 支撑的行之后。
  for (const [workId, work] of workflowWorkByWorkId) {
    if (joinedWorkIds.has(workId) || work.status !== "running") continue;
    rows.push({
      runId: workId,
      workId,
      title: work.title,
      startedAt: work.startedAt,
      cancellable: work.cancellable !== false,
    });
  }
  return rows;
}

const FALLBACK_WORKFLOW_NAME = "Workflow script";

/** 「题名恰好等于 id」是唯一可靠的未命名信号（协议注释写明的偏斜形态）。 */
export function workflowRowDisplayName(row: MobileWorkflowRunRow): string {
  return row.title && row.title !== row.runId ? row.title : FALLBACK_WORKFLOW_NAME;
}

/**
 * 行 → 「打开哪个 run 的详情」的意图（桌面 conversationStatusPanelModel.workflowRunOpenTarget
 * 的同形移植）。无 toolCallId 即 null（没有可开的详情）。
 */
export function workflowRunOpenIntent(
  row: MobileWorkflowRunRow,
): { runId: string; toolCallId: string; workflowName?: string } | null {
  if (!row.toolCallId) return null;
  return {
    runId: row.runId,
    toolCallId: row.toolCallId,
    ...(row.title && row.title !== row.runId ? { workflowName: row.title } : {}),
  };
}

export interface MobileStatusModelInput {
  control: SessionControl | null;
  queue: QueueState | null;
  backgroundWorks: readonly BackgroundWorkSummary[];
  workflowRuns: readonly WorkflowRunState[];
  goal: GoalState | null;
  plan: PlanState | null;
  /** 通知解析结果（升级行 waiting / stall 行来源）；缺席时只按 run 投影判 attention。 */
  notifications?: readonly MobileWorkflowNotification[];
}

export function buildMobileStatusModel(input: MobileStatusModelInput): MobileStatusModel {
  const runningBash: BackgroundWorkSummary[] = [];
  const runningSubagents: RunningSubagentSummary[] = [];
  const workflowWorkByWorkId = new Map<string, BackgroundWorkSummary>();
  const failedWorks: BackgroundWorkSummary[] = [];
  const deliveringWorks: BackgroundWorkSummary[] = [];
  for (const work of input.backgroundWorks) {
    if (work.kind === "workflow") {
      // 只按 workId ≡ runId 进 workflow 联接表；留在 bash 列表就是同一个 run 出现两次。
      workflowWorkByWorkId.set(work.workId, work);
      if (work.status === "failed") failedWorks.push(work);
      if (work.status === "resultPending") deliveringWorks.push(work);
      continue;
    }
    if (work.status === "failed") {
      failedWorks.push(work);
      continue;
    }
    if (work.status !== "running") continue;
    if (work.kind === "bash") {
      runningBash.push(work);
    } else if (work.kind === "subagent" && work.childSessionId) {
      runningSubagents.push({
        childSessionId: work.childSessionId,
        subagentType: "subagent",
        title: work.title,
        status: work.blocked ? "blocked" : "running",
        startedAt: work.startedAt,
      });
    }
  }

  const runningWorkflows = buildRunningWorkflowRows(
    input.workflowRuns,
    workflowWorkByWorkId,
  );

  // ── needs attention ──
  const attention: MobileStatusAttentionItem[] = [];
  for (const run of input.workflowRuns) {
    const questionCount = run.pendingQuestions?.length ?? 0;
    if (questionCount > 0) {
      attention.push({
        kind: "question",
        label: `${questionCount === 1 ? "1 question" : `${questionCount} questions`} waiting for you`,
        runId: run.runId,
      });
    }
    if (run.status === "errored") {
      attention.push({
        kind: "workflowError",
        label: "Workflow errored",
        ...(run.error ? { detail: run.error } : {}),
        runId: run.runId,
      });
    }
  }
  for (const notification of input.notifications ?? []) {
    // stall：run 还在跑，只是长时间没有一次成功的模型请求。
    if (notification.meta.kind !== "stall") continue;
    if (!runningWorkflows.some((row) => row.runId === notification.runId)) continue;
    const minutes = Math.max(1, Math.round(notification.meta.sinceMs / 60_000));
    attention.push({
      kind: "stalledRun",
      label: `Workflow stalled for ${minutes} min`,
      ...(notification.meta.reason ? { detail: notification.meta.reason } : {}),
      runId: notification.runId,
    });
  }
  for (const work of failedWorks) {
    attention.push({ kind: "failedWork", label: `Background task failed: ${work.title}` });
  }
  const queuePaused = input.queue !== null && !input.queue.autoDrain && input.queue.items.length > 0;
  if (queuePaused) {
    attention.push({ kind: "queuePaused", label: "Queue is paused" });
  }
  if (input.control?.lastError) {
    attention.push({
      kind: "sessionError",
      label: "Session error",
      detail: input.control.lastError.message,
    });
  }

  // ── done（终态 run + 已完成待投递的后台任务）──
  const done: MobileStatusDoneItem[] = [];
  for (const run of input.workflowRuns) {
    if (run.status === "pending" || run.status === "running") continue;
    // errored 已在 attention 里点名，done 不重复计数（一眼面板每个事实只有一个位置）。
    if (run.status === "errored") continue;
    const work = workflowWorkByWorkId.get(run.runId);
    const displayName =
      work?.title && work.title !== run.runId ? work.title : FALLBACK_WORKFLOW_NAME;
    done.push({
      kind: "workflow",
      label: displayName,
      outcome: workflowRunStatusLabel(run),
      errored: false,
    });
  }
  for (const work of deliveringWorks) {
    done.push({ kind: "work", label: work.title, outcome: "Delivering result", errored: false });
  }

  const runningCount = runningBash.length + runningSubagents.length + runningWorkflows.length;
  const hasContent =
    input.control !== null ||
    input.queue !== null ||
    input.backgroundWorks.length > 0 ||
    input.workflowRuns.length > 0 ||
    input.goal !== null ||
    input.plan !== null;

  const glance: MobileStatusGlance =
    attention.length > 0 ? "attention" : runningCount > 0 ? "running" : done.length > 0 ? "done" : "idle";

  return {
    glance,
    runningWorkflows,
    runningBashCount: runningBash.length,
    runningSubagents,
    attention,
    done,
    queuePaused,
    hasContent,
  };
}

/** 相对时长（收起态摘要与行内用时同源读法）：`42s` / `5m 12s` / `1h 3m`。 */
export function formatElapsedLabel(totalMs: number): string {
  const seconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest}s`);
  return parts.join(" ");
}
