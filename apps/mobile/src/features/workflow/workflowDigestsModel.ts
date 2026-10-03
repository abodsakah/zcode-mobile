import type {
  ConversationRow,
  QueueItem,
  QueueState,
  TurnHeaderRow,
  WorkflowNotificationMeta,
  WorkflowRunState,
  WorkflowSettingsAmendMeta,
  WorkflowLaunchMeta,
  WorkflowRunArtifactSummary,
} from "@zcode/shared/zcode-protocol-v4";
import { workflowRunStepCounts } from "@zcode/shared/zcode-protocol-v4";

/**
 * 轮尾 run 卡与后台通知的解析：桌面版住在 packages/ui/src/v4/workflowTurnDigests.ts +
 * workflowRunCardJoin.ts（依赖 turn-flow 单元与宿主注入的联接表）；移动端把同一套规则
 * 收成两个纯函数，直接吃 `ConversationRow[]` + `WorkflowRunState[]`：
 *
 * - 凡点名了 runId 的来源都出一张卡（直接启动轮 workflowLaunch / CreateWorkflow 行按
 *   run.toolCallId 联接 / Resume 行按 display.runId），同一 run 只出首见来源；
 * - 「就地生效的设置轮」（amend 无 predecessorRunId）只出设置行、不出卡（rowOnly）；
 * - 通知行 = turnHeader（origin=backgroundResult，originMeta.backgroundSource="workflow"）
 *   上的 workflowNotification 载荷；升级行的等待/已答状态按 runId ≡ workId 联接活投影翻转。
 */

/** 活投影 run 的联接摘要（桌面的 WorkflowRunCardSummary 的移动端收窄）。 */
export interface MobileWorkflowRunSummary {
  runId: string;
  /** 发起该 run 的 CreateWorkflow 行 id；缺席 = 没有可打开的详情。 */
  toolCallId?: string;
  status: WorkflowRunState["status"];
  stopReason?: WorkflowRunState["stopReason"];
  /** 步数（表内 + 表外），与桌面同一实数来源 workflowRunStepCounts。 */
  stepsSettled: number;
  stepsTotal: number;
  /** 子代理数（actors.length）。 */
  agents: number;
  /** run 自己的 actor 名单；卡展开区按名字列出。 */
  agentNames: string[];
  resumable: boolean;
  pendingQuestions: readonly string[];
  artifacts: WorkflowRunArtifactSummary[];
  currentPhase?: string;
  resultPreview?: string;
  error?: string;
}

export function buildWorkflowRunSummary(run: WorkflowRunState): MobileWorkflowRunSummary {
  const steps = workflowRunStepCounts(run);
  const pendingQuestions = (run.pendingQuestions ?? []).map((question) => question.qid);
  return {
    runId: run.runId,
    ...(run.toolCallId ? { toolCallId: run.toolCallId } : {}),
    status: run.status,
    ...(run.stopReason ? { stopReason: run.stopReason } : {}),
    stepsSettled: steps.settled,
    stepsTotal: steps.total,
    agents: run.actors.length,
    agentNames: run.actors
      .map((actor) => actor.name)
      .filter((name): name is string => name !== undefined),
    resumable: run.resumable === true,
    pendingQuestions,
    artifacts: run.artifacts ?? [],
    ...(run.currentPhase ? { currentPhase: run.currentPhase } : {}),
    ...(run.resultPreview ? { resultPreview: run.resultPreview } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

export interface MobileWorkflowDigest {
  key: string;
  /** 打开详情时用的来源行 id（联接到投影时由 run.toolCallId 换成发起行 id）。 */
  toolCallId: string;
  runId: string;
  /** 脚本 name；缺席时渲染方换兜底名。 */
  name?: string;
  /** 缺席 = run 不在活投影（淘汰 / 冷恢复）：卡退成中性单行「Workflow ended」。 */
  summary?: MobileWorkflowRunSummary;
  /** 设置轮：这张卡的 run 由「配置」修订而来；卡上方多一行设置行。 */
  settings?: { amend: WorkflowSettingsAmendMeta };
  /** 只出设置行、不出卡（就地生效的设置轮）。恒与 settings 同在。 */
  rowOnly: boolean;
}

export interface MobileWorkflowNotification {
  key: string;
  /** workId ≡ runId（协议写明的身份等式）；联接活投影用它。 */
  runId: string;
  /** run 名 = originMeta.title（CLI 权威给出）。 */
  runName: string;
  meta: WorkflowNotificationMeta;
  /**
   * 升级行的在场性联查：undefined = run 不在活投影（asked）；true = waiting；false = answered。
   */
  waiting?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** CreateWorkflow 入参里的脚本 name（桌面 readWorkflowName 的同一条读取规则）。 */
function readWorkflowName(input: unknown): string | undefined {
  if (isPlainRecord(input) && typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function readWorkflowLaunch(row: ConversationRow): WorkflowLaunchMeta | undefined {
  if (row.kind === "turnHeader") {
    const turnHeader = row as TurnHeaderRow;
    return turnHeader.workflowLaunch;
  }
  if (row.kind === "userInput") {
    return row.workflowLaunch;
  }
  return undefined;
}

/** 通知行读面：turnHeader 上的 backgroundResult / workflow originMeta。 */
function readWorkflowNotificationMeta(row: ConversationRow):
  | {
      key: string;
      runId: string;
      runName: string;
      meta: WorkflowNotificationMeta;
    }
  | undefined {
  if (row.kind !== "turnHeader") return undefined;
  const originMeta = row.originMeta;
  if (originMeta?.backgroundSource !== "workflow") return undefined;
  if (originMeta.workflowNotification === undefined) return undefined;
  return {
    key: `notification:${row.rowId}`,
    runId: originMeta.workId,
    runName: originMeta.title,
    meta: originMeta.workflowNotification,
  };
}

export function resolveWorkflowDigests(
  rows: readonly ConversationRow[],
  runs: readonly WorkflowRunState[],
): MobileWorkflowDigest[] {
  const digestList: MobileWorkflowDigest[] = [];
  const seen = new Set<string>();
  const pushedKeys = new Set<string>();
  // toolCallId → run（CreateWorkflow 行联接表；run.toolCallId 就是发起行）。
  const runByToolCallId = new Map<string, WorkflowRunState>();
  const runByRunId = new Map<string, WorkflowRunState>();
  for (const run of runs) {
    runByRunId.set(run.runId, run);
    if (run.toolCallId) runByToolCallId.set(run.toolCallId, run);
  }

  for (const row of rows) {
    // 来源一：直接启动 / 设置轮。同一轮的 turnHeader 与 userInput 携带**同一份**
    // workflowLaunch，按来源 key 去重（桌面按 turn 单元各调一次，天然不重）。
    const launch = readWorkflowLaunch(row);
    if (launch !== undefined) {
      const key = `launch:${launch.toolCallId}`;
      // 就地生效的设置轮：amend 无 predecessorRunId = 只改并发上限、run 仍在飞；不出卡。
      const rowOnly = launch.amend !== undefined && launch.amend.predecessorRunId === undefined;
      const alreadySeen = rowOnly ? pushedKeys.has(key) : seen.has(launch.runId) || pushedKeys.has(key);
      if (!alreadySeen) {
        pushedKeys.add(key);
        if (!rowOnly) seen.add(launch.runId);
        const run = rowOnly ? undefined : runByRunId.get(launch.runId);
        digestList.push({
          key,
          toolCallId: launch.toolCallId,
          runId: launch.runId,
          ...(launch.name ? { name: launch.name } : {}),
          ...(run ? { summary: buildWorkflowRunSummary(run) } : {}),
          ...(launch.amend ? { settings: { amend: launch.amend } } : {}),
          rowOnly,
        });
      }
    }

    if (row.kind !== "toolCall") continue;
    // 来源二：CreateWorkflow 行，按 toolCallId 联接（被拒绝 / 编不上的行没有 run，不出卡）。
    const created = runByToolCallId.get(row.toolCallId);
    if (created !== undefined) {
      if (seen.has(created.runId)) continue;
      seen.add(created.runId);
      const name = readWorkflowName(row.input);
      digestList.push({
        key: `${row.rowId}:${row.toolCallId}`,
        toolCallId: row.toolCallId,
        runId: created.runId,
        ...(name ? { name } : {}),
        summary: buildWorkflowRunSummary(created),
        rowOnly: false,
      });
      continue;
    }
    // 来源三：Resume 行（display 载荷带 runId；投影 toolCallId 跨 resume 沿用发起行，
    // 按 toolCallId 永远查不到）。
    if (row.display?.kind !== "resume_workflow_run") continue;
    const resumeRunId = row.display.runId;
    if (seen.has(resumeRunId)) continue;
    seen.add(resumeRunId);
    const resumed = runByRunId.get(resumeRunId);
    digestList.push({
      key: `${row.rowId}:${row.toolCallId}`,
      toolCallId: resumed?.toolCallId ?? row.toolCallId,
      runId: resumeRunId,
      ...(resumed ? { summary: buildWorkflowRunSummary(resumed) } : {}),
      rowOnly: false,
    });
  }
  return digestList;
}

export function resolveWorkflowNotifications(
  rows: readonly ConversationRow[],
  runs: readonly WorkflowRunState[],
): MobileWorkflowNotification[] {
  const notifications: MobileWorkflowNotification[] = [];
  for (const row of rows) {
    const read = readWorkflowNotificationMeta(row);
    if (read === undefined) continue;
    // 升级行三态：qid 在 run.pendingQuestions 里 = waiting；run 在场而 qid 不在 = answered；
    // run 不在活投影（淘汰 / 冷恢复）= undefined（中性 asked）。
    let waiting: boolean | undefined;
    if (read.meta.kind === "escalation") {
      const meta = read.meta;
      const run = runs.find((candidate) => candidate.runId === read.runId);
      waiting =
        run === undefined
          ? undefined
          : run.pendingQuestions?.some((question) => question.qid === meta.qid) === true;
    }
    notifications.push({
      key: read.key,
      runId: read.runId,
      runName: read.runName,
      meta: read.meta,
      ...(read.meta.kind === "escalation" ? { waiting } : {}),
    });
  }
  return notifications;
}

/** guide 输入与普通排队消息同住一份 queue fact；按权威 admitted delivery 分流（桌面 pendingGuideProjection 同一条规则）。 */
export function resolvePendingGuideItems(queue: QueueState | null): QueueItem[] {
  if (queue === null) return [];
  return queue.items.filter((item) => item.delivery.admitted === "guide");
}

export function resolveVisibleQueueItems(queue: QueueState | null): QueueItem[] {
  if (queue === null) return [];
  return queue.items.filter((item) => item.delivery.admitted !== "guide");
}
