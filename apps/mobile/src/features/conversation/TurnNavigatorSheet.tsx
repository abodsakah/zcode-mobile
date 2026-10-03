/**
 * Turn navigator, mobile adaptation of packages/ui/src/v4/ConversationTurnNavigator.tsx.
 *
 * The desktop rail is a hover-driven HoverCard column that is only visible at
 * ≥864px container width (ConversationTurnNavigator.tsx:144), i.e. never on a
 * phone. The mobile adaptation keeps the two core behaviors and swaps the
 * affordances: tap-to-reveal instead of hover, and a bottom sheet instead of
 * the popover — one entry per turn with the same user/assistant previews the
 * desktop HoverCard shows, and tapping an entry jumps the timeline to that
 * turn (desktop scrollToQuery's turn-level equivalent).
 */

import { memo } from "react";
import { XIcon } from "./icons.js";
import type { TurnGroup } from "./turnGroups.js";

export interface TurnNavigatorItem {
  key: string;
  index: number;
  userPreview: string;
  assistantPreview: string;
  running: boolean;
}

export function buildTurnNavigatorItems(groups: readonly TurnGroup[]): TurnNavigatorItem[] {
  return groups.map((group, index) => {
    const realUserInput = group.userInputs.find((row) => row.origin === "realUser");
    const anyInput = group.userInputs[0];
    const userPreview =
      (realUserInput ?? anyInput)?.text.replaceAll(/\s+/gu, " ").trim() ||
      group.backgroundResultTitle ||
      `Turn ${index + 1}`;
    const lastText = group.assistantTexts.at(-1);
    const assistantPreview = lastText
      ? lastText.text.replaceAll(/\s+/gu, " ").trim() || "…"
      : group.isRunning
        ? "working…"
        : "no reply text";
    return { key: group.key, index, userPreview, assistantPreview, running: group.isRunning };
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface TurnNavigatorSheetProps {
  open: boolean;
  items: readonly TurnNavigatorItem[];
  activeTurnKey: string | null;
  onClose: () => void;
  onJump: (turnKey: string) => void;
}

export const TurnNavigatorSheet = memo(function TurnNavigatorSheet({
  open,
  items,
  activeTurnKey,
  onClose,
  onJump,
}: TurnNavigatorSheetProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label="Conversation turns">
      <button
        type="button"
        aria-label="Close turn list"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20"
      />
      <div className="relative flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <p className="text-ui-base font-medium text-foreground">Turns</p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-foreground-subtle active:bg-surface-hover"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {items.map((item) => {
            const active = item.key === activeTurnKey;
            return (
              <button
                key={item.key}
                type="button"
                data-testid={`v4-turn-navigator-item-${item.key}`}
                data-turn-key={item.key}
                data-active={active ? "true" : "false"}
                onClick={() => onJump(item.key)}
                className={`mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-hover ${
                  active ? "bg-surface" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0 font-mono text-ui-xs text-foreground-subtlest">
                  {String(item.index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-sm font-medium text-foreground">
                    {truncate(item.userPreview, 120)}
                  </span>
                  <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                    {truncate(item.assistantPreview, 160)}
                  </span>
                </span>
                {item.running ? (
                  <span
                    className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-foreground-subtle"
                    aria-label="running"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
