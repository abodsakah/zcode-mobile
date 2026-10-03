/**
 * Mobile adaptation of packages/ui/src/v4/ConversationHeader.tsx.
 *
 * The desktop header is pane chrome: it renders no layout bar, only a sr-only
 * title projection (TID_V4_SESSION_TITLE, ConversationHeader.tsx:45) plus
 * floating split/close actions. Mobile has no panes and the top bar is owned
 * by the app shell (apps/mobile/src/ui/TopBar.tsx), so the ported header keeps
 * the title projection contract and the optional workspace badge line, and
 * drops the split/close pane actions entirely.
 */

import { memo } from "react";
import { TID_V4_SESSION_TITLE } from "@zcode/shared";

export interface PaneWorkspaceBadge {
  /** 展示名（workspacePath basename）。 */
  label: string;
  /** 完整路径。 */
  workspacePath: string;
  /** 远程 workspace（SSH/WSL/Docker）标识。 */
  remote: boolean;
}

export interface ConversationHeaderProps {
  /** meta.title；仅作为测试/可观测投影，不渲染占位 header。 */
  title: string;
  /** 跨 workspace 会话的归属徽标（桌面 pane badge 的移动等价物）。 */
  workspaceBadge?: PaneWorkspaceBadge;
}

function ConversationHeaderImpl({ title, workspaceBadge }: ConversationHeaderProps) {
  return (
    <>
      <span data-testid={TID_V4_SESSION_TITLE} data-title={title} className="sr-only" />
      {workspaceBadge ? (
        <div className="shrink-0 px-4 pb-1">
          <span
            data-testid="v4-pane-workspace-badge"
            data-remote={workspaceBadge.remote ? "true" : "false"}
            title={workspaceBadge.workspacePath}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-card px-2 font-mono text-ui-xs text-foreground-subtle"
          >
            <span className="truncate">{workspaceBadge.label}</span>
            {workspaceBadge.remote ? <span className="shrink-0">remote</span> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}

export const ConversationHeader = memo(ConversationHeaderImpl);
