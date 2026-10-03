import { useEffect, useState } from "react";
import {
  RUN_STATUS_DOT,
  RUN_STATUS_TEXT,
  RUN_STATUS_LABEL,
  formatElapsedLabel,
  workflowRowDisplayName,
  type MobileStatusModel,
  type MobileStatusGlance,
} from "./statusPanelModel.js";

/**
 * 一眼状态面板（桌面 ConversationStatusPanel 的移动端形态）：
 *
 * 桌面是一个 80 宽的折叠分区壳（Git / Goal / Todo / Terminals / Workflows / Agents 各自
 * Collapsible，mini 胶囊 + 面板两态 + 宽度自适应）；移动端只承载一句话能说清的事：
 * **needs-attention > running > done** 三档优先级，谁在最上谁就是这一眼的答案。
 *
 * 保留的桌面语义：
 * - 秒针只在有 running 事实时走（`useEffect` 门控，不是每帧 setNow）；
 * - 状态永远有词，绝不只靠颜色或动画（a11y）；
 * - Workflows 行不排序：顺序 = 投影 runs 序 = 启动序；
 * - 面板整卡点开 → 宿主打开全屏 WorkflowPanel。
 */

const GLANCE_LABEL: Record<MobileStatusGlance, string> = {
  attention: "Needs attention",
  running: "Running",
  done: "Done",
  idle: "Idle",
};

const GLANCE_DOT: Record<MobileStatusGlance, string> = {
  attention: "bg-destructive",
  running: "animate-pulse bg-warning motion-reduce:animate-none",
  done: "bg-success",
  idle: "border-[1.5px] border-foreground-subtlest bg-transparent",
};

export function WorkflowStatusPanel({
  model,
  onOpenFullPanel,
}: {
  model: MobileStatusModel;
  /** 面板整卡点开 → 全屏 WorkflowPanel；缺席时面板退成静态条。 */
  onOpenFullPanel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const hasTickingRow = model.runningWorkflows.some((row) => row.startedAt !== undefined);
  useEffect(() => {
    if (!hasTickingRow) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasTickingRow]);

  const longestRunningMs = model.runningWorkflows.reduce((longest, row) => {
    if (row.startedAt === undefined) return longest;
    return Math.max(longest, Math.max(0, now - row.startedAt));
  }, 0);

  const primaryLine =
    model.attention[0]?.label ??
    (longestRunningMs > 0
      ? `${formatElapsedLabel(longestRunningMs)} · ${
          model.runningWorkflows.length === 1
            ? "1 workflow in background"
            : `${model.runningWorkflows.length} workflows in background`
        }`
      : model.done.length > 0
        ? model.done[0]!.label
        : null);

  if (model.glance === "idle" && primaryLine === null) return null;

  return (
    <button
      type="button"
      data-testid="mobile-workflow-status-panel"
      data-glance={model.glance}
      onClick={onOpenFullPanel}
      className={`w-full min-w-0 rounded-xl border border-card-border bg-card px-3 py-2 text-left ${
        onOpenFullPanel ? "active:bg-surface" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${GLANCE_DOT[model.glance]}`} />
        <span className="shrink-0 text-ui-xs text-foreground-subtle">{GLANCE_LABEL[model.glance]}</span>
        <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
          {primaryLine ?? "Nothing in flight"}
        </span>
        {onOpenFullPanel ? (
          <span aria-hidden className="shrink-0 text-ui-sm text-foreground-subtlest">
            ›
          </span>
        ) : null}
      </span>
      {model.attention.length > 1 || (model.glance === "running" && longestRunningMs > 0) ? (
        <span className="mt-1 flex min-w-0 items-center gap-2 text-ui-xs text-foreground-subtlest">
          {model.glance === "running" && longestRunningMs > 0 ? (
            <span className="shrink-0 tabular-nums">{formatElapsedLabel(longestRunningMs)}</span>
          ) : null}
          {model.attention.length > 1 ? (
            <span className="min-w-0 truncate">
              {model.attention[0]!.label}
              {` · +${model.attention.length - 1} more`}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** 全屏面板内的「Workflows」分区：活动行 + 终态行，与一眼条同一份模型。 */
export function WorkflowStatusSection({ model }: { model: MobileStatusModel }) {
  const [now, setNow] = useState(() => Date.now());
  const tickingCount = model.runningWorkflows.filter((row) => row.startedAt !== undefined).length;
  useEffect(() => {
    if (tickingCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tickingCount]);

  if (model.runningWorkflows.length === 0 && model.done.length === 0) return null;
  return (
    <section data-testid="mobile-workflow-status-section">
      {model.runningWorkflows.length > 0 ? (
        <ul className="space-y-1">
          {model.runningWorkflows.map((row) => (
            <li
              key={row.runId}
              {...(row.workId ? { "data-testid": `v4-background-work-item-${row.workId}` } : {})}
              data-workflow-run-id={row.runId}
              data-work-status={row.status}
              className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-2"
            >
              <span
                aria-hidden
                className={`mt-1 size-1.5 shrink-0 rounded-full ${row.status ? RUN_STATUS_DOT[row.status] : RUN_STATUS_DOT.pending}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-ui-base leading-5 text-foreground">
                  {workflowRowDisplayName(row)}
                </span>
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs">
                  {row.status ? (
                    <>
                      <span className={`shrink-0 ${RUN_STATUS_TEXT[row.status]}`}>
                        {RUN_STATUS_LABEL[row.status]}
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground-subtlest">
                        {row.nodesSettled ?? 0}/{row.nodesTotal ?? 0} steps
                      </span>
                    </>
                  ) : null}
                  {row.startedAt !== undefined ? (
                    <span className="shrink-0 tabular-nums text-foreground-subtlest">
                      {formatElapsedLabel(Math.max(0, now - row.startedAt))}
                    </span>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {model.done.length > 0 ? (
        <ul className={`space-y-1 ${model.runningWorkflows.length > 0 ? "mt-2 border-t border-card-border pt-2" : ""}`}>
          {model.done.map((entry, index) => (
            <li key={`${entry.kind}:${entry.label}:${index}`} className="flex min-w-0 items-center gap-2 px-1 py-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">{entry.label}</span>
              <span className="shrink-0 text-ui-xs text-foreground-subtlest">{entry.outcome}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

