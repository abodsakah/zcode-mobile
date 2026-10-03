import { useCallback, useMemo, useRef, useState } from "react";
import type { ConversationAgentService, WorkspaceTargetLite } from "../../lib/conversationChannel.js";
import {
  createWorkflowSessionCommands,
  useWorkflowSessionState,
  type WorkflowSessionCommands,
} from "./workflowSessionState.js";
import {
  resolveWorkflowDigests,
  resolveWorkflowNotifications,
} from "./workflowDigestsModel.js";
import { buildMobileStatusModel } from "./statusPanelModel.js";
import { WorkflowDigestCard, WorkflowSettingsChangeRow } from "./WorkflowDigestCard.js";
import { WorkflowNotificationRow } from "./WorkflowNotificationRow.js";
import { WorkflowStatusPanel, WorkflowStatusSection } from "./WorkflowStatusPanel.js";
import { WorkflowQueueSheet } from "./WorkflowQueueSheet.js";
import { PendingGuideList } from "./PendingGuideList.js";

/**
 * 移动端 workflow / status 面板（本特性对宿主的唯一入口）：
 *
 * - **WorkflowStatusPanel**：composer 区上方的一眼条（needs-attention / running / done），
 *   点开整面板。
 * - **WorkflowPanel 全屏 sheet**：三个分区 —— Status（活动 + 终态）、Queued（入口行 →
 *   WorkflowQueueSheet 全屏队列）、Runs（轮尾 run 卡 + 后台通知行的会话顺序列表）。
 * - 命令面（Stop / Resume / 队列增删改排序 / Continue）在 `createWorkflowSessionCommands`
 *   一处收口；宿主不传 `agentService` 时整个面板退成只读（回调缺席 = 控件不渲染）。
 *
 * 数据：`useWorkflowSessionState` 在本特性目录内维护 queue / backgroundWorks /
 * workflowRuns / goal / plan 投影（桌面这些键来自会话投影 store；移动端按
 * 「desktop store deps adapt locally」规则在此本地重建，wire 归约与共享包同一套原语）。
 */

export interface WorkflowPanelProps {
  agentService: ConversationAgentService | null;
  workspace: WorkspaceTargetLite | null;
  activeSessionId: string | null;
  /** 撤回队列项到 composer：宿主负责恢复草稿（权威删除成功后才恢复，携带队列原文）。 */
  onEditQueueItemDraft?: (queueItemId: string, draftText: string) => void;
  /** 一眼条点开全屏面板前的钩子（宿主可用来收起键盘等）；缺省直接开。 */
  onBeforeOpenPanel?: () => void;
  /**
   * 全屏面板的外部受控开合（顶栏入口）；缺省时面板只由一眼条打开。
   * 与内部一眼条开合是受控/非受控混合：宿主传值时以宿主为准，两边都能关。
   */
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
}

function commandErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkflowPanel({
  agentService,
  workspace,
  activeSessionId,
  onEditQueueItemDraft,
  onBeforeOpenPanel,
  panelOpen: panelOpenProp,
  onPanelOpenChange,
}: WorkflowPanelProps) {
  const state = useWorkflowSessionState(agentService, workspace, activeSessionId);
  const [internalPanelOpen, setInternalPanelOpen] = useState(false);
  const panelOpen = panelOpenProp ?? internalPanelOpen;
  const setPanelOpen = useCallback(
    (open: boolean) => {
      setInternalPanelOpen(open);
      onPanelOpenChange?.(open);
    },
    [onPanelOpenChange],
  );
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 撤回编辑 = deleteQueueItem 权威删除 + 宿主恢复草稿；等待 ACK 的行加锁。
  const [pendingEditQueueItemId, setPendingEditQueueItemId] = useState<string | null>(null);
  // revision 读最新投影；命令 CAS 用的引用，不触发重渲染。
  const revisionRef = useRef<number | null>(null);
  revisionRef.current = state.revision;

  const commands: WorkflowSessionCommands | null = useMemo(() => {
    if (agentService === null || workspace === null || activeSessionId === null) return null;
    return createWorkflowSessionCommands(agentService, workspace, activeSessionId, () => {
      const revision = revisionRef.current;
      return revision === null ? undefined : revision;
    });
  }, [agentService, workspace, activeSessionId]);

  const digests = useMemo(
    () => resolveWorkflowDigests(state.rows, state.workflowRuns?.runs ?? []),
    [state.rows, state.workflowRuns],
  );
  const notifications = useMemo(
    () => resolveWorkflowNotifications(state.rows, state.workflowRuns?.runs ?? []),
    [state.rows, state.workflowRuns],
  );
  const statusModel = useMemo(
    () =>
      buildMobileStatusModel({
        control: state.control,
        queue: state.queue,
        backgroundWorks: state.backgroundWorks,
        workflowRuns: state.workflowRuns?.runs ?? [],
        goal: state.goal,
        plan: state.plan,
        notifications,
      }),
    [state, notifications],
  );

  const run = useCallback(
    (operation: () => Promise<void>) => {
      if (commands === null) return;
      void operation().catch((error: unknown) => {
        setActionError(commandErrorText(error));
      });
    },
    [commands],
  );

  const handleDeleteQueueItem = useCallback(
    (queueItemId: string) => {
      if (commands === null) return;
      run(async () => {
        await commands.deleteQueueItem(queueItemId);
      });
    },
    [commands, run],
  );

  /** 撤回编辑：先发权威 deleteQueueItem，ACK 成功后请宿主恢复 composer 草稿（携带队列原文）。 */
  const handleEditQueueItem = useCallback(
    (queueItemId: string) => {
      if (commands === null || onEditQueueItemDraft === undefined) return;
      // 删除会改变队列投影，正文必须在 ACK 前捕获。
      const draftText = state.queue?.items.find((item) => item.queueItemId === queueItemId)?.text ?? "";
      setPendingEditQueueItemId(queueItemId);
      run(async () => {
        try {
          await commands.deleteQueueItem(queueItemId);
          onEditQueueItemDraft(queueItemId, draftText);
        } finally {
          setPendingEditQueueItemId(null);
        }
      });
    },
    [commands, onEditQueueItemDraft, run, state.queue],
  );

  const handleSendNow = useCallback(
    (queueItemId: string) => {
      if (commands === null) return;
      run(() => commands.sendQueuedNow(queueItemId));
    },
    [commands, run],
  );

  const handleMoveItem = useCallback(
    (queueItemId: string, beforeQueueItemId: string | null) => {
      if (commands === null) return;
      run(() => commands.reorderQueueItem(queueItemId, beforeQueueItemId));
    },
    [commands, run],
  );

  const handleResumeQueue = useCallback(() => {
    if (commands === null) return;
    run(() => commands.resumeQueue());
  }, [commands, run]);

  const handleCancelRun = useCallback(
    (runId: string) => {
      if (commands === null) return;
      run(() => commands.cancelBackgroundWork(runId));
    },
    [commands, run],
  );

  const handleResumeRun = useCallback(
    (runId: string) => {
      if (commands === null) return;
      run(() => commands.resumeWorkflowRun(runId));
    },
    [commands, run],
  );

  const openFullPanel = useCallback(() => {
    onBeforeOpenPanel?.();
    setActionError(null);
    setPanelOpen(true);
  }, [onBeforeOpenPanel, setPanelOpen]);

  // 顶栏入口打开时（外部受控），即使没有任何在途内容也要渲染出全屏面板。
  if (state.status === "connecting" && !statusModel.hasContent && !panelOpen) return null;
  if (!statusModel.hasContent && digests.length === 0 && notifications.length === 0 && !panelOpen)
    return null;

  const fullPanelEmpty =
    !statusModel.hasContent && digests.length === 0 && notifications.length === 0;

  return (
    <>
      <div className="shrink-0 px-3 pb-1">
        <WorkflowStatusPanel model={statusModel} onOpenFullPanel={openFullPanel} />
        {actionError !== null ? (
          <p className="mt-1 break-words px-1 text-ui-xs text-destructive">{actionError}</p>
        ) : null}
      </div>
      {panelOpen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-label="Workflows and status"
          data-testid="mobile-workflow-panel"
        >
          <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-card-border px-2 pt-[max(env(safe-area-inset-top),0.25rem)]">
            <button
              type="button"
              aria-label="Close workflows panel"
              onClick={() => setPanelOpen(false)}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground-subtle active:bg-surface"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <h2 className="min-w-0 flex-1 truncate text-ui-base font-medium">Workflows &amp; status</h2>
          </header>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-3">
            {actionError !== null ? (
              <p className="break-words rounded-lg border border-destructive/40 bg-surface px-3 py-2 text-ui-sm text-destructive">
                {actionError}
              </p>
            ) : null}
            <PendingGuideList queue={state.queue} />
            <WorkflowStatusSection model={statusModel} />
            <section>
              <button
                type="button"
                data-testid="mobile-workflow-queue-entry"
                onClick={() => setQueueSheetOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left active:bg-surface"
              >
                <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
                  Queued messages
                </span>
                <span className="shrink-0 text-ui-sm text-foreground-subtlest">
                  {state.queue?.items.length ?? 0}
                </span>
                <span aria-hidden className="shrink-0 text-ui-sm text-foreground-subtlest">
                  ›
                </span>
              </button>
            </section>
            {fullPanelEmpty ? (
              <p className="px-1 py-8 text-center text-ui-sm text-foreground-subtlest">
                No workflows, queued messages, or background activity in this session.
              </p>
            ) : null}
            {digests.length > 0 || notifications.length > 0 ? (
              <section className="space-y-3">
                <h3 className="px-1 text-ui-sm font-medium text-foreground-subtle">Workflow runs</h3>
                {digests.map((digest) => (
                  <div key={digest.key} className="space-y-1">
                    {digest.settings !== undefined ? (
                      <WorkflowSettingsChangeRow digest={digest} />
                    ) : null}
                    {digest.rowOnly ? null : (
                      <WorkflowDigestCard
                        digest={digest}
                        {...(commands === null
                          ? {}
                          : {
                              onCancel: handleCancelRun,
                              onResume: handleResumeRun,
                              // 移动端暂无产物 tab 承载面：药丸保持可见、禁用（不消失）。
                            })}
                      />
                    )}
                  </div>
                ))}
                {notifications.map((notification) => (
                  <WorkflowNotificationRow
                    key={notification.key}
                    notification={notification}
                    {...(commands === null ? {} : { onOpenRun: openFullPanel })}
                  />
                ))}
              </section>
            ) : null}
          </div>
          <WorkflowQueueSheet
            open={queueSheetOpen}
            queue={state.queue}
            pendingEditQueueItemId={pendingEditQueueItemId}
            {...(commands === null
              ? { onClose: () => setQueueSheetOpen(false) }
              : {
                  onClose: () => setQueueSheetOpen(false),
                  onDeleteItem: handleDeleteQueueItem,
                  ...(onEditQueueItemDraft === undefined ? {} : { onEditItem: handleEditQueueItem }),
                  onSendNow: handleSendNow,
                  onMoveItem: handleMoveItem,
                  onResume: handleResumeQueue,
                })}
          />
        </div>
      ) : null}
    </>
  );
}
