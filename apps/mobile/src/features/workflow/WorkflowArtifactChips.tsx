import type { WorkflowRunArtifactSummary } from "@zcode/shared/zcode-protocol-v4";

/**
 * 终态通知头与 run 卡共用的产物条：小号产物药丸，≤ 3 枚 + `+N`。
 *
 * 桌面版是 WorkflowNotificationArtifactChips → WorkflowArtifactStrip（popover 承载「更多」）。
 * 移动端没有 popover 承载面，超出的条目收进点开后的 run 详情（通知行展开体 / 卡展开区），
 * 这里只保留「药丸本身」这一层：
 *
 * - 载荷缺席（批量轮 / 旧 transcript）⇒ 整块缺席；
 * - 回调缺席（联接不到、只读会话）⇒ 药丸禁用而不是消失：「这次运行交付了什么」是事实，
 *   「能不能打开」是能力。
 */

const MAX_VISIBLE_ARTIFACTS = 3;

const ARTIFACT_KIND_GLYPH: Record<WorkflowRunArtifactSummary["kind"], string> = {
  file: "📄",
  markdown: "📝",
  chart: "📈",
  table: "📊",
  metrics: "🔢",
  board: "🗂",
};

export function WorkflowArtifactChips({
  artifacts,
  truncated,
  onOpenArtifact,
}: {
  artifacts: readonly WorkflowRunArtifactSummary[];
  /** 发射侧砍过（超 8 或被过滤）——「+N」因此可能少报，用「…」而不是数字。 */
  truncated?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  if (artifacts.length === 0) return null;
  const shown = artifacts.slice(0, MAX_VISIBLE_ARTIFACTS);
  const overflowCount = artifacts.length - shown.length;
  const hasOverflow = overflowCount > 0 || truncated === true;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((artifact) => {
        const label = artifact.title ?? artifact.id;
        const chip = (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-card-border bg-surface px-2 py-0.5 text-ui-xs text-foreground-subtle">
            <span aria-hidden>{ARTIFACT_KIND_GLYPH[artifact.kind]}</span>
            <span className="truncate">{label}</span>
          </span>
        );
        return onOpenArtifact ? (
          <button
            key={artifact.id}
            type="button"
            className="max-w-full shrink-0"
            onClick={() => onOpenArtifact(artifact.id)}
          >
            {chip}
          </button>
        ) : (
          <span key={artifact.id} className="max-w-full shrink-0 opacity-70">
            {chip}
          </span>
        );
      })}
      {hasOverflow ? (
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
          {overflowCount > 0 ? `+${overflowCount}` : "…"}
        </span>
      ) : null}
    </span>
  );
}
