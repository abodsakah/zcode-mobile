import { useCallback, useEffect, useRef, useState } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import {
  ConversationChannel,
  sendCreateSessionCommand,
  sendTextCommand,
  type ConversationViewState,
  type WorkspaceTargetLite,
} from "./conversationChannel.js";

const IDLE_STATE: ConversationViewState = {
  status: "connecting",
  errorMessage: null,
  rows: [],
  control: null,
  meta: null,
  totalCount: 0,
};

const DRAFT_STATE: ConversationViewState = { ...IDLE_STATE, status: "ready" };

export interface UseConversationResult {
  view: ConversationViewState;
  /** 已提交但尚未被 ACK 吸收的乐观文本（还没出现对应 userInput 行）。 */
  pendingSends: string[];
  /** 发送失败信息（每次发送覆盖）。 */
  sendError: string | null;
  /**
   * 发送。RPC 失败时记录 sendError 并 **rethrow**（Composer 依赖 reject 保留草稿，
   * ConversationComposer.tsx:1425-1426 的「失败不清空」契约）；乐观气泡仍由 finally 移除。
   */
  send: (text: string) => Promise<void>;
  clearSendError: () => void;
}

/**
 * 会话流订阅 + 发送。
 * 有 activeSessionId → ConversationChannel 订阅 conversation/<id>，sendText 直发；
 * 无会话（draft）→ 首条消息经 createSession(firstInput) 建会话并切换。
 */
export function useConversation(
  agentService: IZCodeAgentService | null,
  workspace: WorkspaceTargetLite | null,
  activeSessionId: string | null,
  connectionEpoch: number,
  onSessionCreated: (sessionId: string) => void,
): UseConversationResult {
  const [view, setView] = useState<ConversationViewState>(IDLE_STATE);
  const [pendingSends, setPendingSends] = useState<string[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const channelRef = useRef<ConversationChannel | null>(null);
  // onSessionCreated 以 ref 持有，避免其身份变化触发重订阅。
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;

  useEffect(() => {
    channelRef.current?.dispose();
    channelRef.current = null;
    if (!agentService || !workspace || !activeSessionId) {
      setView(activeSessionId ? IDLE_STATE : DRAFT_STATE);
      return;
    }
    setView(IDLE_STATE);
    const channel = new ConversationChannel(agentService, workspace, activeSessionId, {
      onState: setView,
    });
    channelRef.current = channel;
    void channel.start();
    return () => {
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      channel.dispose();
    };
  }, [agentService, workspace, activeSessionId, connectionEpoch]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !agentService || !workspace) return;
      setSendError(null);
      setPendingSends((prev) => [...prev, trimmed]);
      try {
        if (activeSessionId) {
          await sendTextCommand(agentService, workspace, activeSessionId, trimmed);
        } else {
          const createdSessionId = await sendCreateSessionCommand(
            agentService,
            workspace,
            trimmed,
          );
          onSessionCreatedRef.current(createdSessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSendError(message);
        // rethrow 让 Composer 的 reject→保草稿路径生效（错误状态已记录在 sendError）。
        throw error;
      } finally {
        setPendingSends((prev) => prev.filter((item) => item !== trimmed));
      }
    },
    [agentService, workspace, activeSessionId],
  );

  const clearSendError = useCallback(() => {
    setSendError(null);
  }, []);

  return { view, pendingSends, sendError, send, clearSendError };
}
