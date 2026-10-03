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

/** 状态药丸：色底 + 色字，一眼读出结果；running 叠加脉冲。 */
const SUBAGENT_BADGE_CLASSES: Record<SubagentRow["status"], string> = {
  running: "bg-brand/10 text-brand",
  success: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-surface text-foreground-subtle",
};

const SUBAGENT_DOT_CLASSES: Record<SubagentRow["status"], string> = {
  running: "bg-brand animate-pulse",
  success: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-foreground-subtlest",
};

function WorkingDots() {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-label="working">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1 animate-bounce rounded-full bg-brand"
          style={{ animationDelay: `${index * 150}ms`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  );
}

export interface AgentSpawnRowProps {
  /** 无父工具行可见的独立 spawn 行。 */
  row: SubagentRow;
  onOpen: (row: SubagentRow) => void;
}

export const AgentSpawnRow = memo(function AgentSpawnRow({ row, onOpen }: AgentSpawnRowProps) {
  const running = row.status === "running";
  const preview = row.summaryText.trim() ? firstLinePreview(row.summaryText) : "—";
  return (
    <button
      type="button"
      data-row-id={row.rowId}
      data-testid={testId(TID_V4_ROW, String(row.rowId))}
      data-subagent-type={row.subagentType}
      data-subagent-status={row.status}
      onClick={() => onOpen(row)}
      className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left active:bg-surface-hover ${
        running ? "border-brand/30" : "border-card-border border-dashed"
      }`}
    >
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
          running ? "bg-brand/10 text-brand" : "bg-surface text-foreground-subtle"
        }`}
      >
        <BotIcon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-ui-sm font-medium text-foreground">
            {row.subagentType}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-px text-ui-xs font-medium ${SUBAGENT_BADGE_CLASSES[row.status]}`}
          >
            {SUBAGENT_STATUS_LABELS[row.status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">{preview}</span>
      </span>
      {running ? <WorkingDots /> : null}
      <span
        className={`size-1.5 shrink-0 rounded-full ${SUBAGENT_DOT_CLASSES[row.status]}`}
        aria-label={SUBAGENT_STATUS_LABELS[row.status]}
      />
      <ChevronRightIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
    </button>
  );
});
