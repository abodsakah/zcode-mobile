import { useState } from "react";
import type { QueueState } from "@zcode/shared/zcode-protocol-v4";
import { resolveVisibleQueueItems } from "./workflowDigestsModel.js";

/**
 * 队列面板的移动端形态：桌面 ConversationQueuePanel 是 composer 上方的一条
 * dnd-kit 拖拽列表；移动端把「重排」交给**上移/下移**按钮（长列表上拖拽既难命中又会与
 * 页面滚动打架），整面板升级为全屏 sheet。
 *
 * 保留的桌面语义：
 * - guide 输入不进这张列表（按权威 admitted delivery 分流，pendingGuide 列表另画）；
 * - paused banner + Continue（setAutoDrain(true)），暂停原因分 stopped/error/generic；
 * - 编辑 = 撤回到 composer（权威删除成功后才恢复草稿）由宿主裁决，这里只发回调；
 * - 行锁：dispatch.state !== "queued" 或 editPending 的行全部操作禁用。
 */

export interface QueueSheetProps {
  open: boolean;
  queue: QueueState | null;
  /** 正在等待 delete ACK 的目标项；仅锁该行。 */
  pendingEditQueueItemId?: string | null;
  onDeleteItem?: (queueItemId: string) => void;
  /** 撤回队列项到 composer；权威删除成功后才恢复草稿。 */
  onEditItem?: (queueItemId: string) => void;
  onSendNow?: (queueItemId: string) => void;
  /** 上移 / 下移 → reorderQueueItem（null = 队尾）。 */
  onMoveItem?: (queueItemId: string, beforeQueueItemId: string | null) => void;
  onResume?: () => void;
  onClose: () => void;
}

function pausedReasonLabel(queue: QueueState): string {
  if (queue.pauseReason === "stopped") {
    return "The queue was paused because you stopped the current response";
  }
  if (queue.pauseReason === "error") {
    return "The queue was paused because the response failed";
  }
  return "The queue is paused";
}

export function WorkflowQueueSheet({
  open,
  queue,
  pendingEditQueueItemId = null,
  onDeleteItem,
  onEditItem,
  onSendNow,
  onMoveItem,
  onResume,
  onClose,
}: QueueSheetProps) {
  const [resumePending, setResumePending] = useState(false);
  if (!open) return null;
  // guide 输入与普通排队消息同住一份 queue fact；只按权威 admitted delivery 分流展示
  // （桌面 pendingGuideProjection 同一条规则），guide 另由 PendingGuideList 画。
  // compact 意图保留为 /compact 单行只读展示，不给编辑。
  const items = resolveVisibleQueueItems(queue);
  if (items.length === 0) return null;
  const paused = queue !== null && !queue.autoDrain;
  const resume = () => {
    if (!onResume || resumePending) return;
    setResumePending(true);
    try {
      onResume();
    } finally {
      setResumePending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-label="Queued messages"
      data-testid="mobile-workflow-queue-sheet"
      data-queue-count={items.length}
      data-queue-auto-drain={queue?.autoDrain ? "true" : "false"}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-card-border px-2 pt-[max(env(safe-area-inset-top),0.25rem)]">
        <button
          type="button"
          aria-label="Close queued messages"
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground-subtle active:bg-surface"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="min-w-0 flex-1 truncate text-ui-base font-medium">
          {items.length === 1 ? "1 queued message" : `${items.length} queued messages`}
        </h2>
      </header>
      {paused ? (
        <div
          data-testid="v4-queue-paused-banner"
          className="mx-3 mt-2 flex min-h-10 items-center gap-3 rounded-xl border border-card-border bg-surface px-3 py-2"
        >
          <span className="min-w-0 flex-1 text-ui-sm text-foreground">
            {queue !== null ? pausedReasonLabel(queue) : null}
          </span>
          {onResume ? (
            <button
              type="button"
              data-testid="v4-queue-resume"
              disabled={resumePending}
              className="shrink-0 rounded-lg px-2 py-1 text-ui-sm text-foreground-subtle active:bg-surface disabled:opacity-50"
              onClick={resume}
            >
              Continue
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
        {items.map((item, index) => {
          const rowLocked = item.dispatch.state !== "queued" || pendingEditQueueItemId === item.queueItemId;
          const isCompact = item.kind === "compact";
          const editable = !isCompact && onEditItem !== undefined && !rowLocked;
          return (
            <li
              key={item.queueItemId}
              data-testid={`v4-queue-item-${item.queueItemId}`}
              data-queue-item-id={item.queueItemId}
              data-kind={item.kind}
              data-dispatch-state={item.dispatch.state}
              data-edit-pending={pendingEditQueueItemId === item.queueItemId ? "true" : "false"}
              className={`rounded-xl border border-card-border bg-card px-3 py-2 ${rowLocked ? "opacity-60" : ""}`}
            >
              <p
                className={`whitespace-pre-wrap break-words text-ui-base text-foreground ${isCompact ? "font-mono" : ""}`}
              >
                {isCompact ? "/compact" : item.text}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {onSendNow ? (
                  <button
                    type="button"
                    data-testid={`v4-queue-item-send-now-${item.queueItemId}`}
                    disabled={rowLocked}
                    onClick={() => onSendNow(item.queueItemId)}
                    className="rounded-lg border border-card-border px-2.5 py-1.5 text-ui-sm text-foreground disabled:opacity-50"
                  >
                    {isCompact ? "Run now" : "Steer"}
                  </button>
                ) : null}
                {onEditItem && !isCompact ? (
                  <button
                    type="button"
                    data-testid={`v4-queue-item-edit-${item.queueItemId}`}
                    disabled={!editable}
                    onClick={() => onEditItem(item.queueItemId)}
                    className="rounded-lg border border-card-border px-2.5 py-1.5 text-ui-sm text-foreground-subtle disabled:opacity-50"
                  >
                    Edit
                  </button>
                ) : null}
                {onDeleteItem ? (
                  <button
                    type="button"
                    data-testid={`v4-queue-item-delete-${item.queueItemId}`}
                    disabled={rowLocked}
                    onClick={() => onDeleteItem(item.queueItemId)}
                    className="rounded-lg border border-card-border px-2.5 py-1.5 text-ui-sm text-destructive disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null}
                {onMoveItem ? (
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move earlier"
                      disabled={rowLocked || index === 0}
                      onClick={() => {
                        const previous = items[index - 1];
                        if (previous === undefined) return;
                        onMoveItem(item.queueItemId, previous.queueItemId);
                      }}
                      className="rounded-lg border border-card-border px-2 py-1.5 text-ui-sm text-foreground-subtle disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move later"
                      disabled={rowLocked || index === items.length - 1}
                      onClick={() => {
                        const next = items[index + 1];
                        onMoveItem(item.queueItemId, next === undefined ? null : next.queueItemId);
                      }}
                      className="rounded-lg border border-card-border px-2 py-1.5 text-ui-sm text-foreground-subtle disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

