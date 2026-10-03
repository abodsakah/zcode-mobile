/**
 * Agent tool-call row (sub-agent spawns) for the mobile timeline.
 *
 * Desktop source: packages/ui/src/v4/ConversationAgentToolCallRow.tsx — the
 * agent tool call renders through ToolCallBlock with an `agentSummaryAction`
 * that opens the child session in a side pane (hover target). Mobile
 * adaptation: the row opens the full-screen payload sheet (tap instead of
 * hover), the authoritative sub-agent type leads the summary line, and the
 * "open side pane" action moves into the sheet as a button
 * (SubagentOpenHandler in ./ToolCallSheet.js).
 */

import { memo } from "react";
import { TID_V4_ROW, testId } from "@zcode/shared";
import type { SubagentRow } from "@zcode/shared/zcode-protocol-v4";
import { BotIcon, ChevronRightIcon } from "./icons.js";
import { firstLinePreview } from "./trajectoryFormat.js";

const SUBAGENT_STATUS_LABELS: Record<SubagentRow["status"], string> = {
  running: "running",
  success: "done",
  failed: "failed",
  cancelled: "cancelled",
};

const SUBAGENT_DOT_CLASSES: Record<SubagentRow["status"], string> = {
  running: "bg-foreground animate-pulse",
  success: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-foreground-subtlest",
};

export interface AgentSpawnRowProps {
  /** 无父工具行可见的独立 spawn 行。 */
  row: SubagentRow;
  onOpen: (row: SubagentRow) => void;
}

export const AgentSpawnRow = memo(function AgentSpawnRow({ row, onOpen }: AgentSpawnRowProps) {
  const preview = row.summaryText.trim() ? firstLinePreview(row.summaryText) : "—";
  return (
    <button
      type="button"
      data-row-id={row.rowId}
      data-testid={testId(TID_V4_ROW, String(row.rowId))}
      data-subagent-type={row.subagentType}
      data-subagent-status={row.status}
      onClick={() => onOpen(row)}
      className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-card-border border-dashed bg-card px-3 py-2.5 text-left active:bg-surface-hover"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface text-foreground-subtle">
        <BotIcon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-ui-sm font-medium text-foreground">
            {row.subagentType}
          </span>
          <span className="shrink-0 text-ui-xs text-foreground-subtlest">
            {SUBAGENT_STATUS_LABELS[row.status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">{preview}</span>
      </span>
      <span
        className={`size-1.5 shrink-0 rounded-full ${SUBAGENT_DOT_CLASSES[row.status]}`}
        aria-label={SUBAGENT_STATUS_LABELS[row.status]}
      />
      <ChevronRightIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
    </button>
  );
});
