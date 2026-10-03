import { useMemo, useState } from "react";
import { getPermissionRequestPreview } from "@zcode/shared";
import {
  advertisePermissionOptions,
  resolvePermissionOptionLabel,
  sortPermissionOptions,
  type PermissionInteraction,
} from "./permissionOptions.js";
import { BottomSheet } from "./BottomSheet.js";

/**
 * 权限确认卡（移动端 port of packages/ui/src/PermissionDialog.tsx）。
 *
 * 桌面形态是一个停在输入区的 listbox 弹层（PermissionDialog.tsx:692-924：数字序号
 * 选项 + 键盘 1/2/3、↑/↓/Tab、Enter 确认）。移动端按 port 规则重构：
 * - 大号 Approve / Deny 双主按钮（h-14 = 56px 触达），键盘交互删除；
 * - 桌面的 ToolCallBlocks 渲染族（PermissionDialog.tsx:37-40，依赖桌面 store/主题注入）
 *   折叠为「Details」bottom sheet（hover→sheet 规则；同位桌面
 *   ConversationHookDetailsAction.tsx:133-174 的 popover 详情）；预览复用
 *   @zcode/shared 的 getPermissionRequestPreview（permission-request-preview.ts:338），
 *   与桌面共享同一命令/文件解析；
 * - 选项语义/排序复用桌面裁决：option.label 是真实文案、kind 只表达按钮语义
 *   （PermissionDialog.tsx:759），排序 allowOnce→allowAlways→rejectOnce→rejectAlways
 *   →custom，fullAccess 插在 allowAlways 与 rejectOnce 之间（桌面 lib/permissionRequest.ts）；
 * - 拒绝携带反馈行的语义保持：freeText 请求开启时 Deny 提交带 trim 后反馈，
 *   Approve 不带（PermissionDialog.tsx:561-568）；
 * - 批量授权的 bash 前缀规则（桌面 readPermissionRuleScopes，PermissionDialog.tsx:93-105）
 *   收进 Details sheet 与 allowAlways 次按钮行。
 * 宿主必须以 interaction.interactionId 为 key 挂载本组件：连续权限请求要重建
 * 焦点/反馈草稿状态（桌面同理由 key={pending.interactionId} 重建，V4InteractionDialogs.tsx:327）。
 */

function ShieldIcon({ tone }: { tone: "alert" | "ok" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-5 shrink-0 ${tone === "alert" ? "text-warning" : "text-brand"}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {tone === "ok" ? (
        <path
          d="M9 12l2 2 4-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path d="M12 8v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M18 6L6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 animate-spin motion-reduce:animate-none"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 桌面 readPermissionRuleScopes 的本地版（PermissionDialog.tsx:93-105）：allowAlways 的 bash 前缀规则。 */
function readPermissionRuleScopes(
  option: PermissionInteraction["payload"]["options"][number],
): string[] {
  const scopes: string[] = [];
  for (const update of option.response?.permissionUpdates ?? []) {
    if (update.type !== "addRules" || update.behavior !== "allow") continue;
    for (const rule of update.rules) {
      if (rule.toolName.toLowerCase() !== "bash") continue;
      const content = rule.ruleContent?.trim();
      if (!content?.endsWith(":*")) continue;
      scopes.push(content.slice(0, -2));
    }
  }
  return scopes.slice(0, 5);
}

function formatDetailValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface PermissionCardProps {
  interaction: PermissionInteraction;
  /** 由 usePermissionInteractions().resolve 注入（resolveInteraction RPC）。 */
  onResolve: (
    interactionId: string,
    answer: { optionId?: string; freeText?: string },
  ) => void | Promise<unknown>;
  /** 该 interactionId 的 resolve 在途。 */
  responding?: boolean;
  /** resolve ACK 拒绝/失败信息。 */
  responseError?: string | null;
  /** 其余排队中的权限请求数。 */
  queuedCount?: number;
}

export function PermissionCard({
  interaction,
  onResolve,
  responding = false,
  responseError = null,
  queuedCount = 0,
}: PermissionCardProps) {
  const payload = interaction.payload;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const orderedOptions = useMemo(
    () => sortPermissionOptions(advertisePermissionOptions(payload)),
    [payload],
  );
  const preview = useMemo(
    () =>
      getPermissionRequestPreview({
        title: payload.toolName,
        description: payload.summary,
        kind: payload.toolName,
        raw: payload.detail,
      }),
    [payload.detail, payload.summary, payload.toolName],
  );

  const approveOption = useMemo(
    () =>
      orderedOptions.find((option) => resolvePermissionOptionLabel(option).tone === "approve") ??
      null,
    [orderedOptions],
  );
  const denyOption = useMemo(
    () =>
      orderedOptions.find((option) => resolvePermissionOptionLabel(option).tone === "deny") ?? null,
    [orderedOptions],
  );
  const extraOptions = useMemo(
    () => orderedOptions.filter((option) => option !== approveOption && option !== denyOption),
    [approveOption, denyOption, orderedOptions],
  );

  const respond = (option: (typeof orderedOptions)[number]) => {
    if (responding) return;
    const tone = resolvePermissionOptionLabel(option).tone;
    const trimmedFeedback = feedback.trim();
    // 桌面语义（PermissionDialog.tsx:561-568）：只有拒绝类选项携带反馈行草稿。
    const answer =
      tone === "deny" && trimmedFeedback
        ? { optionId: option.optionId, freeText: trimmedFeedback }
        : { optionId: option.optionId };
    void onResolve(interaction.interactionId, answer);
  };

  return (
    <section
      aria-label="Tool permission requested"
      aria-busy={responding || undefined}
      className="mx-4 mb-1 overflow-hidden rounded-2xl border-2 border-brand/40 bg-card shadow-lg"
    >
      {/* 头部：醒目卡片标题（桌面 chat.permission.title 的移动端直出文案）。 */}
      <header className="flex items-center gap-2.5 border-b border-card-border px-4 py-3">
        <ShieldIcon tone="alert" />
        <div className="min-w-0 flex-1">
          <p className="text-ui-base font-semibold text-foreground">Permission required</p>
          <p className="truncate text-ui-sm text-foreground-subtle">
            <span className="font-mono">{payload.toolName}</span>
            {payload.origin?.kind === "subagent" ? (
              <span className="text-foreground-subtlest">
                {" "}
                · subagent {payload.origin.agentType}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="shrink-0 rounded-full border border-card-border px-3 py-1.5 text-ui-sm text-foreground-subtle active:bg-hover"
          aria-haspopup="dialog"
        >
          Details
        </button>
      </header>

      {/* 摘要 + 一眼可读的预览（命令 / 文件路径）。 */}
      <div className="space-y-2 px-4 py-3">
        {payload.summary ? (
          <p className="whitespace-pre-wrap break-words text-ui-base leading-5 text-foreground">
            {payload.summary}
          </p>
        ) : null}
        {preview.command ? (
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2.5 py-2 font-mono text-ui-sm text-foreground">
            {preview.command}
          </p>
        ) : null}
        {preview.filePaths.length > 0 ? (
          <ul className="space-y-0.5">
            {preview.filePaths.map((filePath) => (
              <li key={filePath} className="truncate font-mono text-ui-sm text-foreground-subtle">
                {filePath}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 主按钮：Approve / Deny（取排序后首个同类选项；文案与其真实语义一致——
          仅 allowAlways 时大按钮会显示「Always allow」而非误标「Approve」）。
          缺失一侧（如只有 deny 选项）时单侧占满。 */}
      <div className="flex gap-2.5 px-4 pb-3">
        {approveOption ? (
          <button
            type="button"
            data-permission-option-kind={resolvePermissionOptionLabel(approveOption).kind}
            disabled={responding}
            onClick={() => respond(approveOption)}
            className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-success text-ui-xl font-semibold text-background active:opacity-80 disabled:opacity-60"
          >
            {responding ? <SpinnerIcon /> : <CheckIcon />}
            {resolvePermissionOptionLabel(approveOption).label}
          </button>
        ) : null}
        {denyOption ? (
          <button
            type="button"
            data-permission-option-kind={resolvePermissionOptionLabel(denyOption).kind}
            disabled={responding}
            onClick={() => respond(denyOption)}
            className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-destructive text-ui-xl font-semibold text-background active:opacity-80 disabled:opacity-60"
          >
            {responding ? <SpinnerIcon /> : <CrossIcon />}
            {resolvePermissionOptionLabel(denyOption).label}
          </button>
        ) : null}
      </div>

      {/* 次要选项：always-allow / 自定义 / fullAccess（桌面序号选项的移动端降级）。 */}
      {extraOptions.length > 0 ? (
        <div className="space-y-1 border-t border-card-border px-3 py-2">
          {extraOptions.map((option) => {
            const { label, tone, kind } = resolvePermissionOptionLabel(option);
            const scopes = tone === "approve" ? readPermissionRuleScopes(option) : [];
            return (
              <button
                key={option.optionId}
                type="button"
                data-permission-option-kind={kind}
                disabled={responding}
                onClick={() => respond(option)}
                className="flex min-h-11 w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-ui-base text-foreground active:bg-hover disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{label}</span>
                  {scopes.length > 0 ? (
                    <span className="mt-0.5 block break-all font-mono text-ui-xs text-foreground-subtlest">
                      {scopes.join(" · ")}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 反馈行：payload.freeText=true 时随 Deny 提交（桌面 chat.permission.feedback 同位）。 */}
      {payload.freeText === true && denyOption ? (
        <div className="border-t border-card-border px-4 py-2.5">
          <label className="mb-1 block text-ui-sm text-foreground-subtle">
            Feedback (sent with Deny)
          </label>
          <textarea
            value={feedback}
            rows={2}
            maxLength={4096}
            disabled={responding}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Tell the agent what to do instead…"
            className="w-full resize-none rounded-xl bg-surface px-3 py-2 text-mobile-input-safe leading-6 text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-hover disabled:opacity-60"
          />
        </div>
      ) : null}

      {responseError ? (
        <p
          role="alert"
          className="border-t border-card-border px-4 py-2 text-ui-sm text-destructive"
        >
          {responseError}
        </p>
      ) : null}

      {queuedCount > 0 ? (
        <p className="border-t border-card-border px-4 py-2 text-ui-xs text-foreground-subtlest">
          +{queuedCount} more permission {queuedCount === 1 ? "request" : "requests"} waiting
        </p>
      ) : null}

      <BottomSheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Request details"
      >
        <dl className="space-y-3 text-ui-sm">
          <div>
            <dt className="text-foreground-subtle">Tool</dt>
            <dd className="break-all font-mono text-foreground">{payload.toolName}</dd>
          </div>
          <div>
            <dt className="text-foreground-subtle">Summary</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">{payload.summary}</dd>
          </div>
          {payload.toolCallId ? (
            <div>
              <dt className="text-foreground-subtle">Tool call</dt>
              <dd className="break-all font-mono text-foreground-subtle">{payload.toolCallId}</dd>
            </div>
          ) : null}
          {preview.command ? (
            <div>
              <dt className="text-foreground-subtle">Command</dt>
              <dd className="whitespace-pre-wrap break-all rounded-lg bg-surface px-2.5 py-2 font-mono text-foreground">
                {preview.command}
              </dd>
            </div>
          ) : null}
          {preview.filePaths.length > 0 ? (
            <div>
              <dt className="text-foreground-subtle">Files ({preview.filePaths.length})</dt>
              <dd>
                <ul className="space-y-1">
                  {preview.filePaths.map((filePath) => (
                    <li key={filePath} className="break-all font-mono text-foreground">
                      {filePath}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {orderedOptions.map((option) => {
            const scopes = readPermissionRuleScopes(option);
            if (scopes.length === 0) return null;
            return (
              <div key={option.optionId}>
                <dt className="text-foreground-subtle">
                  Rules granted by “{resolvePermissionOptionLabel(option).label}”
                </dt>
                <dd>
                  <ul className="space-y-1">
                    {scopes.map((scope) => (
                      <li key={scope} className="break-all font-mono text-foreground">
                        {scope}:*
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            );
          })}
          {payload.detail !== undefined && payload.detail !== null ? (
            <div>
              <dt className="mb-1 text-foreground-subtle">Raw payload</dt>
              <dd>
                <details>
                  <summary className="cursor-pointer select-none text-brand">Show JSON</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2.5 py-2 font-mono text-ui-xs text-foreground-subtle">
                    {formatDetailValue(payload.detail)}
                  </pre>
                </details>
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-4 flex items-center gap-1.5 text-ui-xs text-foreground-subtlest">
          <ShieldIcon tone="ok" />
          Approve runs this tool once. “Always allow” grants a persistent rule.
        </p>
      </BottomSheet>
    </section>
  );
}
