import { PERMISSION_FULL_ACCESS_OPTION_ID } from "@zcode/shared/zcode-protocol-v4";
import type { PendingInteraction, PermissionRequestPayload } from "@zcode/shared/zcode-protocol-v4";

/**
 * 权限选项展示语义（v4 payload 直接消费，不再经 pendingInteractionAdapter 转旧类型）。
 *
 * 本文件是 packages/ui/src/lib/permissionRequest.ts 的本地移植（新文件规则：不改桌面），
 * 去掉了桌面独有的 preview 适配层——移动端直接用 @zcode/shared 的
 * getPermissionRequestPreview（PermissionCard.tsx）。类型对齐 v4 payload 的
 * option 形状 { optionId, label, kind, response? }（snapshot.ts permissionRequestPayloadSchema）。
 */

export type PermissionOptionDisplayKind =
  | "allowOnce"
  | "allowAlways"
  | "rejectOnce"
  | "rejectAlways"
  | "custom";

/** v4 pendingInteraction 且 payload 为 permission 的交互视图模型。 */
export type PermissionInteraction = PendingInteraction & { payload: PermissionRequestPayload };

const GENERIC_PERMISSION_OPTION_NAMES: Record<PermissionOptionDisplayKind, Set<string>> = {
  allowOnce: new Set(["allow", "allow once", "approve"]),
  allowAlways: new Set(["always allow", "allow always", "approve always"]),
  rejectOnce: new Set(["deny", "deny once", "reject", "reject once"]),
  rejectAlways: new Set(["always deny", "deny always", "always reject", "reject always"]),
  custom: new Set(),
};

function normalizeInlineText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 移植自桌面 permissionRequest.ts getPermissionOptionDisplayKind。 */
export function getPermissionOptionDisplayKind(kind: string): PermissionOptionDisplayKind {
  const normalizedKind = kind.trim().toLowerCase();
  const isAllow = normalizedKind.includes("allow") || normalizedKind.includes("approve");
  const isReject = normalizedKind.includes("reject") || normalizedKind.includes("deny");
  const isAlways = normalizedKind.includes("always");

  if (isAllow && isAlways) {
    return "allowAlways";
  }
  if (isAllow) {
    return "allowOnce";
  }
  if (isReject && isAlways) {
    return "rejectAlways";
  }
  if (isReject) {
    return "rejectOnce";
  }
  return "custom";
}

/** 移植自桌面 permissionRequest.ts shouldPreferPermissionOptionName。 */
export function shouldPreferPermissionOptionName(option: { kind: string; label: string }): boolean {
  const normalizedName = normalizeInlineText(option.label).toLowerCase();
  if (normalizedName.length === 0) {
    return false;
  }
  const displayKind = getPermissionOptionDisplayKind(option.kind);
  if (displayKind === "custom") {
    return true;
  }
  return !GENERIC_PERMISSION_OPTION_NAMES[displayKind].has(normalizedName);
}

function getPermissionOptionSortPriority(kind: string): number {
  switch (getPermissionOptionDisplayKind(kind)) {
    case "allowOnce":
      return 0;
    case "allowAlways":
      return 1;
    case "rejectOnce":
      return 2;
    case "rejectAlways":
      return 3;
    default:
      return 4;
  }
}

/**
 * 排序移植自桌面 sortPermissionOptions（permissionRequest.ts:77-95）：
 * allowOnce → allowAlways → rejectOnce → rejectAlways → custom；fullAccess 固定插在
 * allowAlways 与 rejectOnce 之间（桌面同值 1.5，保持一致的选项次序）。
 */
export function sortPermissionOptions(
  options: PermissionRequestPayload["options"],
): PermissionRequestPayload["options"] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => {
      const priorityDelta =
        (left.option.optionId === PERMISSION_FULL_ACCESS_OPTION_ID
          ? 1.5
          : getPermissionOptionSortPriority(left.option.kind)) -
        (right.option.optionId === PERMISSION_FULL_ACCESS_OPTION_ID
          ? 1.5
          : getPermissionOptionSortPriority(right.option.kind));
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.index - right.index;
    })
    .map(({ option }) => option);
}

/** 桌面 pendingInteractionAdapter.ts:63-65：fullAccess additive 选项并入可选集。 */
export function advertisePermissionOptions(
  payload: PermissionRequestPayload,
): PermissionRequestPayload["options"] {
  return payload.fullAccessOption ? [...payload.options, payload.fullAccessOption] : payload.options;
}

export type PermissionOptionTone = "approve" | "deny" | "neutral";

/**
 * 选项文案与色调。桌面 PermissionDialog.tsx:759 的裁决照搬：
 * option.name（v4 里是 label）是给用户看的真实文案，kind 只表达按钮语义——
 * 已知通用名按语义本地化，自定义名直出原文。kind 一并返回，供按钮的
 * data-permission-option-kind 标注真实语义（桌面 PermissionDialog.tsx:782 同款）。
 */
export function resolvePermissionOptionLabel(option: { kind: string; label: string }): {
  label: string;
  tone: PermissionOptionTone;
  kind: PermissionOptionDisplayKind;
} {
  const kind = getPermissionOptionDisplayKind(option.kind);
  const preferName = shouldPreferPermissionOptionName({ kind: option.kind, label: option.label });
  const label = preferName
    ? option.label
    : kind === "allowOnce"
      ? "Approve"
      : kind === "allowAlways"
        ? "Always allow"
        : kind === "rejectOnce"
          ? "Deny"
          : kind === "rejectAlways"
            ? "Always deny"
            : option.label;
  const tone: PermissionOptionTone =
    kind === "allowOnce" || kind === "allowAlways"
      ? "approve"
      : kind === "rejectOnce" || kind === "rejectAlways"
        ? "deny"
        : "neutral";
  return { label, tone, kind };
}
