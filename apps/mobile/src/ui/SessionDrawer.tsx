import type { ZCodeSessionInfo } from "@zcode/shared";
import { useState } from "react";
import { clearStoredServerConfig } from "../lib/serverConfig.js";
import type { WorkspaceTarget } from "../lib/workspace.js";

const DAY_MS = 86_400_000;

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

/** 按日历时间分组（Today / Yesterday / Previous 7 days / Earlier），组内保持原有排序。 */
function groupSessions(sessions: ZCodeSessionInfo[]): Array<{ label: string; items: ZCodeSessionInfo[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - DAY_MS;
  const startOf7Days = startOfToday - 6 * DAY_MS;
  const buckets: Array<{ label: string; items: ZCodeSessionInfo[] }> = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const session of sessions) {
    if (session.updatedAt >= startOfToday) buckets[0].items.push(session);
    else if (session.updatedAt >= startOfYesterday) buckets[1].items.push(session);
    else if (session.updatedAt >= startOf7Days) buckets[2].items.push(session);
    else buckets[3].items.push(session);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

function PhaseDot({ session }: { session: ZCodeSessionInfo }) {
  if (session.status !== "running") return null;
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M3.5 7.5c0-1.1.9-2 2-2h3.6c.6 0 1.1.2 1.5.7l1 1.2c.4.4 1 .7 1.5.7h5.4c1.1 0 2 .9 2 2v6.9c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2v-9.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
  /** 服务器提供的项目列表（与桌面侧栏一致）。 */
  workspaceList: WorkspaceTarget[];
  onSwitchWorkspace: (path: string) => void;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onNewChat: () => void;
}

/**
 * 左侧滑入侧栏（对齐桌面端 side pane）：品牌头 + 项目选择器 + 新聊天主按钮 +
 * 当前项目的会话（按时间分组）+ 连接页脚。
 */
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
  const [projectsOpen, setProjectsOpen] = useState(false);
  const currentProject = workspaceList.find((entry) => entry.workspacePath === workspacePath);
  const groups = sessions ? groupSessions(sessions) : [];

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* 遮罩：侧栏右侧 */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* 侧栏面板：左侧全高滑入 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        className={`absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col border-r border-card-border bg-background shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* 品牌头 */}
        <div className="flex shrink-0 items-center gap-2.5 pl-[max(env(safe-area-inset-left),1rem)] pr-3 pt-[max(env(safe-area-inset-top),0.875rem)]">
          <span
            className="flex size-8 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-sky-400 to-indigo-500 text-ui-sm font-bold text-white shadow-sm"
            aria-hidden="true"
          >
            Z
          </span>
          <h2 className="flex-1 text-ui-lg font-semibold tracking-tight">ZCode</h2>
          <button
            type="button"
            aria-label="Close sidebar"
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

        {/* 项目选择器：当前项目一行，点开列出服务器上全部项目（与桌面侧栏一致） */}
        <div className="shrink-0 px-3 pb-1 pt-3">
          {workspaceList.length > 0 ? (
            <div className="rounded-2xl border border-card-border bg-card">
              <button
                type="button"
                onClick={() => setProjectsOpen((value) => !value)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-surface-hover"
                aria-expanded={projectsOpen}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface">
                  <FolderIcon className="size-4.5 text-foreground-subtle" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-base font-medium text-foreground">
                    {currentProject?.label ?? "Projects"}
                  </span>
                  <span className="block text-ui-xs text-foreground-subtlest">
                    {workspaceList.length} {workspaceList.length === 1 ? "project" : "projects"}
                  </span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`size-4 shrink-0 text-foreground-subtle transition-transform duration-200 ${projectsOpen ? "rotate-180" : ""}`}
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {projectsOpen ? (
                <ul className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
                  {workspaceList.map((entry) => {
                    const current = entry.workspacePath === workspacePath;
                    return (
                      <li key={entry.workspacePath}>
                        <button
                          type="button"
                          onClick={() => {
                            setProjectsOpen(false);
                            if (!current) onSwitchWorkspace(entry.workspacePath);
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left active:bg-surface-hover ${
                            current ? "bg-surface" : ""
                          }`}
                        >
                          <FolderIcon className="size-4 shrink-0 text-foreground-subtlest" />
                          <span
                            className={`min-w-0 flex-1 truncate text-ui-sm ${
                              current ? "font-medium text-foreground" : "text-foreground-subtle"
                            }`}
                          >
                            {entry.label ?? entry.workspacePath}
                          </span>
                          {current ? <CheckIcon className="size-4 shrink-0 text-brand" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 新聊天：主行动，品牌色药丸 */}
        <div className="shrink-0 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-ui-base font-semibold text-white shadow-sm active:opacity-90"
          >
            <PlusIcon className="size-4" />
            New chat
          </button>
        </div>

        {/* 当前项目的会话列表（按时间分组） */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
          {error ? (
            <p className="break-words px-1 py-2 text-ui-sm text-destructive">{error}</p>
          ) : null}
          {loading && !sessions ? (
            <p className="px-1 py-2 text-ui-sm text-foreground-subtle">Loading…</p>
          ) : null}
          {sessions && sessions.length === 0 && !error ? (
            <p className="px-1 py-2 text-ui-sm text-foreground-subtle">No chats yet — start one above.</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} className="pb-1">
              <p className="px-1 pb-0.5 pt-2 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((session) => {
                  const isActive = session.sessionId === activeSessionId;
                  return (
                    <li key={session.sessionId}>
                      <button
                        type="button"
                        onClick={() => onOpenSession(session.sessionId)}
                        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left ${
                          isActive
                            ? "bg-card shadow-[inset_0_0_0_1px_var(--color-card-border)]"
                            : "hover:bg-surface active:bg-surface-hover"
                        }`}
                      >
                        <PhaseDot session={session} />
                        <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
                          {session.title || "Untitled"}
                        </span>
                        <span className="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* 底部：连接状态 + 更换服务器 */}
        <div className="shrink-0 border-t border-card-border px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
              <span className="truncate text-ui-xs text-foreground-subtlest">{serverOrigin}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                clearStoredServerConfig();
                window.location.reload();
              }}
              className="shrink-0 rounded-lg px-2 py-1.5 text-ui-xs text-foreground-subtle active:bg-surface-hover"
            >
              Change server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
