import { useCallback, useMemo, useState } from "react";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { getV4ClientId, newCommandId } from "../../lib/v4ClientId.js";
import type { ConversationAgentService, WorkspaceTargetLite } from "../../lib/conversationChannel.js";
import { ensureHandshake } from "../../lib/conversationChannel.js";
import type { PermissionInteraction } from "./permissionOptions.js";

export interface UsePermissionInteractionsResult {
  /** 权限 pending 列表中的首个交互；无 pending 时为 null。 */
  pending: PermissionInteraction | null;
  /** 其余排队的 permission 交互数（首卡下方折叠计数）。 */
  queuedCount: number;
  /** 发送 resolveInteraction；resolve 后权威清理由 snapshot resync 完成。 */
  resolve: (
    interactionId: string,
    answer: { optionId?: string; freeText?: string },
  ) => Promise<boolean>;
  /** resolve 在途（按 interactionId 对齐，防跨请求误显 spinner）。 */
  isResponding: (interactionId: string) => boolean;
  /** resolve ACK 拒绝/失败（宿主展示错误条用）。 */
  responseError: string | null;
  clearResponseError: () => void;
}

/**
 * v4 权限流 RPC 接线（移动端精简版桌面 V4InteractionDialogs.tsx:191-229）：
 * - 输入：usePermissionStream（或宿主 channel）给出的 pendingInteractions 里的
 *   permission 交互；首个即当前卡片；
 * - 输出：resolveInteraction 命令信封（command.ts:176-188——先到先得，晚到
 *   reasonCode=proto.alreadyResolved 的 noop）。
 */
export function usePermissionInteractions(
  agentService: ConversationAgentService | null,
  workspace: WorkspaceTargetLite | null,
  sessionId: string | null,
  permissionInteractions: readonly PermissionInteraction[],
): UsePermissionInteractionsResult {
  const [respondingIds, setRespondingIds] = useState<string[]>([]);
  const [responseError, setResponseError] = useState<string | null>(null);

  const pending = useMemo<PermissionInteraction | null>(
    () => permissionInteractions[0] ?? null,
    [permissionInteractions],
  );

  const queuedCount = Math.max(0, permissionInteractions.length - (pending ? 1 : 0));

  const resolve = useCallback(
    async (
      interactionId: string,
      answer: { optionId?: string; freeText?: string },
    ): Promise<boolean> => {
      if (!agentService || !workspace || !sessionId) return false;
      // 幂等：proto.alreadyResolved 本身就是 noop，前端再挡一层减少双击竞态窗口。
      if (respondingIds.includes(interactionId)) return false;
      setResponseError(null);
      setRespondingIds((prev) => [...prev, interactionId]);
      try {
        await ensureHandshake(agentService);
        const envelope: CommandEnvelope = {
          commandId: newCommandId(),
          clientId: getV4ClientId(),
          sessionId,
          type: "resolveInteraction",
          payload: { interactionId, answer },
          issuedAt: Date.now(),
        };
        const ack = await agentService.sendConversationCommandV4({
          workspacePath: workspace.workspacePath,
          envelope,
        });
        // duplicate = 回放缓存结果，语义上等同已受理（与桌面
        // V4InteractionDialogs.tsx:211-212 一致：accepted/duplicate/noop 均视为成功）。
        if (ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop") {
          return true;
        }
        setResponseError([ack.reasonCode, ack.message].filter(Boolean).join(": ") || ack.status);
        return false;
      } catch (error) {
        setResponseError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setRespondingIds((prev) => prev.filter((id) => id !== interactionId));
      }
    },
    [agentService, respondingIds, sessionId, workspace],
  );

  const isResponding = useCallback(
    (interactionId: string) => respondingIds.includes(interactionId),
    [respondingIds],
  );

  const clearResponseError = useCallback(() => {
    setResponseError(null);
  }, []);

  return { pending, queuedCount, resolve, isResponding, responseError, clearResponseError };
}
