import { useEffect, useMemo, useState } from "react";
import type { IDisposable } from "@zcode/rpc";
import {
  TopicWireFrameAssembler,
  conversationTopic,
  conversationTopicFrameSchema,
  type PendingInteraction,
} from "@zcode/shared/zcode-protocol-v4";
import {
  ensureHandshake,
  type ConversationAgentService,
  type WorkspaceTargetLite,
} from "../../lib/conversationChannel.js";
import type { PermissionInteraction } from "./permissionOptions.js";

/**
 * 权限交互流（new-file 约束下的自足订阅）。
 *
 * 移动壳现有的 ConversationChannel（src/lib/conversationChannel.ts）把
 * ConversationViewState 定为 { rows, control, meta, totalCount }——它的
 * applyDeltaToRows（:99-121）会丢弃 state.updated patch 里的 pendingInteractions 键
 * （delta.ts:50 的键级替换面），而本 port 的「new files only」规则不允许改那个文件。
 * 因此这里开一条平行的轻量订阅：复用同一 wire 协议（TopicWireFrameAssembler +
 * conversationTopic + ensureHandshake），只归约 pendingInteractions 一个键：
 * - snapshot → 全量替换；
 * - delta op=state.updated 且 patch.pendingInteractions 在场 → 键级替换
 *   （协议语义：键内绝不深合并，delta.ts:38）；
 * - 其余 op 与键全部忽略。
 *
 * 成本说明：与宿主 channel 各持一条 subscribeConversationV4 订阅（CLI 按
 * subscriptionId 路由帧，Host 不做单订阅配额；见
 * packages/services/src/zcode-agent/zcodeAgentService.ts:4990-5033——每次 subscribe
 * 返回独立 ack.subscriptionId，无「已订阅即拒绝」的分支）。宿主 channel 未来把
 * pendingInteractions 升级进 ConversationViewState 后，可删掉本订阅、直接把
 * view.pendingInteractions 喂给 usePermissionInteractions。
 */
export function usePermissionStream(
  agentService: ConversationAgentService | null,
  workspace: WorkspaceTargetLite | null,
  sessionId: string | null,
  connectionEpoch: number,
): PermissionInteraction[] {
  const [interactions, setInteractions] = useState<PendingInteraction[]>([]);

  useEffect(() => {
    if (!agentService || !workspace || !sessionId) {
      setInteractions([]);
      return;
    }
    let disposed = false;
    let subscriptionId: string | null = null;
    let detachFrames: IDisposable | null = null;
    const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
    const topic = conversationTopic(sessionId);

    detachFrames = agentService.onDynamicConversationFrame(workspace)((candidate) => {
      if (disposed || candidate.topic !== topic) return;
      for (const event of assembler.accept(candidate)) {
        if (event.kind !== "complete") continue;
        const frame = event.frame;
        if (frame.topic !== topic) continue;
        if (frame.payload.kind === "snapshot") {
          setInteractions(frame.payload.snapshot.pendingInteractions);
          continue;
        }
        for (const delta of frame.payload.deltas) {
          if (delta.op === "state.updated" && delta.patch.pendingInteractions) {
            setInteractions(delta.patch.pendingInteractions);
          }
        }
      }
    });

    void (async () => {
      try {
        // v4 命令面（含 resolveInteraction）必须在 hello/clientHello 之后（ensureHandshake
        // 与宿主 channel 共享每-attachment 一次的握手缓存，conversationChannel.ts:57）。
        await ensureHandshake(agentService);
        const result = await agentService.subscribeConversationV4({
          workspacePath: workspace.workspacePath,
          sessionId,
          visibility: "foreground",
        });
        if (disposed) {
          void agentService
            .unsubscribeConversationV4({ workspacePath: workspace.workspacePath, subscriptionId: result.ack.subscriptionId })
            .catch(() => {});
          return;
        }
        subscriptionId = result.ack.subscriptionId;
      } catch {
        // 订阅失败时列表保持空 → 不渲染卡片；宿主会话区已有连接错误提示。
      }
    })();

    return () => {
      disposed = true;
      detachFrames?.dispose();
      if (subscriptionId) {
        void agentService
          .unsubscribeConversationV4({
            workspacePath: workspace.workspacePath,
            subscriptionId,
          })
          .catch(() => {
            // 断线/会话已关闭时的退订失败无需处理（同宿主 channel 语义）。
          });
      }
    };
  }, [agentService, connectionEpoch, sessionId, workspace]);

  return useMemo(
    () =>
      interactions.filter(
        (interaction): interaction is PermissionInteraction =>
          interaction.payload.kind === "permission",
      ),
    [interactions],
  );
}
