/**
 * Collapsed tool-call card for the mobile timeline.
 *
 * Desktop renders tool calls through ToolCallBlock (packages/ui/src/ToolCallBlocks.js)
 * inside a Radix Collapsible; ConversationTurnGroup.tsx:374-414 and
 * ConversationAgentToolCallRow.tsx both funnel into it. ToolCallBlock is not
 * exported from @zcode/ui, so the mobile card re-implements the collapsed
 * summary surface: status dot + tool name + status label + one-line preview.
 * The "expand" side of the desktop collapsible becomes the porting rule's
 * mobile adaptation — tapping the card opens the full-screen payload sheet
 * (dense panes become full-screen sheets).
 */

import { memo } from "react";
import { TID_V4_ROW, testId } from "@zcode/shared";
import type { SubagentRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { BotIcon, ChevronRightIcon } from "./icons.js";
import {
  compactPreviewValue,
  firstLinePreview,
  isToolCallActive,
  toolStatusDotClass,
  toolStatusLabel,
} from "./trajectoryFormat.js";

export interface ToolCallCardProps {
  row: ToolCallRow;
  /** 配对的子代理 spawn（parentToolCallId 命中时由 turnGroups 注入）。 */
  subagent: SubagentRow | null;
  onOpen: (row: ToolCallRow, subagent: SubagentRow | null) => void;
}

function resolvePreview(row: ToolCallRow): string {
  const outputText = row.output?.text.trim();
  if (outputText) return firstLinePreview(outputText);
  if (row.input !== undefined) return compactPreviewValue(row.input);
  if (row.inputText.trim()) return firstLinePreview(row.inputText);
  return "—";
}

export const ToolCallCard = memo(function ToolCallCard({
  row,
  subagent,
  onOpen,
}: ToolCallCardProps) {
  const preview = resolvePreview(row);
  const running = isToolCallActive(row.status) || subagent?.status === "running";

  return (
    <button
      type="button"
      data-row-id={row.rowId}
      data-testid={testId(TID_V4_ROW, String(row.rowId))}
      data-tool-status={row.status}
      onClick={() => onOpen(row, subagent)}
      className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-card-border bg-card px-3 py-2.5 text-left active:bg-surface-hover"
    >
      {subagent ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface text-foreground-subtle">
          <BotIcon className="size-3.5" />
        </span>
      ) : (
        <span
          className={`size-1.5 shrink-0 rounded-full ${toolStatusDotClass(row.status)}`}
          aria-label={toolStatusLabel(row.status)}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-ui-sm font-medium text-foreground">
            {subagent ? subagent.subagentType : row.toolName}
          </span>
          <span className="shrink-0 text-ui-xs text-foreground-subtlest">
            {toolStatusLabel(row.status)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">{preview}</span>
      </span>
      {running ? (
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground-subtle" />
      ) : null}
      <ChevronRightIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
    </button>
  );
});
