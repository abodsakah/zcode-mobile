import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ServerLinkProvider,
  useServerLink,
  type ServerLinkState,
} from "./lib/ServerLink.js";
import { hasExplicitServerConfig } from "./lib/serverConfig.js";
import { useWorkspace, readStoredWorkspacePath, rememberWorkspacePath } from "./lib/workspace.js";import { useActiveSession, useSessions } from "./lib/sessionStore.js";
import { useConversation } from "./lib/useConversation.js";
import { sendStopCommand, sendSwitchCollaborationMode, sendSwitchModelConfig } from "./lib/conversationChannel.js";
import { serverHttpUrl } from "./lib/serverConfig.js";
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

/** 模型目录的轻量投影（来自 IModelSelectionService.getView）。 */
export interface ModelProviderLight {
  providerId: string;
  providerName: string;
  models: Array<{ modelId: string; reasoningLevels: string[] }>;
}

/** 斜杠命令的轻量投影（来自 ICommandsService.list）。 */
export interface SlashCommandLight {
  name: string;
  description?: string;
  prompt: string;
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

  // workspace 选择：用户切换过的优先，否则跟随服务器列表（与桌面侧栏一致）。
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(() =>
    readStoredWorkspacePath(),
  );
  const { workspaceList, workspace: serverWorkspace, error: workspaceError } = useWorkspace(
    config,
    accessor,
    selectedWorkspacePath,
  );
  // 以字符串路径为唯一身份，workspace 对象用 useMemo 固定：server-info 每次重取都会
  // 重建对象，若下游 effect 以对象为依赖会把刚创建的会话打回草稿态。
  const workspacePath = selectedWorkspacePath ?? serverWorkspace?.workspacePath ?? null;
  const workspace = useMemo(
    () => (workspacePath ? { workspacePath } : null),
    [workspacePath],
  );

  // accessor 或 workspace 路径任一变化都让下游订阅/列表整体重置（合并成一个 epoch）。
  const [dataEpoch, setDataEpoch] = useState(0);
  useEffect(() => {
    setDataEpoch((epoch) => epoch + 1);
  }, [accessor, workspacePath]);

  const handleSwitchWorkspace = useCallback((path: string) => {
    rememberWorkspacePath(path);
    setSelectedWorkspacePath(path.trim());
    setDrawerOpen(false);
  }, []);
  const { sessions, error: sessionsError, loading: sessionsLoading, refresh: refreshSessions } =
    useSessions(accessor, workspace, dataEpoch);
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
    dataEpoch,
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
    dataEpoch,
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

  // workspace 切换后旧会话不再属于当前列表，清空活动会话（以路径字符串为准，防身份抖动）。
  useEffect(() => {
    setActiveSessionId(null);
  }, [workspacePath, setActiveSessionId]);

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

  // 侧栏打开期间轮询会话列表：运行中指示（跳动点）保持新鲜。
  useEffect(() => {
    if (!drawerOpen) return;
    const timer = setInterval(() => refreshSessions(), 5000);
    return () => clearInterval(timer);
  }, [drawerOpen, refreshSessions]);

  // 模型目录 + 斜杠命令：accessor 连上后取一次（RPC 服务已在通道上注册）。
  const [modelProviders, setModelProviders] = useState<ModelProviderLight[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommandLight[]>([]);
  useEffect(() => {
    if (!accessor) {
      setModelProviders([]);
      return;
    }
    let cancelled = false;
    accessor.modelSelectionService
      .getView()
      .then((view: unknown) => {
        if (cancelled) return;
        const typed = view as {
          providers?: Array<{
            providerId: string;
            providerName?: string;
            models?: Array<{
              modelId: string;
              config?: {
                enabled?: boolean;
                optionSpecs?: { reasoningLevel?: { options?: string[] } };
              };
            }>;
          }>;
        };
        setModelProviders(
          (typed.providers ?? []).map((provider) => ({
            providerId: provider.providerId,
            providerName: provider.providerName ?? provider.providerId,
            models: (provider.models ?? [])
              .filter((model) => model.config?.enabled !== false)
              .map((model) => ({
                modelId: model.modelId,
                reasoningLevels: model.config?.optionSpecs?.reasoningLevel?.options ?? [],
              })),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setModelProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessor]);

  useEffect(() => {
    if (!accessor || !workspacePath) {
      setSlashCommands([]);
      return;
    }
    let cancelled = false;
    accessor.commandsService
      .list({ workspacePath })
      .then((result) => {
        if (cancelled) return;
        const all = [...(result.pluginCommands ?? []), ...(result.userCommands ?? [])];
        setSlashCommands(
          all
            .filter((command) => command.enabled)
            .map((command) => ({
              name: command.name,
              description: command.description,
              prompt: command.prompt,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessor, workspacePath]);

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
        toolbar={{
          config: conversation.view.config,
          models: modelProviders,
          commands: slashCommands,
          onSwitchModel: (providerId, modelId, thought) => {
            if (!agentService || !workspace || !activeSessionId) return;
            void sendSwitchModelConfig(
              agentService,
              workspace,
              activeSessionId,
              providerId,
              modelId,
              thought,
            ).catch(() => {});
          },
          onSwitchThought: (thought) => {
            if (!agentService || !workspace || !activeSessionId) return;
            const sessionConfig = conversation.view.config;
            if (!sessionConfig) return;
            void sendSwitchModelConfig(
              agentService,
              workspace,
              activeSessionId,
              sessionConfig.provider,
              sessionConfig.model,
              thought,
            ).catch(() => {});
          },
          onSwitchMode: (mode) => {
            if (!agentService || !workspace || !activeSessionId) return;
            void sendSwitchCollaborationMode(agentService, workspace, activeSessionId, mode).catch(() => {});
          },
          pluginsUrl: serverHttpUrl(config, "/api/plugins"),
        }}
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
        workspacePath={workspace?.workspacePath ?? null}
        workspaceList={workspaceList}
        onSwitchWorkspace={handleSwitchWorkspace}
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
