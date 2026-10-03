/**
 * composer feature 面板（mobile port of desktop v4 composer + permission flow）。
 *
 * - Composer：autogrow textarea、附件按钮占位、Send/Stop 状态机、safe-area/键盘 inset；
 * - PermissionCard + usePermissionStream + usePermissionInteractions：
 *   v4 pendingInteractions → 大按钮审批卡 → resolveInteraction RPC；
 * - BottomSheet：hover/弹层 → 移动端 sheet 的通用同位物。
 */
export { Composer, type ComposerProps, type ComposerDraftInjection } from "./Composer.js";
export { PermissionCard, type PermissionCardProps } from "./PermissionCard.js";
export { BottomSheet } from "./BottomSheet.js";
export { usePermissionStream } from "./usePermissionStream.js";
export { usePermissionInteractions } from "./usePermissionInteractions.js";
export type { UsePermissionInteractionsResult } from "./usePermissionInteractions.js";
export {
  advertisePermissionOptions,
  getPermissionOptionDisplayKind,
  resolvePermissionOptionLabel,
  shouldPreferPermissionOptionName,
  sortPermissionOptions,
} from "./permissionOptions.js";
export type {
  PermissionInteraction,
  PermissionOptionDisplayKind,
  PermissionOptionTone,
} from "./permissionOptions.js";
