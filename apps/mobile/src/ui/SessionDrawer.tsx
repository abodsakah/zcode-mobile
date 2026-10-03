import type { ZCodeSessionInfo } from "@zcode/shared";

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
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onNewChat: () => void;
}

/** 会话抽屉：底部弹层（bottom sheet），列出服务器会话，支持新建聊天。 */
export function SessionDrawer({
  open,
  sessions,
  loading,
  error,
  activeSessionId,
  serverOrigin,
  onClose,
  onOpenSession,
  onNewChat,
}: SessionDrawerProps) {
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
          <p className="mt-3 break-all text-center text-ui-xs text-foreground-subtlest">
            {serverOrigin}
          </p>
        </div>
      </div>
    </div>
  );
}
