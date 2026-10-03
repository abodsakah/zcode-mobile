import { useCallback, useEffect, useRef, useState } from "react";
import {
  TID_V4_COMPOSER,
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_STOP,
} from "@zcode/shared";
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
}: ComposerProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const keyboardInset = useKeyboardInset();
  const lastInjectionNonceRef = useRef(0);

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
    </div>
  );
}
