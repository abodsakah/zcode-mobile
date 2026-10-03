import { useEffect, type ReactNode } from "react";

/**
 * 轻量 bottom sheet —— 桌面 popover/弹窗的移动端同位物（port 规则：hover → sheet）。
 *
 * - 背景遮罩点击 / Escape（硬件键盘）/ 头部 ✕ 关闭；
 * - 面板 max 70dvh，内容区滚动；底部自带 env(safe-area-inset-bottom) 内边距；
 * - 不引第三方库，position: fixed 直接渲染（移动壳层级简单，无 portal 冲突）。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col justify-end"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
      />
      <div className="relative flex max-h-[70dvh] flex-col overflow-hidden rounded-t-2xl border-t border-card-border bg-background shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-card-border px-4 py-2.5">
          <h2 className="text-ui-base font-medium text-foreground">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 flex size-8 items-center justify-center rounded-full text-foreground-subtle active:bg-hover"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
              <path
                d="M18 6 6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {children}
        </div>
      </div>
    </div>
  );
}
