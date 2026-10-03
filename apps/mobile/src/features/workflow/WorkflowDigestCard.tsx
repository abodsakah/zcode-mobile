import { useState } from "react";
import { workflowRunStatusLabel } from "./statusPanelModel.js";
import { WorkflowArtifactChips } from "./WorkflowArtifactChips.js";
import type { MobileWorkflowDigest } from "./workflowDigestsModel.js";
import { RUN_STATUS_DOT, RUN_STATUS_TEXT } from "./statusPanelModel.js";

/**
 * 轮尾 run 卡的移动端形态（桌面 WorkflowRunDigest 的收窄）：
 *
 * - 桌面卡常展开阶段时间线（WorkflowTimeline 轨道 + 药丸）；移动端默认收起成单行概览，
 *   **点击整卡**展开/收起详情——「tappable cards」即本组件的交互主语。
 * - 桌面的阶段轨道、脚本药丸、Configure 弹层、⤢ 详情侧板在移动端没有承载面：详情 =
 *   展开区（当前阶段 / 子代理名单 / 产物条 / 结果或错误预览）。
 * - Stop / Resume 与桌面同门：running 可停（本地「Stopping…」态），resumable 可恢复；
 *   两个回调都缺席时按钮不渲染（点了没反应的按钮比没有更糟）。
 */

const FALLBACK_NAME = "Workflow script";
const ENDED_KIND = "Workflow ended";

function digestKindLabel(digest: MobileWorkflowDigest): string {
  const summary = digest.summary;
  if (summary === undefined) return ENDED_KIND;
  return workflowRunStatusLabel({ status: summary.status, stopReason: summary.stopReason });
}

export function WorkflowDigestCard({
  digest,
  onCancel,
  onResume,
  onOpenArtifact,
}: {
  digest: MobileWorkflowDigest;
  onCancel?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onOpenArtifact?: (runId: string, artifactId: string) => void;
}) {
  const summary = digest.summary;
  const name = digest.name ?? FALLBACK_NAME;
  const live = summary?.status === "running";
  const pendingQuestions = summary?.pendingQuestions ?? [];
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState(false);

  const stopButton =
    live && onCancel !== undefined ? (
      <button
        type="button"
        disabled={stopping}
        onClick={(event) => {
          event.stopPropagation();
          setStopping(true);
          onCancel(digest.runId);
        }}
        className="shrink-0 rounded-lg border border-card-border px-2.5 py-1 text-ui-sm text-foreground-subtle active:bg-surface disabled:opacity-50"
      >
        {stopping ? "Stopping…" : "Stop"}
      </button>
    ) : undefined;

  const resumeButton =
    summary?.resumable === true && onResume !== undefined ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onResume(digest.runId);
        }}
        className="shrink-0 rounded-lg border border-card-border px-2.5 py-1 text-ui-sm text-foreground-subtle active:bg-surface"
      >
        Resume
      </button>
    ) : undefined;

  return (
    <section
      className="w-full overflow-hidden rounded-xl border border-card-border bg-card"
      data-testid="workflow-run-digest"
      data-workflow-run-id={digest.runId}
      data-workflow-run-status={summary?.status ?? "absent"}
      aria-label={digestKindLabel(digest)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left active:bg-surface"
      >
        <span className="relative flex size-2 shrink-0" aria-hidden>
          {live ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          ) : null}
          <span
            className={`relative inline-flex size-2 rounded-full ${summary ? RUN_STATUS_DOT[summary.status] : RUN_STATUS_DOT.stopped}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base font-medium text-foreground">{name}</span>
          {summary !== undefined ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-ui-xs text-foreground-subtlest">
              <span className={`shrink-0 font-medium ${RUN_STATUS_TEXT[summary.status]}`}>
                {digestKindLabel(digest)}
              </span>
              <span className="shrink-0 tabular-nums">
                {summary.stepsSettled}/{summary.stepsTotal} steps
              </span>
              {summary.agents > 0 ? (
                <span className="shrink-0">
                  {summary.agents === 1 ? "1 agent" : `${summary.agents} agents`}
                </span>
              ) : null}
              {summary.currentPhase ? (
                <span className="min-w-0 truncate">{summary.currentPhase}</span>
              ) : null}
            </span>
          ) : (
            <span className="mt-0.5 block text-ui-xs text-foreground-subtlest">
              {digestKindLabel(digest)}
            </span>
          )}
          {/* 步骤进度条：running 时可感知推进 */}
          {summary !== undefined && summary.stepsTotal > 0 ? (
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface">
              <span
                className={`block h-full rounded-full transition-all duration-500 ${
                  live ? "bg-gradient-to-r from-brand to-success animate-pulse" : "bg-success"
                }`}
                style={{
                  width: `${Math.min(100, Math.round((summary.stepsSettled / summary.stepsTotal) * 100))}%`,
                }}
              />
            </span>
          ) : null}
        </span>
        {live ? (
          <span className="flex shrink-0 items-center gap-0.5" aria-label="working">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="size-1 animate-bounce rounded-full bg-brand"
                style={{ animationDelay: `${index * 150}ms`, animationDuration: "0.9s" }}
              />
            ))}
          </span>
        ) : null}
        {pendingQuestions.length > 0 ? (
          <span
            data-testid="workflow-digest-questions"
            className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-ui-xs font-medium text-warning"
          >
            {pendingQuestions.length === 1 ? "1 question" : `${pendingQuestions.length} questions`}
          </span>
        ) : null}
      </button>
      {expanded && summary !== undefined ? (
        <div className="space-y-2 border-t border-card-border px-3 py-2.5">
          {summary.agentNames.length > 0 ? (
            <p className="break-words text-ui-sm text-foreground-subtle">
              <span className="text-foreground-subtlest">Agents </span>
              {summary.agentNames.join(", ")}
            </p>
          ) : null}
          {summary.artifacts.length > 0 ? (
            <WorkflowArtifactChips
              artifacts={summary.artifacts}
              onOpenArtifact={
                onOpenArtifact === undefined
                  ? undefined
                  : (artifactId) => onOpenArtifact(digest.runId, artifactId)
              }
            />
          ) : null}
          {summary.resultPreview ? (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-card-border bg-surface px-3 py-2 text-ui-sm leading-5 text-foreground">
              {summary.resultPreview}
            </p>
          ) : null}
          {summary.error ? (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/40 bg-surface px-3 py-2 text-ui-sm leading-5 text-foreground">
              {summary.error}
            </p>
          ) : null}
          {stopButton || resumeButton ? (
            <div className="flex items-center gap-2">
              {stopButton}
              {resumeButton}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 设置行（桌面 WorkflowSettingsChangeRow 的收窄）：说明这次 run 的设置改了什么。 */
export function WorkflowSettingsChangeRow({ digest }: { digest: MobileWorkflowDigest }) {
  const amend = digest.settings?.amend;
  if (amend === undefined) return null;
  const parts: string[] = [];
  if (amend.subagentModel !== undefined) {
    parts.push(
      `model ${amend.subagentModel.from ?? "session default"} → ${amend.subagentModel.to ?? "session default"}`,
    );
  }
  if (amend.maxConcurrency !== undefined) {
    parts.push(
      `max concurrency ${amend.maxConcurrency.from ?? "default"} → ${amend.maxConcurrency.to ?? "default"}`,
    );
  }
  return (
    <p className="px-1 text-ui-sm text-foreground-subtle">
      Workflow settings amended{parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}
    </p>
  );
}
