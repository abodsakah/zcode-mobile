import { useEffect, useState } from "react";
import { WorkflowArtifactChips } from "./WorkflowArtifactChips.js";
import type { MobileWorkflowNotification } from "./workflowDigestsModel.js";

/**
 * 后台 workflow 通知行的移动端形态（桌面 WorkflowNotificationToolRow 的收窄）：
 *
 * - 桌面走 ToolLayout（工具卡语法 + 折叠持久化）；移动端没有工具卡体系，这里画一条
 *   自带的「kind 词 · run 名」行 + 内建展开体（tap 即开，产品默认折叠与桌面一致）。
 * - 「工作流失败」由 kind 词说出，错误详情在展开体——不走「这次调用坏了」的失败装置，
 *   也不设 running shimmer（桌面同一条注释：shimmer 语义是「正在干活」）。
 * - 升级行三态按活投影联查翻转（waiting / answered / 中性 asked），不闪不 shimmer。
 * - 等待时长在没有事件流时也照走（停驻的 run 恰恰不发事件）：30s 喂一次「现在」。
 */

const INLINE_PREVIEW_MAX_LENGTH = 160;

/** 折叠成单行概要：换行折成空格，超长截断（桌面 toInlinePreview 同一条规则）。 */
function toInlinePreview(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return "";
  return collapsed.length > INLINE_PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, INLINE_PREVIEW_MAX_LENGTH)}…`
    : collapsed;
}

function waitedLabel(askedAt: number | undefined, now: number): string | undefined {
  if (askedAt === undefined) return undefined;
  const waitedSeconds = Math.max(0, Math.floor((now - askedAt) / 1000));
  const minutes = Math.floor(waitedSeconds / 60);
  if (minutes < 1) return "Waiting for your answer";
  if (minutes < 60) return `Waiting for your answer for ${minutes} min`;
  return `Waiting for your answer for ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const TERMINAL_KIND_LABEL: Record<"completed" | "errored" | "stopped", string> = {
  completed: "Workflow completed",
  errored: "Workflow errored",
  stopped: "Workflow stopped",
};

const STOP_REASON_LABEL: Record<"user" | "model" | "provider" | "interrupted" | "superseded", string> = {
  user: "by you",
  model: "by the agent",
  provider: "model error",
  interrupted: "process exited",
  superseded: "superseded",
};

const ESCALATION_KIND_LABEL: Record<"waiting" | "answered" | "asked", string> = {
  waiting: "Subagent is waiting for an answer",
  answered: "Subagent question answered",
  asked: "Subagent asked a question",
};

export function WorkflowNotificationRow({
  notification,
  onOpenRun,
  onOpenArtifact,
  openRunLabel,
}: {
  notification: MobileWorkflowNotification;
  /** 联接得到的打开详情回调；缺席时展开体内不渲染「打开运行详情」。 */
  onOpenRun?: (runId: string) => void;
  onOpenArtifact?: (runId: string, artifactId: string) => void;
  /** 宿主给的打开详情动词；缺席用「Details」。 */
  openRunLabel?: string;
}) {
  const { meta } = notification;
  const [open, setOpen] = useState(false);
  // 等待时长要在没有事件流时也照走（停驻的 run 恰恰不发事件）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isEscalation = meta.kind === "escalation";
  const isStall = meta.kind === "stall";

  let kindLabel: string;
  if (isEscalation) {
    kindLabel =
      notification.waiting === undefined
        ? ESCALATION_KIND_LABEL.asked
        : notification.waiting
          ? ESCALATION_KIND_LABEL.waiting
          : ESCALATION_KIND_LABEL.answered;
  } else if (isStall) {
    kindLabel = "Workflow waiting on the model";
  } else if (meta.status === "stopped" && meta.stopReason !== undefined) {
    kindLabel = `${TERMINAL_KIND_LABEL[meta.status]} · ${STOP_REASON_LABEL[meta.stopReason]}`;
  } else {
    kindLabel = TERMINAL_KIND_LABEL[meta.status];
  }

  const primaryText =
    meta.kind === "escalation" ? toInlinePreview(meta.question) || notification.runName : notification.runName;

  // 展开门：终态看 artifact/error/result，升级恒有问题正文，stall 恒有等待事实。
  const hasDetails =
    isEscalation || isStall ? true : meta.error !== undefined ? true : Boolean(meta.result);

  return (
    <div data-testid="chat-workflow-notification-row">
      <button
        type="button"
        aria-expanded={hasDetails ? open : undefined}
        onClick={hasDetails ? () => setOpen((value) => !value) : undefined}
        className={`flex w-full min-w-0 items-center gap-2 px-1 py-1.5 text-left ${hasDetails ? "active:bg-surface" : ""}`}
      >
        <span aria-hidden className="shrink-0 text-ui-sm text-foreground-subtlest">
          {isEscalation ? "❓" : isStall ? "⏳" : "⚙"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-ui-sm text-foreground-subtle">{kindLabel}</span>
          <span className="block truncate text-ui-base text-foreground">{primaryText}</span>
        </span>
        {meta.kind === "terminal" && meta.artifacts !== undefined && meta.artifacts.length > 0 ? (
          <WorkflowArtifactChips
            artifacts={meta.artifacts}
            {...(meta.artifactsTruncated === undefined ? {} : { truncated: meta.artifactsTruncated })}
            onOpenArtifact={
              onOpenArtifact === undefined
                ? undefined
                : (artifactId) => onOpenArtifact(notification.runId, artifactId)
            }
          />
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="space-y-2 px-1 pb-2">
          {meta.kind === "escalation" ? (
            <>
              <p className="whitespace-pre-wrap break-words rounded-lg border border-card-border bg-surface px-3 py-2 text-ui-base leading-5 text-foreground">
                {meta.question}
              </p>
              {meta.context !== undefined ? (
                <p className="whitespace-pre-wrap break-words rounded-lg border border-card-border bg-surface px-3 py-2 text-ui-sm leading-5 text-foreground-subtle">
                  {meta.context}
                </p>
              ) : null}
              {waitedLabel(meta.askedAt, now) ? (
                <p className="text-ui-sm text-foreground-subtle">{waitedLabel(meta.askedAt, now)}</p>
              ) : null}
            </>
          ) : null}
          {meta.kind === "stall" ? (
            <>
              <p className="whitespace-pre-wrap break-words rounded-lg border border-card-border bg-surface px-3 py-2 text-ui-base leading-5 text-foreground">
                {`The workflow has been waiting on the model for ${Math.max(1, Math.round(meta.sinceMs / 60_000))} min.`}
              </p>
              {meta.reason !== undefined ? (
                <p className="text-ui-sm text-foreground-subtle">
                  <span className="text-foreground-subtlest">Retry reason </span>
                  {meta.reason}
                </p>
              ) : null}
              {meta.cap !== undefined ? (
                <p className="text-ui-sm text-foreground-subtle">
                  <span className="text-foreground-subtlest">Current fan-out </span>
                  {meta.cap}
                </p>
              ) : null}
            </>
          ) : null}
          {meta.kind === "terminal" && meta.error !== undefined ? (
            <p className="whitespace-pre-wrap break-words rounded-lg border border-destructive/40 bg-surface px-3 py-2 text-ui-base leading-5 text-foreground">
              {meta.error}
            </p>
          ) : null}
          {meta.kind === "terminal" && meta.error === undefined && meta.result ? (
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-card-border bg-surface px-3 py-2 text-ui-base leading-5 text-foreground">
              {meta.result}
            </p>
          ) : null}
          {onOpenRun ? (
            <button
              type="button"
              className="text-ui-sm text-foreground-subtle underline underline-offset-2"
              onClick={() => onOpenRun(notification.runId)}
            >
              {openRunLabel ?? "Details"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
