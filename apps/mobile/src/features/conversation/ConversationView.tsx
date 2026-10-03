/**
 * Mobile ConversationView — the single-column port of the v4 conversation
 * timeline (packages/ui/src/v4/ConversationTimeline.tsx + ConversationTurnGroup
 * + ConversationAgentToolCallRow + ConversationHeader + ConversationTurnNavigator).
 *
 * What carries over from the desktop timeline:
 * - rows enter as the CLI-authored ConversationRow[] projection (same wire
 *   shape desktop consumes; mobile keeps its own ConversationChannel reducer);
 * - turn groups are the render unit, ordered by product turn;
 * - bottom-anchored auto-follow with a "back to bottom" round button
 *   (ConversationTimeline.tsx:128-158 ConversationBackToBottomButton,
 *   data-testid TID_V4_TIMELINE / TID_V4_TIMELINE_BOTTOM preserved);
 * - the running-turn live tick (ConversationTimeline.tsx:98
 *   RUNNING_WORK_DURATION_TICK_MS = 1000ms) drives "Working for X" labels.
 *
 * Deliberate mobile simplifications (desktop capabilities that depend on
 * stores/modules not exported from @zcode/ui are re-implemented or dropped):
 * - no @tanstack/react-virtual windowing — the mobile app does not declare the
 *   dependency and the single-column renderer targets phone-scale sessions;
 *   scroll anchoring is the plain follow-to-bottom of the previous mobile
 *   MessageList (NEAR_BOTTOM_PX threshold kept);
 * - no find/highlight, share-selection, composer mask, scroll-memory or
 *   loadOlder windowing (the mobile ConversationChannel always holds a tail
 *   window and has no history pagination command wired);
 * - hover-gated actions become always-visible compact rows; the turn
 *   navigator rail becomes a tap-to-open bottom sheet; tool-call expansion
 *   becomes a full-screen payload sheet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TID_V4_TIMELINE, TID_V4_TIMELINE_BOTTOM } from "@zcode/shared";
import type { ConversationRow, SubagentRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationViewState } from "../../lib/conversationChannel.js";
import { ArrowDownIcon } from "./icons.js";
import { ConversationHeader, type ConversationHeaderProps } from "./ConversationHeader.js";
import { ConversationTurnGroup } from "./ConversationTurnGroup.js";
import type { SheetTarget, SubagentOpenHandler } from "./ToolCallSheet.js";
import { ToolCallSheet } from "./ToolCallSheet.js";
import { TurnNavigatorSheet, buildTurnNavigatorItems } from "./TurnNavigatorSheet.js";
import { buildTurnGroups } from "./turnGroups.js";

const NEAR_BOTTOM_PX = 120;
const RUNNING_WORK_DURATION_TICK_MS = 1000;

export interface ConversationViewProps {
  view: ConversationViewState;
  /** 已提交但尚未被 ACK 吸收的乐观文本（沿袭 mobile MessageList 的 pendingSends）。 */
  pendingSends: string[];
  sendError: string | null;
  /** 递增信号：发送/聚焦时把会话区钉回底部。 */
  scrollSignal: number;
  /** 当前会话 id；注入后 spawn 行的 sheet 才会显示「打开子会话」入口。 */
  sessionId?: string | null;
  /** 子代理下钻：桌面 onOpenSubagentSession 的移动宿主入口（mobile v1 无侧栏，宿主自行路由）。 */
  onOpenSubagentSession?: (target: SubagentOpenHandler) => void;
  /** 跨 workspace 会话的归属徽标（可选）。 */
  workspaceBadge?: ConversationHeaderProps["workspaceBadge"];
}

function isStreamingTextRow(row: ConversationRow | undefined): boolean {
  return (
    (row?.kind === "assistantText" && row.state === "streaming") ||
    (row?.kind === "reasoning" && row.state === "streaming")
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-card px-3.5 py-2.5 text-ui-base text-foreground">
        {text}
      </div>
    </div>
  );
}

export function ConversationView({
  view,
  pendingSends,
  sendError,
  scrollSignal,
  sessionId = null,
  onOpenSubagentSession,
  workspaceBadge,
}: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [backToBottomVisible, setBackToBottomVisible] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [navigatorOpen, setNavigatorOpen] = useState(false);

  // 活动轮 live 时长 tick（对齐桌面 RUNNING_WORK_DURATION_TICK_MS）。
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anyRunning = useMemo(
    () => view.rows.some((row) => row.kind === "turnHeader" && row.state === "running") ||
      view.rows.some(
        (row) =>
          (row.kind === "assistantText" || row.kind === "reasoning") && row.state === "streaming",
      ) ||
      view.rows.some((row) => row.kind === "subagent" && row.status === "running"),
    [view.rows],
  );
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), RUNNING_WORK_DURATION_TICK_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  const turnGroups = useMemo(() => buildTurnGroups(view.rows), [view.rows]);
  const navigatorItems = useMemo(() => buildTurnNavigatorItems(turnGroups), [turnGroups]);
  const activeTurnKey = useMemo(() => {
    const running = turnGroups.find((group) => group.isRunning);
    return running?.key ?? turnGroups.at(-1)?.key ?? null;
  }, [turnGroups]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pinned = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    pinnedRef.current = pinned;
    setBackToBottomVisible(!pinned);
  }, []);

  const handleBackToBottom = useCallback(() => {
    pinnedRef.current = true;
    setBackToBottomVisible(false);
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [view.rows, pendingSends.length, scrollToBottom]);

  useEffect(() => {
    if (scrollSignal > 0) {
      pinnedRef.current = true;
      setBackToBottomVisible(false);
      scrollToBottom();
    }
  }, [scrollSignal, scrollToBottom]);

  const jumpToTurn = useCallback((turnKey: string) => {
    setNavigatorOpen(false);
    const element = scrollRef.current;
    if (!element) return;
    // 手动跳转后阅读位置交给用户；与桌面 scrollToQuery 一样解除跟随。
    pinnedRef.current = false;
    setBackToBottomVisible(true);
    const target = element.querySelector<HTMLElement>(`[data-turn-key="${turnKey}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }, []);

  const handleOpenToolCall = useCallback((row: ToolCallRow, subagent: SubagentRow | null) => {
    setSheetTarget({ kind: "toolCall", row, subagent });
  }, []);

  const handleOpenSubagent = useCallback((row: SubagentRow) => {
    setSheetTarget({ kind: "subagent", row });
  }, []);

  const closeSheet = useCallback(() => setSheetTarget(null), []);

  const working =
    (view.control?.phase === "running" || view.control?.phase === "prewarming") &&
    !isStreamingTextRow(view.rows[view.rows.length - 1]);
  const empty =
    turnGroups.length === 0 && pendingSends.length === 0 && !working && !sendError;
  const title = view.meta?.title.trim() || "Conversation";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ConversationHeader title={title} workspaceBadge={workspaceBadge} />
      <div
        ref={scrollRef}
        data-testid={TID_V4_TIMELINE}
        data-row-count={view.rows.length}
        data-render-turn-count={turnGroups.length}
        data-total-row-count={view.totalCount}
        data-following={backToBottomVisible ? "false" : "true"}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain overflow-x-hidden px-4"
      >
        {view.status === "connecting" ? (
          <div className="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
            Connecting…
          </div>
        ) : view.status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-ui-base text-destructive">Conversation unavailable</p>
            <p className="break-words text-ui-sm text-foreground-subtle">{view.errorMessage}</p>
          </div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-ui-lg font-medium text-foreground">ZCode</p>
            <p className="text-ui-sm text-foreground-subtle">Send a message to start.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 py-3">
            {turnGroups.map((group) => (
              <ConversationTurnGroup
                key={group.key}
                group={group}
                nowMs={nowMs}
                callbacks={{
                  onOpenToolCall: handleOpenToolCall,
                  onOpenSubagent: handleOpenSubagent,
                }}
              />
            ))}
            {pendingSends.map((text, index) => (
              <UserBubble key={`pending-${index}`} text={text} />
            ))}
            {working ? (
              <div className="flex items-center gap-1 py-1" aria-label="Assistant is working">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="size-1.5 animate-pulse rounded-full bg-foreground-subtle"
                    style={{ animationDelay: `${index * 200}ms` }}
                  />
                ))}
              </div>
            ) : null}
            {sendError ? (
              <p className="break-words rounded-lg bg-card px-3 py-2 text-ui-sm text-destructive">
                {sendError}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {backToBottomVisible ? (
        <button
          type="button"
          aria-label="Scroll to bottom"
          data-testid={TID_V4_TIMELINE_BOTTOM}
          onClick={handleBackToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground-subtle shadow-md active:bg-surface-hover"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      ) : null}
      {navigatorItems.length >= 2 ? (
        <button
          type="button"
          aria-label="Conversation turns"
          onClick={() => setNavigatorOpen(true)}
          className="absolute bottom-3 left-3 z-10 flex h-7 min-w-7 items-center justify-center rounded-full border border-border bg-card px-2 font-mono text-ui-xs text-foreground-subtle shadow-md active:bg-surface-hover"
        >
          {navigatorItems.length}
        </button>
      ) : null}
      <TurnNavigatorSheet
        open={navigatorOpen}
        items={navigatorItems}
        activeTurnKey={activeTurnKey}
        onClose={() => setNavigatorOpen(false)}
        onJump={jumpToTurn}
      />
      <ToolCallSheet
        target={sheetTarget}
        onClose={closeSheet}
        onOpenSubagentSession={onOpenSubagentSession}
        parentSessionId={sessionId}
        rootSessionId={sessionId}
      />
    </div>
  );
}
