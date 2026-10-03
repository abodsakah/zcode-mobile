/**
 * One product turn of the mobile conversation timeline.
 *
 * Desktop source: packages/ui/src/v4/ConversationTurnGroup.tsx. That component
 * leans on desktop-only infrastructure (Radix Collapsible, hover-visible
 * MessageActions, ToolCallBlock, preview-card providers, office-mode hooks),
 * none of which is exported from @zcode/ui — so the mobile turn group is a
 * local adaptation of the same render order:
 *
 *   leading markers → user inputs → [background-result title] →
 *   work history (collapsible "Worked for X") → assistant texts →
 *   following work → tail markers
 *
 * Mobile adaptations applied:
 * - hover actions become always-visible compact rows (hover isn't a mobile
 *   gesture); the turn-level action row keeps only copy + timestamp;
 * - the desktop work-history Collapsible keeps its trigger
 *   (ConversationTurnGroup.tsx:565-610) but toggles on tap;
 * - tool cards / agent rows open the full-screen payload sheet instead of
 *   expanding inline (dense panes become full-screen sheets);
 * - reasoning blocks stay tap-to-expand disclosures
 *   (ConversationRowView.tsx ReasoningRowView: streaming/complete both
 *   default collapsed).
 */

import { memo, useEffect, useMemo, useState } from "react";
import { TID_V4_ROW, testId } from "@zcode/shared";
import type {
  SubagentRow,
  TimelineMarkerRow,
  ToolCallRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import { AgentSpawnRow } from "./AgentToolCallRow.js";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon } from "./icons.js";
import { ToolCallCard } from "./ToolCallCard.js";
import {
  resolveTurnDurationLabel,
  type TurnGroup,
  type TurnWorkItem,
} from "./turnGroups.js";

export interface TurnGroupCallbacks {
  onOpenToolCall: (row: ToolCallRow, subagent: SubagentRow | null) => void;
  onOpenSubagent: (row: SubagentRow) => void;
}

/** 引擎尾注折叠：正文只到 epilogueStart（ConversationUserInputEpilogue 的拆分口径）。 */
function splitUserInputEpilogue(
  text: string,
  epilogueStart: number | undefined,
): { body: string; epilogue: string | null } {
  if (epilogueStart === undefined || epilogueStart <= 0 || epilogueStart >= text.length) {
    return { body: text, epilogue: null };
  }
  return { body: text.slice(0, epilogueStart), epilogue: text.slice(epilogueStart) };
}

function UserBubble({ row }: { row: UserInputRow }) {
  const { body, epilogue } = splitUserInputEpilogue(row.text, row.epilogueStart);
  const [epilogueOpen, setEpilogueOpen] = useState(false);
  const isRealUser = row.origin === "realUser";
  return (
    <div className="flex flex-col items-end">
      {body.trim() ? (
        <div
          data-v4-user-input-bubble="true"
          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-ui-base ${
            isRealUser
              ? "rounded-br-md bg-card text-foreground"
              : "rounded-br-md border border-card-border bg-surface text-foreground-subtle"
          }`}
        >
          {body}
        </div>
      ) : null}
      {epilogue !== null ? (
        <div className="mt-1 w-full">
          <button
            type="button"
            onClick={() => setEpilogueOpen((current) => !current)}
            className="text-ui-xs text-foreground-subtlest underline-offset-2 active:underline"
          >
            {epilogueOpen ? "Hide engine note" : "Show engine note"}
          </button>
          {epilogueOpen ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-ui-sm text-foreground-subtle">
              {epilogue}
            </p>
          ) : null}
        </div>
      ) : null}
      {row.attachments && row.attachments.length > 0 ? (
        <div className="mt-1 flex flex-wrap justify-end gap-1">
          {row.attachments.map((attachment, index) => (
            <span
              key={`${attachment.ref}-${index}`}
              className="max-w-40 truncate rounded-full border border-border bg-surface px-2 py-0.5 text-ui-xs text-foreground-subtle"
            >
              {attachment.fileName}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningBlock({ item }: { item: Extract<TurnWorkItem, { kind: "reasoning" }> }) {
  const row = item.row;
  const [open, setOpen] = useState(false);
  if (!row.text && row.state !== "streaming") return null;
  const label =
    row.state === "streaming"
      ? "Thinking…"
      : typeof row.durationMs === "number"
        ? `Thought for ${Math.max(1, Math.ceil(row.durationMs / 1000))}s`
        : "Thought process";
  return (
    <div className="w-full" data-row-id={row.rowId}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 py-1 text-left text-ui-sm text-foreground-subtle"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </button>
      {open ? (
        <div className="ml-1 whitespace-pre-wrap break-words border-l-2 border-card-border pl-3 text-ui-sm text-foreground-subtle">
          {row.text}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactLine({ item }: { item: Extract<TurnWorkItem, { kind: "artifact" }> }) {
  const row = item.row;
  return (
    <div
      data-row-id={row.rowId}
      data-testid={testId(TID_V4_ROW, String(row.rowId))}
      className="flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-base text-foreground">{row.displayName}</p>
        <p className="text-ui-xs text-foreground-subtle">
          {row.artifactType.toUpperCase()} · {row.sizeBytes} bytes
        </p>
      </div>
    </div>
  );
}

function HookLine({ item }: { item: Extract<TurnWorkItem, { kind: "hookInvocation" }> }) {
  const row = item.row;
  const executed = row.executions.filter((execution) => execution.didExecute).length;
  if (executed === 0) return null;
  return (
    <p
      data-row-id={row.rowId}
      className="truncate text-ui-xs text-foreground-subtlest"
    >
      hooks · {row.hookEventName} · {executed}/{row.hookCount}
    </p>
  );
}

function WorkMarkerLine({ item }: { item: Extract<TurnWorkItem, { kind: "marker" }> }) {
  const marker = item.row.marker;
  if (marker.type !== "compact") return null;
  const status =
    marker.status === "success"
      ? "done"
      : marker.status === "running"
        ? "running"
        : marker.status;
  return (
    <p data-row-id={item.row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
      context compacted ({marker.origin}) · {status}
    </p>
  );
}

function LeadingMarkerLine({ row }: { row: TimelineMarkerRow }) {
  if (row.marker.type === "modelChange") {
    const from = row.marker.fromModel;
    return (
      <p data-row-id={row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
        {from ? `${from} → ` : ""}
        {row.marker.toModel}
      </p>
    );
  }
  if (row.marker.type === "forkCreated") {
    return (
      <p data-row-id={row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
        forked conversation
      </p>
    );
  }
  return null;
}

function TailMarkerLine({ row }: { row: TimelineMarkerRow }) {
  if (row.marker.type === "goalVerify") {
    return (
      <p data-row-id={row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
        goal check #{row.marker.iteration} · {row.marker.outcome}
      </p>
    );
  }
  if (row.marker.type === "forkNotice") {
    return (
      <p data-row-id={row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
        forked from parent session
      </p>
    );
  }
  if (row.marker.type === "checkpointRestored") {
    return (
      <p data-row-id={row.rowId} className="truncate text-ui-xs text-foreground-subtlest">
        checkpoint restored
      </p>
    );
  }
  return null;
}

function WorkItemRow({
  item,
  callbacks,
}: {
  item: TurnWorkItem;
  callbacks: TurnGroupCallbacks;
}) {
  switch (item.kind) {
    case "reasoning":
      return <ReasoningBlock item={item} />;
    case "toolCall":
      return (
        <ToolCallCard row={item.row} subagent={item.subagent} onOpen={callbacks.onOpenToolCall} />
      );
    case "subagent":
      return <AgentSpawnRow row={item.row} onOpen={callbacks.onOpenSubagent} />;
    case "artifact":
      return <ArtifactLine item={item} />;
    case "hookInvocation":
      return <HookLine item={item} />;
    case "marker":
      return <WorkMarkerLine item={item} />;
  }
}

/** 轮尾段的复制动作（ConversationAssistantTextActions 移动端子集：复制 + 时间戳）。 */
function AssistantCopyRow({ text, rowId, createdAt }: { text: string; rowId: number; createdAt: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Copy message"
        data-testid={`v4-copy-${rowId}`}
        onClick={handleCopy}
        className="flex size-7 items-center justify-center rounded-md text-foreground-subtlest active:bg-surface-hover"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-success" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </button>
      <span className="select-none text-ui-xs text-foreground-subtlest">
        {new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

function TurnGroupImpl({
  group,
  nowMs,
  callbacks,
}: {
  group: TurnGroup;
  nowMs: number;
  callbacks: TurnGroupCallbacks;
}) {
  // 已完成轮的工作历史默认收起；运行中保持展开（AssistantHistoryStatus 语义）。
  const [historyOpen, setHistoryOpen] = useState(group.isRunning);
  useEffect(() => {
    setHistoryOpen(group.isRunning);
  }, [group.isRunning, group.key]);

  const durationLabel = resolveTurnDurationLabel(group, nowMs);
  const hasHistory = group.history.length > 0;
  const hasTail = group.tailMarkers.length > 0;
  const hasAssistantContent =
    group.history.length > 0 ||
    group.following.length > 0 ||
    group.assistantTexts.length > 0 ||
    group.backgroundResultTitle !== null;
  const lastAssistantText = useMemo(() => {
    const terminal = group.assistantTexts.filter((row) => row.state !== "streaming");
    return terminal.at(-1) ?? null;
  }, [group.assistantTexts]);

  const workSection = (items: TurnWorkItem[]) =>
    items.map((item) => (
      <WorkItemRow key={`${item.kind}:${item.row.rowId}`} item={item} callbacks={callbacks} />
    ));

  if (!hasAssistantContent && group.userInputs.length === 0 && group.leadingMarkers.length === 0) {
    return null;
  }

  return (
    <section
      data-turn-key={group.key}
      data-turn-id={group.turnId}
      data-turn-running={group.isRunning ? "true" : "false"}
      className="flex w-full flex-col gap-3"
    >
      {group.leadingMarkers.map((row) => (
        <LeadingMarkerLine key={row.rowId} row={row} />
      ))}
      {group.userInputs.map((row) => (
        <UserBubble key={row.rowId} row={row} />
      ))}
      {group.backgroundResultTitle ? (
        <div
          data-testid={`v4-background-result-title-${group.key}`}
          className="border-b border-border/50 pb-2 text-ui-sm text-foreground-subtle"
        >
          {group.backgroundResultTitle}
        </div>
      ) : null}
      {hasHistory ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid={`v4-history-trigger-${group.key}`}
            data-history-open={String(historyOpen)}
            onClick={() => setHistoryOpen((current) => !current)}
            className="flex w-full items-center gap-1.5 border-b border-border/50 pb-2 text-left text-ui-sm text-foreground-subtle"
          >
            {historyOpen ? (
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 opacity-70" />
            )}
            <span className="truncate">
              {group.isRunning
                ? `Working for ${durationLabel ?? "…"}`
                : durationLabel
                  ? `Worked for ${durationLabel}`
                  : "Work"}
            </span>
          </button>
          {historyOpen ? workSection(group.history) : null}
        </div>
      ) : null}
      {group.assistantTexts.map((row) => (
        <div
          key={row.rowId}
          data-row-id={row.rowId}
          data-testid={testId(TID_V4_ROW, String(row.rowId))}
          className="whitespace-pre-wrap break-words text-ui-base text-foreground"
        >
          {row.text}
          {row === lastAssistantText ? (
            <AssistantCopyRow text={row.text} rowId={row.rowId} createdAt={row.createdAt} />
          ) : null}
        </div>
      ))}
      {group.following.length > 0 ? (
        <div className="flex flex-col gap-3">{workSection(group.following)}</div>
      ) : null}
      {hasTail ? (
        <div className="flex flex-col gap-1 border-t border-border/50 pt-2">
          {group.tailMarkers.map((row) => (
            <TailMarkerLine key={row.rowId} row={row} />
          ))}
        </div>
      ) : null}
      {group.isLast && group.isRunning ? (
        <div
          className="flex items-center gap-1 py-1"
          aria-label="Assistant is working"
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 animate-pulse rounded-full bg-foreground-subtle"
              style={{ animationDelay: `${index * 200}ms` }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export const ConversationTurnGroup = memo(TurnGroupImpl);
