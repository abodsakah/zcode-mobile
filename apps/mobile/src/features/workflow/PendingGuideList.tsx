import type { QueueItem, QueueState } from "@zcode/shared/zcode-protocol-v4";
import { resolvePendingGuideItems } from "./workflowDigestsModel.js";

/**
 * 待注入 guide 列表（桌面 ConversationPendingGuideList 的收窄）：
 *
 * 桌面把 guide 复用成 UserInputRow 交给 ConversationTurnRow 画轮；移动端没有 turn 行体系，
 * 这里画同一件事的最小形态：`Waiting to steer the current run…` 状态词 + 用户原文气泡。
 * 数据只读——guide 的注入由 CLI 权威裁决，列表不携带任何操作。
 */

const PENDING_STATUS = "Waiting to steer the current run…";

export function PendingGuideList({ queue }: { queue: QueueState | null }) {
  const items: readonly QueueItem[] = resolvePendingGuideItems(queue);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.queueItemId} className="flex flex-col items-end gap-0.5">
          <span className="px-1 text-ui-xs text-foreground-subtlest">{PENDING_STATUS}</span>
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-card px-3.5 py-2.5 text-ui-base text-foreground opacity-80">
            {item.text}
          </div>
        </div>
      ))}
    </div>
  );
}
