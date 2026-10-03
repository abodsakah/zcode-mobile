/**
 * Full-screen payload / trajectory sheet for tool calls and sub-agent spawns.
 *
 * Mobile adaptation of the desktop expand surfaces:
 * - ToolCallBlock's inline collapsible body (dense pane → full-screen sheet);
 * - the ModelTrajectory expanded message view
 *   (packages/ui/src/ModelTrajectoryExpandedContent.tsx): section titles come
 *   from ModelTrajectorySectionTitle.tsx, payload blocks from
 *   ModelTrajectoryExpandedContent.tsx:113-141, the error block from
 *   ModelTrajectoryErrorBlock.tsx, and payload formatting from
 *   ModelTrajectoryToolPayload.ts (ported into ./trajectoryFormat.js);
 * - the copy action adapts CopyRowAction's 1200ms check state
 *   (ConversationRowView.tsx:171-207) and ExpandableTrajectoryMessage's
 *   messageClipboardText (ModelTrajectoryExpandableMessage.tsx:326-335).
 *
 * Note: live ZCodeModelTrajectoryRecord streams are a Host-side filesystem
 * feature (packages/services/src/zcode-agent/modelTrajectory.ts reads local
 * model-io JSONL) and are not exposed on IZCodeAgentService, so the mobile
 * sheet renders the full trajectory surface available on the wire row itself:
 * complete input payload, complete output, structured display, error, timing.
 */

import { memo, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SubagentRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { CheckIcon, CircleAlertIcon, CopyIcon, XIcon } from "./icons.js";
import {
  formatClockTime,
  formatToolPayload,
  formatTrajectoryDuration,
  toolStatusLabel,
} from "./trajectoryFormat.js";

export type SheetTarget =
  | { kind: "toolCall"; row: ToolCallRow; subagent: SubagentRow | null }
  | { kind: "subagent"; row: SubagentRow };

export interface SubagentOpenHandler {
  rootSessionId: string;
  parentSessionId: string;
  childSessionId: string;
  subagentType: string;
  title: string;
}

interface ToolCallSheetProps {
  target: SheetTarget | null;
  onClose: () => void;
  /** 有 childSessionId 的 spawn 行的「打开子会话」动作；宿主不注入则不渲染入口。 */
  onOpenSubagentSession?: (target: SubagentOpenHandler) => void;
  /** 打开子会话时的父会话 id；缺省时不渲染打开入口。 */
  parentSessionId?: string | null;
  rootSessionId?: string | null;
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-card-border">
      <div className="flex h-8 items-center bg-surface px-3 font-mono text-ui-sm uppercase text-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2">{children}</div>
    </section>
  );
}

function PayloadBlock({ value, error }: { value: string; error?: boolean }) {
  if (!value) return <span className="text-ui-sm text-foreground-subtlest">—</span>;
  return (
    <pre
      className={
        error
          ? "min-w-0 whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-2 py-1.5 font-mono text-ui-sm leading-relaxed text-destructive"
          : "min-w-0 whitespace-pre-wrap break-words font-mono text-ui-sm leading-relaxed text-foreground"
      }
    >
      {value.trim()}
    </pre>
  );
}

/** CopyRowAction 的 1200ms 打勾态（ConversationRowView.tsx:171-207）移动端精简版。 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // 剪贴板写入失败静默（无宿主 telemetry 通道），保持按钮可重试。
      });
  }, [text]);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtlest active:bg-surface-hover"
    >
      {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="shrink-0 font-mono text-ui-xs uppercase text-foreground-subtlest">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-ui-sm text-foreground">
        {value}
      </span>
    </div>
  );
}

function toolDisplaySummary(row: ToolCallRow): string | null {
  const display = row.output?.display ?? row.display;
  if (!display) return null;
  switch (display.kind) {
    case "file_diff":
      return `file_diff · ${display.filePath} +${display.additions} -${display.deletions}`;
    case "cua":
      return `cua · ${display.toolName} · ${display.status}`;
    case "mcp_tool":
      return `mcp · ${display.serverName}/${display.toolName}`;
    case "task_output":
      return `task_output · ${display.retrievalStatus}`;
    case "task_stop":
      return `task_stop · ${display.taskType}`;
    case "respond_to_coordinator":
      return `respond_to_coordinator · ${display.status}`;
    case "local_agent_message":
      return `local_agent_message · ${display.status}`;
    case "bash_output":
      return `bash_output`;
    default:
      return `display · ${display.kind}`;
  }
}

function ToolCallSheetBody({ row, subagent }: { row: ToolCallRow; subagent: SubagentRow | null }) {
  const outputText = row.output?.text ?? "";
  const truncated = row.output?.truncated ?? null;
  const displaySummary = toolDisplaySummary(row);
  const inputPayload = row.input !== undefined ? formatToolPayload(row.input) : row.inputText;
  const errorPayload = row.error ? `${row.error.code}: ${row.error.message}` : null;
  const durationMs =
    typeof row.startedAt === "number" && typeof row.endedAt === "number"
      ? Math.max(0, row.endedAt - row.startedAt)
      : null;

  return (
    <>
      <SheetSection title="Summary">
        <MetadataRow label="tool" value={row.toolName} />
        <MetadataRow label="status" value={toolStatusLabel(row.status)} />
        {displaySummary ? <MetadataRow label="display" value={displaySummary} /> : null}
        {subagent ? <MetadataRow label="subagent" value={subagent.subagentType} /> : null}
        {durationMs !== null ? (
          <MetadataRow label="duration" value={formatTrajectoryDuration(durationMs)} />
        ) : null}
        {typeof row.startedAt === "number" ? (
          <MetadataRow label="started" value={formatClockTime(row.startedAt)} />
        ) : null}
        {row.progress ? (
          <MetadataRow label="progress" value={`${row.progress.bytes} bytes`} />
        ) : null}
        {row.progress?.previewLine ? (
          <MetadataRow label="preview" value={row.progress.previewLine} />
        ) : null}
      </SheetSection>
      {subagent && subagent.summaryText.trim() ? (
        <SheetSection title="Sub-agent">
          <p className="whitespace-pre-wrap break-words text-ui-sm leading-relaxed text-foreground">
            {subagent.summaryText}
          </p>
        </SheetSection>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <SheetHeading title="Input" />
        <CopyButton text={inputPayload} label="Copy input" />
      </div>
      <PayloadBlock value={inputPayload} />
      {outputText || displaySummary ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <SheetHeading title="Output" />
            <CopyButton text={outputText} label="Copy output" />
          </div>
          <PayloadBlock value={outputText} />
        </>
      ) : null}
      {truncated ? (
        <SheetSection title="Truncated">
          <MetadataRow label="totalBytes" value={String(truncated.totalBytes)} />
          <MetadataRow label="ref" value={truncated.ref} />
        </SheetSection>
      ) : null}
      {errorPayload ? (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-2 py-1.5">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 break-words font-mono text-ui-sm text-destructive">
            {errorPayload}
          </p>
        </div>
      ) : null}
    </>
  );
}

function SubagentSheetBody({
  row,
  canOpenChild,
  onOpenChild,
}: {
  row: SubagentRow;
  canOpenChild: boolean;
  onOpenChild: () => void;
}) {
  const durationMs =
    typeof row.startedAt === "number" && typeof row.endedAt === "number"
      ? Math.max(0, row.endedAt - row.startedAt)
      : null;
  return (
    <>
      <SheetSection title="Summary">
        <MetadataRow label="type" value={row.subagentType} />
        <MetadataRow label="status" value={row.status} />
        {durationMs !== null ? (
          <MetadataRow label="duration" value={formatTrajectoryDuration(durationMs)} />
        ) : null}
        {typeof row.startedAt === "number" ? (
          <MetadataRow label="started" value={formatClockTime(row.startedAt)} />
        ) : null}
      </SheetSection>
      <div className="flex items-center justify-between gap-2">
        <SheetHeading title="Report" />
        <CopyButton text={row.summaryText} label="Copy summary" />
      </div>
      <PayloadBlock value={row.summaryText} />
      {row.childSessionId ? (
        <SheetSection title="Child session">
          <MetadataRow label="childSessionId" value={row.childSessionId} />
          {canOpenChild ? (
            <button
              type="button"
              onClick={onOpenChild}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ui-sm font-medium text-foreground active:bg-surface-hover"
            >
              Open sub-agent session
            </button>
          ) : null}
        </SheetSection>
      ) : null}
    </>
  );
}

function SheetHeading({ title }: { title: string }) {
  return (
    <h3 className="px-1 font-mono text-ui-sm uppercase text-foreground-subtle">{title}</h3>
  );
}

export const ToolCallSheet = memo(function ToolCallSheet({
  target,
  onClose,
  onOpenSubagentSession,
  parentSessionId,
  rootSessionId,
}: ToolCallSheetProps) {
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 载荷可能很长：sheet 打开期间锁定背景滚动（桌面 backgroundScrollLocked 的移动等价物）。
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!target) return null;

  const title =
    target.kind === "toolCall"
      ? (target.subagent?.subagentType ?? target.row.toolName)
      : target.row.subagentType;
  const statusLabel =
    target.kind === "toolCall"
      ? toolStatusLabel(target.row.status)
      : target.row.status;

  const childRow = target.kind === "toolCall" ? target.subagent : target.row;
  // ConversationAgentToolCallRow.tsx:10-37：childSessionId + parentSessionId + handler 三者齐备才可打开。
  const canOpenChild = Boolean(
    childRow?.childSessionId && parentSessionId && onOpenSubagentSession,
  );
  const handleOpenChild = () => {
    if (!childRow?.childSessionId || !parentSessionId || !onOpenSubagentSession) return;
    onOpenSubagentSession({
      rootSessionId: rootSessionId ?? parentSessionId,
      parentSessionId,
      childSessionId: childRow.childSessionId,
      subagentType: childRow.subagentType,
      title,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2.5">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-subtle active:bg-surface-hover"
        >
          <XIcon className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-ui-base font-medium">{title}</p>
          <p className="text-ui-xs text-foreground-subtlest">{statusLabel}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-3">
        {target.kind === "toolCall" ? (
          <ToolCallSheetBody row={target.row} subagent={target.subagent} />
        ) : (
          <SubagentSheetBody
            row={target.row}
            canOpenChild={canOpenChild}
            onOpenChild={handleOpenChild}
          />
        )}
      </div>
    </div>
  );
});
