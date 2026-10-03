import type { ServerLinkState } from "../lib/ServerLink.js";

const STATUS_LABELS: Record<ServerLinkState["kind"], string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Offline",
};

function StatusDot({ state }: { state: ServerLinkState }) {
  const dotClass =
    state.kind === "online"
      ? "bg-success"
      : state.kind === "connecting"
        ? "bg-foreground-subtlest"
        : "bg-destructive";
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${dotClass}`}
      role="img"
      aria-label={STATUS_LABELS[state.kind]}
    />
  );
}

interface TopBarProps {
  title: string;
  linkState: ServerLinkState;
  onOpenDrawer: () => void;
  /** 顶栏 workflow 入口：打开全屏 WorkflowPanel；未连接时缺席（按钮不渲染）。 */
  onOpenWorkflow?: () => void;
}

function WorkflowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="14.5" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 9.5v5a2 2 0 0 0 2 2h4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="7" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}

/** 顶栏：菜单按钮（左）、会话标题（中）、workflow + 连接状态（右）。大触摸目标（44px）。 */
export function TopBar({ title, linkState, onOpenDrawer, onOpenWorkflow }: TopBarProps) {
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
      <button
        type="button"
        aria-label="Open sessions"
        onClick={onOpenDrawer}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface active:bg-surface-hover"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <h1 className="min-w-0 flex-1 truncate text-center text-ui-base font-medium">{title}</h1>
      {onOpenWorkflow ? (
        <button
          type="button"
          aria-label="Workflows and status"
          onClick={onOpenWorkflow}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface active:bg-surface-hover"
        >
          <WorkflowIcon />
        </button>
      ) : null}
      <span
        className="flex size-11 shrink-0 items-center justify-center"
        title={STATUS_LABELS[linkState.kind]}
      >
        <StatusDot state={linkState} />
      </span>
    </header>
  );
}
