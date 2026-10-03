import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ServerLinkProvider,
  useServerLink,
  type ServerLinkState,
} from "./lib/ServerLink.js";
import { hasExplicitServerConfig } from "./lib/serverConfig.js";
import { useWorkspace } from "./lib/workspace.js";
import { useActiveSession, useSessions } from "./lib/sessionStore.js";
import { useConversation } from "./lib/useConversation.js";
import { sendStopCommand } from "./lib/conversationChannel.js";
import { useKeyboardInset } from "./lib/useKeyboardInset.js";
import { TopBar } from "./ui/TopBar.js";
import { SessionDrawer } from "./ui/SessionDrawer.js";
import { PairingScreen } from "./ui/PairingScreen.js";
import { ConversationView } from "./features/conversation/index.js";
import {
  Composer,
  PermissionCard,
  usePermissionInteractions,
  usePermissionStream,
} from "./features/composer/index.js";
import { WorkflowPanel } from "./features/workflow/index.js";

function linkStatusLabel(state: ServerLinkState): string {
  switch (state.kind) {
    case "online":
      return "";
    case "connecting":
      return "Connecting to server…";
    case "offline":
      return `Server offline: ${state.message}`;
  }
}

/** 撤回队列项到 composer 的草稿注入信号（nonce 递增保证同文本重复撤回也生效）。 */
interface ComposerDraftInjection {
  text: string;
  nonce: number;
}

function MobileShell() {
  const { config, state: link } = useServerLink();
  const accessor = link.kind === "online" ? link.accessor : null;
  const agentService = accessor?.zcodeAgentService ?? null;

  // accessor 每次重连都是新实例；用 epoch 让下游订阅/列表整体重置。
  const epochRef = useRef(0);
  const lastAccessorRef = useRef(accessor);
  if (lastAccessorRef.current !== accessor) {
    lastAccessorRef.current = accessor;
    epochRef.current += 1;
  }
  const connectionEpoch = epochRef.current;

  const { workspace, error: workspaceError } = useWorkspace(config, accessor);
  const { sessions, error: sessionsError, loading: sessionsLoading, refresh: refreshSessions } =
    useSessions(accessor, workspace, connectionEpoch);
  const [activeSessionId, setActiveSessionId] = useActiveSession(sessions);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workflowPanelOpen, setWorkflowPanelOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState<ComposerDraftInjection | null>(null);
  const [scrollSignal, setScrollSignal] = useState(0);
  const keyboardInset = useKeyboardInset();

  const conversation = useConversation(
    agentService,
    workspace,
    activeSessionId,
    connectionEpoch,
    (createdSessionId) => {
      setActiveSessionId(createdSessionId);
      refreshSessions();
    },
  );

  // 权限流：独立轻量订阅（pendingInteractions）+ resolveInteraction RPC 接线。
  const permissionInteractions = usePermissionStream(
    agentService,
    workspace,
    activeSessionId,
    connectionEpoch,
  );
  const permissions = usePermissionInteractions(
    agentService,
    workspace,
    activeSessionId,
    permissionInteractions,
  );
  const pendingPermission = permissions.pending;
  const pendingPermissionId = pendingPermission?.interactionId ?? null;
  const clearPermissionError = permissions.clearResponseError;
  // 卡片按 interactionId 重建；上一张卡的 resolve 错误不带入下一张。
  useEffect(() => {
    clearPermissionError();
  }, [pendingPermissionId, clearPermissionError]);

  const activeSessionTitle = activeSessionId
    ? sessions?.find((session) => session.sessionId === activeSessionId)?.title
    : undefined;
  const title = conversation.view.meta?.title.trim() || activeSessionTitle?.trim() || "New chat";

  const handleOpenSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setDrawerOpen(false);
    setScrollSignal((signal) => signal + 1);
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setDrawerOpen(false);
  };

  /** 子代理下钻：单列壳没有侧栏，直接把子会话切换为活动会话（抽屉里可回父会话）。 */
  const handleOpenSubagentSession = useCallback(
    (target: { childSessionId: string }) => {
      setActiveSessionId(target.childSessionId);
      setScrollSignal((signal) => signal + 1);
    },
    [setActiveSessionId],
  );

  const handleStop = useCallback(() => {
    if (!agentService || !workspace || !activeSessionId) return;
    void sendStopCommand(agentService, workspace, activeSessionId).catch(() => {
      // stop 失败不打断会话流：turn 可能已自行结束（error 状态由 control/行投影呈现）。
    });
  }, [agentService, workspace, activeSessionId]);

  /** 队列项撤回：WorkflowPanel 权威删除成功后把原文恢复进 composer。 */
  const handleEditQueueItemDraft = useCallback(
    (queueItemId: string, draftText: string) => {
      setWorkflowPanelOpen(false);
      setComposerDraft({ text: draftText, nonce: Date.now() });
    },
    [],
  );

  const openDrawer = () => {
    refreshSessions();
    setDrawerOpen(true);
  };

  const connected = workspace !== null && link.kind === "online";
  const statusMessage = workspaceError
    ? `Workspace unavailable: ${workspaceError}`
    : linkStatusLabel(link);

  return (
    <div
      className="flex h-dvh min-h-dvh flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] text-foreground"
      style={keyboardInset > 0 ? { paddingBottom: `${keyboardInset}px` } : undefined}
    >
      <TopBar
        title={title}
        linkState={link}
        onOpenDrawer={openDrawer}
        onOpenWorkflow={connected ? () => setWorkflowPanelOpen(true) : undefined}
      />
      {statusMessage ? (
        <p className="shrink-0 break-words px-4 pb-1 text-ui-xs text-foreground-subtlest">
          {statusMessage}
        </p>
      ) : null}
      <ConversationView
        view={conversation.view}
        pendingSends={conversation.pendingSends}
        sendError={conversation.sendError}
        scrollSignal={scrollSignal}
        sessionId={activeSessionId}
        onOpenSubagentSession={handleOpenSubagentSession}
      />
      <WorkflowPanel
        agentService={agentService}
        workspace={workspace}
        activeSessionId={activeSessionId}
        panelOpen={workflowPanelOpen}
        onPanelOpenChange={setWorkflowPanelOpen}
        onEditQueueItemDraft={handleEditQueueItemDraft}
      />
      {pendingPermission ? (
        <PermissionCard
          key={pendingPermission.interactionId}
          interaction={pendingPermission}
          onResolve={permissions.resolve}
          responding={permissions.isResponding(pendingPermission.interactionId)}
          responseError={permissions.responseError}
          queuedCount={permissions.queuedCount}
        />
      ) : null}
      <Composer
        disabled={!workspace || link.kind !== "online"}
        canStop={conversation.view.control?.canStop ?? false}
        onStop={handleStop}
        draftInjection={composerDraft}
        onSend={(text) => {
          setScrollSignal((signal) => signal + 1);
          return conversation.send(text);
        }}
        onFocusTextArea={() => setScrollSignal((signal) => signal + 1)}
      />
      <SessionDrawer
        open={drawerOpen}
        sessions={sessions}
        loading={sessionsLoading}
        error={sessionsError}
        activeSessionId={activeSessionId}
        serverOrigin={config.origin}
        onClose={() => setDrawerOpen(false)}
        onOpenSession={handleOpenSession}
        onNewChat={handleNewChat}
      />
    </div>
  );
}

export function App() {
  // 打包后的 APK 没有同源服务器可回退：没有显式配置时先显示配对页，
  // 否则 ServerLinkProvider 会永远重连自身并卡在 "Server offline"。
  const configured = useMemo(() => hasExplicitServerConfig(), []);
  if (!configured) {
    return <PairingScreen />;
  }
  return (
    <ServerLinkProvider>
      <MobileShell />
    </ServerLinkProvider>
  );
}
