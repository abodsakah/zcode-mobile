import { useCallback, useEffect, useRef, useState } from "react";
import {
  TID_V4_COMPOSER,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_STOP,
} from "@zcode/shared";
import type { SessionConfigState } from "@zcode/shared/zcode-protocol-v4";
import { useKeyboardInset } from "../../lib/useKeyboardInset.js";

/**
 * 移动端 composer（ported from packages/ui/src/v4/ConversationComposer.tsx）。
 *
 * 输入壳用原生 <textarea> 而不是桌面 LexicalChatInput，依据（本 port 的取证结论）：
 * - 桌面输入框是 12+ plugin 的桌面编辑器（LexicalChatInput.tsx:1483-1517）：
 *   KeyboardPlugin 的 Enter/快捷键提交（:509）、PromptHistoryPlugin ↑/↓ 历史（:985）、
 *   SlashCommandPlugin + MentionPlugin 的 portal 触发面板（:1502-1517）——后者依赖
 *   桌面 useChatViewActiveTaskProvider 与 CLI workspace catalog，移动壳没有这些事实源；
 * - 全文没有任何 touch/mobile 适配（grep mobile|touch|viewport 仅命中一个 CSS 类），
 *   contentEditable 在移动键盘上的 IME/自动纠正/选区滚动问题无解可依。
 *   按 port 规则「Lexical 仅在移动端表现良好时复用，否则用构造良好的 textarea」→ textarea。
 *
 * 从 ConversationComposer 移植的状态机（移动端保留的收口部分）：
 * - canSend 门禁（ConversationComposer.tsx:1128-1134：disabled/pending/有正文）；
 * - pending 时发送键换 spinner（:2094）；
 * - running + 空草稿 → Stop（:1136 showStopControl、:2064-2077 SquareIcon）；
 * - 发送成功清空、失败草稿保留在输入框（:1402-1405、:1425-1426）。
 * 桌面的附件全链路/mention/草稿持久化依赖 attachmentPut RPC 与 store，移动端 v1
 * 不具备 → 附件按钮为占位（禁用态），草稿持久化列为后续项。
 *
 * Safe-area 契约：默认 insetSafeArea=false，继承壳层的全局 env+键盘 padding
 * （src/App.tsx:86-87）。当本组件作为 bottom dock 接线（桌面同位：composer 即底坞，
 * ConversationComposer.tsx:2190）时传 insetSafeArea=true，由组件自己承担
 * padding-bottom = max(键盘 inset, env(safe-area-inset-bottom))，并移除壳层同款 padding。
 */

/** 桌面输入区高度上限同款 max-h-40 = 160px（LexicalChatInput.tsx:1449）。 */
const MAX_COMPOSER_HEIGHT_PX = 160;

/** 队列撤回等宿主侧的草稿注入（nonce 递增：同文本重复注入也要生效）。 */
export interface ComposerDraftInjection {
  text: string;
  nonce: number;
}

/** 工具条数据面（对齐桌面 composer 底行：模型 / 思考档位 / 模式 / 插件）。 */
export interface ComposerToolbarState {
  /** v4 snapshot.config：provider/model/thought/thoughtLevels/mode。 */
  config: SessionConfigState | null;
  /** 模型目录（IModelSelectionService.getView 投影）。 */
  models: Array<{
    providerId: string;
    providerName: string;
    models: Array<{ modelId: string; reasoningLevels: string[] }>;
  }> | null;
  /** 斜杠命令（ICommandsService.list 投影）：输入 "/" 时自动补全。 */
  commands: Array<{ name: string; description?: string; prompt: string }>;
  /** 宿主内建命令（/goal /new /compact…）：选中即执行动作而非插入文本。 */
  appCommands: Array<{ name: string; description?: string; run: () => void }>;
  /** 技能（ISkillsService）：面板里以 $name 呈现，选中插入 "$name "。 */
  skills: Array<{ name: string; description?: string }>;
  /** 递增信号：让 Composer 打开 Mode sheet（/mode 内建命令）。 */
  modeSheetSignal?: number;
  onSwitchModel: (providerId: string, modelId: string, thought: string) => void;
  onSwitchThought: (thought: string) => void;
  onSwitchMode: (mode: "build" | "edit" | "plan" | "yolo") => void;
  /** 服务器已安装插件列表端点（/api/plugins）；null 时 + 菜单不渲染插件。 */
  pluginsUrl: string | null;
}

interface PluginEntry {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  hue: number;
}

const MODE_OPTIONS: Array<{ value: "build" | "edit" | "plan" | "yolo"; label: string; hint: string }> = [
  { value: "build", label: "Build", hint: "Full access — edits and runs commands" },
  { value: "edit", label: "Edit", hint: "Edits files, asks before commands" },
  { value: "plan", label: "Plan", hint: "Read-only planning" },
  { value: "yolo", label: "YOLO", hint: "No approval prompts" },
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-card-border bg-background pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="flex shrink-0 items-center justify-between px-4 pb-2">
          <h3 className="text-ui-base font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-foreground-subtle active:bg-surface-hover"
          >
            <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">{children}</div>
      </div>
    </div>
  );
}

function OptionRow({
  label,
  subtitle,
  selected,
  onClick,
}: {
  label: string;
  subtitle?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left active:bg-surface-hover ${
        selected ? "bg-card" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-ui-sm ${selected ? "font-medium text-foreground" : "text-foreground"}`}>
          {label}
        </span>
        {subtitle ? (
          <span className="block truncate text-ui-xs text-foreground-subtlest">{subtitle}</span>
        ) : null}
      </span>
      {selected ? <CheckIconSmall /> : null}
    </button>
  );
}

function CheckIconSmall() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-brand" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chip({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 shrink-0 items-center gap-1 rounded-full border border-card-border bg-card px-2.5 py-1.5 text-ui-xs text-foreground-subtle active:bg-surface-hover"
    >
      {icon}
      <span className="max-w-36 truncate font-medium">{label}</span>
      <svg viewBox="0 0 24 24" className="size-3 shrink-0 opacity-60" fill="none" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 9 19h1a2 2 0 0 0 2-2V5zm0 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 15 19h-1a2 2 0 0 1-2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M12 3l7.5 4.3v8.4L12 20l-7.5-4.3V7.3L12 3zm0 0v8.6m7.5-4.3L12 11.6 4.5 7.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 已装插件列表（/api/plugins；与桌面 + 菜单同一份安装面）。 */
function PluginsSheetBody({ pluginsUrl }: { pluginsUrl: string }) {
  const [state, setState] = useState<{ loading: boolean; plugins: PluginEntry[]; error: string | null }>({
    loading: true,
    plugins: [],
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(pluginsUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ plugins?: PluginEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setState({ loading: false, plugins: data.plugins ?? [], error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ loading: false, plugins: [], error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pluginsUrl]);

  if (state.loading) {
    return <p className="px-3 py-3 text-ui-sm text-foreground-subtle">Loading plugins…</p>;
  }
  if (state.error) {
    return <p className="break-words px-3 py-3 text-ui-sm text-destructive">Failed to load plugins: {state.error}</p>;
  }
  if (state.plugins.length === 0) {
    return <p className="px-3 py-3 text-ui-sm text-foreground-subtle">No plugins installed on the desktop.</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5 pb-1">
      {state.plugins.map((plugin) => (
        <li key={plugin.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ui-sm font-bold text-white"
            style={{ background: `hsl(${plugin.hue} 45% 42%)` }}
            aria-hidden="true"
          >
            {plugin.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui-sm font-medium text-foreground">{plugin.name}</span>
            {plugin.description ? (
              <span className="line-clamp-2 block text-ui-xs leading-4 text-foreground-subtlest">
                {plugin.description}
              </span>
            ) : null}
          </span>
          {plugin.version ? (
            <span className="shrink-0 text-ui-xs text-foreground-subtlest">{plugin.version}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface ComposerProps {
  /** 无 workspace / 未连接等宿主级禁用。 */
  disabled?: boolean;
  /** 宿主侧提交在途（如 draft 首发 createSession 等待 ACK）；禁发并显示 spinner。 */
  pending?: boolean;
  /** v4 snapshot.control.canStop：turn 运行中；空草稿时显示 Stop 而不是 Send。 */
  canStop?: boolean;
  onStop?: () => void;
  /**
   * 发送正文（已 trim）。返回 Promise 时语义为权威 ACK：resolve 才清空、reject 保留
   * 草稿（对齐 ConversationComposer.tsx:1402/1425）；返回 void 走乐观清空（现壳层契约）。
   */
  onSend: (text: string) => void | Promise<void>;
  /** 聚焦输入框时上抛（宿主把会话区钉回底部）。 */
  onFocusTextArea?: () => void;
  placeholder?: string;
  /** 组件自己承担底部 safe-area/键盘 inset（默认 false = 继承壳层全局 padding）。 */
  insetSafeArea?: boolean;
  /** 宿主注入草稿（队列撤回到 composer）；每次 nonce 变化覆盖当前草稿并聚焦。 */
  draftInjection?: ComposerDraftInjection | null;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M12 19V5m0 0-6 6m6-6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 animate-spin motion-reduce:animate-none" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Composer({
  disabled = false,
  pending = false,
  canStop = false,
  onStop,
  onSend,
  onFocusTextArea,
  placeholder = "Message…",
  insetSafeArea = false,
  draftInjection = null,
  toolbar = null,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sheet, setSheet] = useState<"model" | "mode" | "plugins" | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const keyboardInset = useKeyboardInset();
  const lastInjectionNonceRef = useRef(0);

  const sessionConfig = toolbar?.config ?? null;
  const modeValue = (sessionConfig?.mode ?? "build") as "build" | "edit" | "plan" | "yolo";
  const modeOption = MODE_OPTIONS.find((option) => option.value === modeValue) ?? MODE_OPTIONS[0];
  const thoughtLevels = sessionConfig?.thoughtLevels ?? [];

  // /mode 内建命令：信号递增时自动打开 Mode sheet。
  useEffect(() => {
    if (toolbar?.modeSheetSignal) setSheet("mode");
  }, [toolbar?.modeSheetSignal]);

  // 斜杠自动补全：仅当文本以 "/" 开头且还没有空格时（与桌面 SlashCommandPlugin 同口径）。
  const slashQuery = /^\/[a-zA-Z0-9_:-]*$/.test(text) ? text.slice(1).toLowerCase() : null;
  const builtInMatches = slashQuery === null ? [] : (toolbar?.appCommands ?? []).filter((command) => command.name.toLowerCase().includes(slashQuery));
  const customMatches = slashQuery === null ? [] : (toolbar?.commands ?? []).filter((command) => command.name.toLowerCase().includes(slashQuery)).slice(0, 6);
  const skillMatches = slashQuery === null ? [] : (toolbar?.skills ?? []).filter((skill) => skill.name.toLowerCase().includes(slashQuery)).slice(0, 6);
  const slashPanelVisible =
    builtInMatches.length > 0 || customMatches.length > 0 || skillMatches.length > 0;

  const pickModel = (provider: { providerId: string }, model: { modelId: string; reasoningLevels: string[] }) => {
    setSheet(null);
    if (!sessionConfig) return;
    if (sessionConfig.provider === provider.providerId && sessionConfig.model === model.modelId) return;
    const levels = model.reasoningLevels;
    const thought = levels.includes(sessionConfig.thought)
      ? sessionConfig.thought
      : (levels[0] ?? sessionConfig.thought ?? "");
    toolbar?.onSwitchModel(provider.providerId, model.modelId, thought);
  };

  // 宿主草稿注入（队列撤回）：覆盖当前草稿并聚焦，用户直接在原文上改。
  useEffect(() => {
    if (draftInjection === null || draftInjection.nonce === lastInjectionNonceRef.current) return;
    lastInjectionNonceRef.current = draftInjection.nonce;
    setText(draftInjection.text);
    textAreaRef.current?.focus();
  }, [draftInjection]);

  const resize = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, []);

  useEffect(resize, [text, resize]);

  const hasDraft = text.trim().length > 0;
  // canSend 门禁（ConversationComposer.tsx:1128-1134 的移动端子集：无附件/路由面）。
  const canSend = !disabled && !submitting && !pending && hasDraft;
  // 旧 UI 状态机：streaming + 空草稿 → Stop（ConversationComposer.tsx:1136）。
  const showStopControl = canStop && !hasDraft && !submitting;

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || submitting || pending) return;
    setSubmitting(true);
    try {
      await onSend(trimmed);
      setText("");
    } catch {
      // 发送失败草稿保留在输入框（ConversationComposer.tsx:1425-1426），仅不清空。
    } finally {
      setSubmitting(false);
      textAreaRef.current?.focus();
    }
  }, [disabled, onSend, pending, submitting, text]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 移动端惯例：裸 Enter 换行（enterKeyHint 同步）；硬件键盘 Cmd/Ctrl+Enter 提交。
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const stop = useCallback(() => {
    if (!canStop || submitting) return;
    onStop?.();
  }, [canStop, onStop, submitting]);

  return (
    <div
      data-testid={TID_V4_COMPOSER}
      className="shrink-0 border-t border-card-border bg-background px-3 pt-2"
      style={
        insetSafeArea
          ? { paddingBottom: `max(${keyboardInset}px, env(safe-area-inset-bottom))` }
          : undefined
      }
    >
      {slashPanelVisible ? (
        <div className="relative">
          <div className="absolute bottom-1 left-0 right-0 z-10 max-h-72 overflow-y-auto rounded-xl border border-card-border bg-card py-1 shadow-2xl">
            {builtInMatches.length > 0 ? (
              <>
                <p className="px-3 pb-0.5 pt-1.5 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                  Commands
                </p>
                {builtInMatches.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    onClick={() => {
                      setText("");
                      textAreaRef.current?.focus();
                      command.run();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-surface-hover"
                  >
                    <span className="font-mono text-ui-sm font-medium text-foreground">
                      /{command.name}
                    </span>
                    {command.description ? (
                      <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">
                        {command.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </>
            ) : null}
            {customMatches.length > 0 ? (
              <>
                <p className="px-3 pb-0.5 pt-1.5 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                  Custom commands
                </p>
                {customMatches.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    onClick={() => {
                      setText(command.prompt);
                      textAreaRef.current?.focus();
                    }}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left active:bg-surface-hover"
                  >
                    <span className="font-mono text-ui-sm font-medium text-foreground">
                      /{command.name}
                    </span>
                    {command.description ? (
                      <span className="line-clamp-1 text-ui-xs text-foreground-subtlest">
                        {command.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </>
            ) : null}
            {skillMatches.length > 0 ? (
              <>
                <p className="px-3 pb-0.5 pt-1.5 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                  Skills
                </p>
                {skillMatches.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    onClick={() => {
                      setText(`$${skill.name} `);
                      textAreaRef.current?.focus();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-surface-hover"
                  >
                    <span className="font-mono text-ui-sm font-medium text-foreground">
                      ${skill.name}
                    </span>
                    {skill.description ? (
                      <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">
                        {skill.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 pb-2 pt-0.5">
        <Chip
          label={sessionConfig?.model || "Model"}
          icon={<CubeIcon />}
          onClick={() => setSheet("model")}
        />
        {thoughtLevels.length > 0 ? (
          <Chip
            label={capitalize(sessionConfig?.thought || "Thinking")}
            icon={<BrainIcon />}
            onClick={() => setSheet("model")}
          />
        ) : null}
        <Chip
          label={modeOption.label}
          icon={
            <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
              <path
                d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          }
          onClick={() => setSheet("mode")}
        />
        {toolbar?.pluginsUrl ? (
          <Chip
            label="Plugins"
            icon={<PlusIcon />}
            onClick={() => setSheet("plugins")}
          />
        ) : null}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textAreaRef}
          data-testid={TID_V4_COMPOSER_INPUT}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={onFocusTextArea}
          placeholder={placeholder}
          enterKeyHint="enter"
          autoCapitalize="sentences"
          // 16px 起步：iOS Safari 对 <16px 的输入框聚焦会整页放大（移动端硬约束，
          // 桌面 text-ui-base=14px 不适用于移动输入面）。
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl bg-card px-3 py-2.5 text-mobile-input-safe leading-6 text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-hover disabled:opacity-60"
        />
        <div className="flex shrink-0 flex-col items-center gap-1.5 pb-0.5">
          {/* 附件占位：桌面全链路依赖 useComposerAttachments 的 attachmentPut RPC，
              移动 v1 未接；保持入口可见以便接线时不改布局。 */}
          <button
            type="button"
            aria-label="Add attachment"
            title="Attachments are not available yet"
            disabled
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground-subtle disabled:text-foreground-subtlest disabled:opacity-60"
          >
            <PaperclipIcon />
          </button>
          {showStopControl ? (
            <button
              type="button"
              data-testid={TID_V4_STOP}
              aria-label="Stop"
              onClick={stop}
              disabled={disabled}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-card-border bg-surface text-foreground active:opacity-80 disabled:opacity-60"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              data-testid={TID_V4_COMPOSER_SEND}
              aria-label={submitting || pending ? "Sending…" : "Send message"}
              onClick={() => void submit()}
              disabled={!canSend}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-surface disabled:text-foreground-subtlest"
            >
              {submitting || pending ? <SpinnerIcon /> : <SendIcon />}
            </button>
          )}
        </div>
      </div>
      {sheet === "model" ? (
        <BottomSheet title="Model & thinking" onClose={() => setSheet(null)}>
          <p className="px-3 pb-1 pt-1 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
            Models
          </p>
          {(toolbar?.models ?? []).length === 0 ? (
            <p className="px-3 py-2 text-ui-sm text-foreground-subtle">
              Loading model catalog…
            </p>
          ) : null}
          {(toolbar?.models ?? []).map((provider) => (
            <div key={provider.providerId} className="pb-1">
              <p className="px-3 pb-0.5 pt-1.5 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                {provider.providerName}
              </p>
              {provider.models.map((model) => {
                const selected =
                  sessionConfig?.provider === provider.providerId &&
                  sessionConfig?.model === model.modelId;
                const levels = model.reasoningLevels;
                return (
                  <OptionRow
                    key={`${provider.providerId}:${model.modelId}`}
                    label={model.modelId}
                    subtitle={
                      levels.length > 0
                        ? `thinking: ${levels.join(" / ")}`
                        : undefined
                    }
                    selected={selected}
                    onClick={() => pickModel(provider, model)}
                  />
                );
              })}
            </div>
          ))}
          {thoughtLevels.length > 0 ? (
            <>
              <p className="px-3 pb-1 pt-3 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest">
                Thinking level
              </p>
              {thoughtLevels.map((level) => (
                <OptionRow
                  key={level}
                  label={capitalize(level)}
                  selected={sessionConfig?.thought === level}
                  onClick={() => {
                    setSheet(null);
                    if (sessionConfig && level !== sessionConfig.thought) {
                      toolbar?.onSwitchThought(level);
                    }
                  }}
                />
              ))}
            </>
          ) : null}
        </BottomSheet>
      ) : null}
      {sheet === "mode" ? (
        <BottomSheet title="Mode" onClose={() => setSheet(null)}>
          {MODE_OPTIONS.map((option) => (
            <OptionRow
              key={option.value}
              label={option.label}
              subtitle={option.hint}
              selected={modeValue === option.value}
              onClick={() => {
                setSheet(null);
                if (modeValue !== option.value) toolbar?.onSwitchMode(option.value);
              }}
            />
          ))}
        </BottomSheet>
      ) : null}
      {sheet === "plugins" && toolbar?.pluginsUrl ? (
        <BottomSheet title="Plugins" onClose={() => setSheet(null)}>
          <PluginsSheetBody pluginsUrl={toolbar.pluginsUrl} />
        </BottomSheet>
      ) : null}
    </div>
  );
}
