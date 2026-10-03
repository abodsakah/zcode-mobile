/**
 * Payload / duration / status formatting for the mobile conversation feature.
 *
 * Ported from the desktop ModelTrajectory family:
 * - packages/ui/src/ModelTrajectoryToolPayload.ts  (formatTrajectoryToolPayload,
 *   trajectoryToolPayloadErrorText, isErrorTextObject, isStringContentObject)
 * - packages/ui/src/ModelTrajectoryFormat.ts       (formatTrajectoryDuration)
 * plus the tool status labels carried by the previous shell message list.
 */

import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";

/** ModelTrajectoryFormat.ts:16-19. */
export function formatTrajectoryDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)}s`;
}

/**
 * "Worked for" style label, mobile-English adaptation of the desktop
 * formatConversationWorkDuration ("chat.history.workedFor").
 */
export function formatWorkDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const TOOL_STATUS_LABELS: Record<ToolCallRow["status"], string> = {
  inputStreaming: "preparing",
  pendingApproval: "waiting for approval",
  running: "running",
  success: "done",
  error: "failed",
  cancelled: "cancelled",
};

export function toolStatusLabel(status: ToolCallRow["status"]): string {
  return TOOL_STATUS_LABELS[status];
}

const TOOL_STATUS_DOT_CLASSES: Record<ToolCallRow["status"], string> = {
  inputStreaming: "bg-foreground-subtlest animate-pulse",
  pendingApproval: "bg-destructive animate-pulse",
  running: "bg-foreground animate-pulse",
  success: "bg-success",
  error: "bg-destructive",
  cancelled: "bg-foreground-subtlest",
};

export function toolStatusDotClass(status: ToolCallRow["status"]): string {
  return TOOL_STATUS_DOT_CLASSES[status];
}

export function isToolCallActive(status: ToolCallRow["status"]): boolean {
  return status === "running" || status === "inputStreaming" || status === "pendingApproval";
}

function isErrorTextObject(value: unknown): value is { type: "error-text"; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "error-text" &&
    "value" in value &&
    typeof value.value === "string"
  );
}

function isStringContentObject(value: unknown): value is { content: string } {
  return (
    typeof value === "object" && value !== null && "content" in value && typeof value.content === "string"
  );
}

/** ModelTrajectoryToolPayload.ts:56-58 — structured error wrapper → real text. */
export function toolPayloadErrorText(value: unknown): string | undefined {
  return isErrorTextObject(value) ? value.value : undefined;
}

/** ModelTrajectoryToolPayload.ts:42-54 — payload → display string. */
export function formatToolPayload(value: unknown): string {
  if (typeof value === "string") return value;
  const errorText = toolPayloadErrorText(value);
  if (errorText !== undefined) return errorText;
  if (isStringContentObject(value)) return value.content;
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** ModelTrajectoryExpandableMessage.tsx:301-311 compactPreviewValue — one-line preview. */
export function compactPreviewValue(value: unknown): string {
  if (typeof value === "string") return value.replaceAll(/\s+/gu, " ").trim() || "—";
  const errorText = toolPayloadErrorText(value);
  if (errorText !== undefined) return errorText.replaceAll(/\s+/gu, " ").trim() || "—";
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function firstLinePreview(text: string): string {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? "—";
}
