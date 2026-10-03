/**
 * Conversation feature — mobile port of the v4 conversation rendering surface.
 *
 * Entry point: ConversationView (drop-in for the previous MessageList; same
 * ConversationViewState/pendingSends/sendError/scrollSignal inputs).
 */

export { ConversationView, type ConversationViewProps } from "./ConversationView.js";
export { ConversationHeader, type ConversationHeaderProps, type PaneWorkspaceBadge } from "./ConversationHeader.js";
export { ToolCallSheet, type SheetTarget, type SubagentOpenHandler } from "./ToolCallSheet.js";
export { ToolCallCard } from "./ToolCallCard.js";
export { AgentSpawnRow } from "./AgentToolCallRow.js";
export { TurnNavigatorSheet, buildTurnNavigatorItems, type TurnNavigatorItem } from "./TurnNavigatorSheet.js";
export {
  buildTurnGroups,
  isRowRunning,
  resolveTurnDurationLabel,
  type TurnGroup,
  type TurnWorkItem,
  type TurnWorkStatus,
} from "./turnGroups.js";
