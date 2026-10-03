import type { ZCodeSessionInfo } from "@zcode/shared";
import { useState } from "react";
import { clearStoredServerConfig } from "../lib/serverConfig.js";
import type { WorkspaceTarget } from "../lib/workspace.js";

function formatRelativeTime(timestampMs: number): string {
  const deltaMs = Date.now() - timestampMs;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestampMs).toLocaleDateString();
}

function PhaseDot({ session }: { session: ZCodeSessionInfo }) {
  if (session.status !== "running") return null;
  return <span className="size-1.5 shrink-0 rounded-full bg-success animate-pulse" aria-hidden="true" />;
}

interface SessionDrawerProps {
  open: boolean;
  sessions: ZCodeSessionInfo[] | null;
  loading: boolean;
  error: string | null;
  activeSessionId: string | null;
  serverOrigin: string;
  /** 当前生效的 workspace 路径（用户选择或服务器默认）；未知时为 null。 */
  workspacePath: string | null;
  /** 服务器提供的项目列表（与桌面侧栏一致），点按即切换。 */
  workspaceList: WorkspaceTarget[];
  onSwitchWorkspace: (path: string) => void;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onNewChat: () => void;
}

/** 会话抽屉：底部弹层（bottom sheet），列出服务器会话，支持新建聊天与切换项目。 */
export function SessionDrawer({
  open,
  sessions,
  loading,
  error,
  activeSessionId,
  serverOrigin,
  workspacePath,
  workspaceList,
  onSwitchWorkspace,
  onClose,
  onOpenSession,
  onNewChat,
}: SessionDrawerProps) {
  const [switching, setSwitching] = useState(false);
  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* 面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        className={`absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-2xl border-t border-card-border bg-background transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-ui-lg font-medium">Sessions</h2>
          <button
            type="button"
            aria-label="Close sessions"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface active:bg-surface-hover"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-card px-3.5 py-3 text-ui-base text-foreground hover:bg-surface active:bg-surface-hover"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {error ? (
            <p className="break-words py-3 text-ui-sm text-destructive">{error}</p>
          ) : null}
          {loading && !sessions ? (
            <p className="py-3 text-ui-sm text-foreground-subtle">Loading…</p>
          ) : null}
          {sessions && sessions.length === 0 && !error ? (
            <p className="py-3 text-ui-sm text-foreground-subtle">No sessions yet.</p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {(sessions ?? []).map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(session.sessionId)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3.5 py-3 text-left ${
                      isActive ? "bg-card" : "hover:bg-surface active:bg-surface-hover"
                    }`}
                  >
                    <PhaseDot session={session} />
                    <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
                      {session.title || "Untitled"}
                    </span>
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="shrink-0 border-t border-card-border px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
            {switching ? (
              <div className="space-y-1">
                <p className="px-1 pb-1 text-ui-xs text-foreground-subtlest">Projects</p>
                <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                  {workspaceList.map((entry) => {
                    const current = entry.workspacePath === workspacePath;
                    return (
                      <li key={entry.workspacePath}>
                        <button
                          type="button"
                          onClick={() => {
                            setSwitching(false);
                            onSwitchWorkspace(entry.workspacePath);
                          }}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left active:bg-surface-hover ${
                            current ? "bg-card" : ""
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
                            {entry.label ?? entry.workspacePath}
                          </span>
                          {current ? (
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4 shrink-0 text-foreground"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 13l4 4L19 7"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={() => setSwitching(false)}
                  className="h-10 w-full rounded-xl border border-card-border bg-card text-ui-sm font-medium text-foreground-subtle active:bg-surface-hover"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="break-all text-ui-xs text-foreground-subtlest">
                  {workspaceList.find((entry) => entry.workspacePath === workspacePath)?.label ??
                    workspacePath ??
                    "Workspace unknown"}
                </p>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftPath("");
                      setSwitching(true);
                    }}
                    className="rounded-lg px-2 py-1.5 text-ui-xs font-medium text-foreground-subtle active:bg-surface-hover"
                  >
                    Switch project
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearStoredServerConfig();
                      window.location.reload();
                    }}
                    className="rounded-lg px-2 py-1.5 text-ui-xs text-foreground-subtlest active:bg-surface-hover"
                  >
                    Change server
                  </button>
                </div>
                <p className="break-all text-center text-ui-xs text-foreground-subtlest/60">
                  {serverOrigin}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
