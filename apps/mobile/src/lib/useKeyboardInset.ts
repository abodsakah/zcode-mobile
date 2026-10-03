import { useEffect, useState } from "react";

/**
 * 键盘视觉高度：visualViewport 与布局视口的高度差。
 * 100dvh 不随软键盘收缩（dvh 只反映地址栏的动态视口），
 * 键盘弹起时必须用 JS 把 inset 应用到壳层 padding，保证会话区随之滚动、
 * composer 贴在键盘上方。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const keyboardInset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      setInset(keyboardInset);
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
