"use client";

import type {
  WebAgentMessageMetadata,
  WebAgentResponseTimeline,
  WebAgentResponseTimelineCategory,
} from "@/app/types";
import type { ModelOption } from "@/lib/model-options";
import {
  ProviderIcon,
  getProviderFromModelId,
  stripProviderPrefix,
} from "@/components/provider-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatToolCallsSummaryResponseStats,
  type ToolCallsSummaryResponseStats,
} from "./tool-calls-summary-bar";

interface MessageModelPillProps {
  metadata: WebAgentMessageMetadata;
  modelOptions: ModelOption[];
  responseStats?: ToolCallsSummaryResponseStats | null;
}

const TIMELINE_CATEGORY_CLASS_NAMES: Record<
  WebAgentResponseTimelineCategory,
  string
> = {
  database: "bg-sky-400/80",
  inference: "bg-emerald-400/80",
  third_party: "bg-amber-400/85",
  system: "bg-zinc-400/80",
  tool: "bg-fuchsia-400/80",
};

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.round(seconds)}s`;
}

function getMetadataInferenceDurationMs(
  metadata: WebAgentMessageMetadata,
): number {
  if (
    typeof metadata.responseInferenceDurationMs === "number" &&
    Number.isFinite(metadata.responseInferenceDurationMs) &&
    metadata.responseInferenceDurationMs > 0
  ) {
    return metadata.responseInferenceDurationMs;
  }

  return (
    metadata.responseTimeline?.segments.reduce(
      (totalDurationMs, segment) =>
        segment.category === "inference"
          ? totalDurationMs + segment.durationMs
          : totalDurationMs,
      0,
    ) ?? 0
  );
}

function getMetadataResponseStats(
  metadata: WebAgentMessageMetadata,
): ToolCallsSummaryResponseStats | null {
  const usage = metadata.totalMessageUsage ?? metadata.lastStepUsage;
  const outputTokens = usage?.outputTokens ?? 0;
  const inferenceDurationSeconds =
    getMetadataInferenceDurationMs(metadata) / 1000;
  const measuredTokensPerSecond =
    outputTokens > 0 && inferenceDurationSeconds > 0
      ? outputTokens / inferenceDurationSeconds
      : null;
  const tokensPerSecond =
    typeof metadata.providerTokensPerSecond === "number" &&
    Number.isFinite(metadata.providerTokensPerSecond)
      ? metadata.providerTokensPerSecond
      : measuredTokensPerSecond;
  const costUsd =
    typeof metadata.totalMessageCost === "number" &&
    Number.isFinite(metadata.totalMessageCost) &&
    metadata.totalMessageCost >= 0
      ? metadata.totalMessageCost
      : null;

  if (tokensPerSecond === null && costUsd === null) {
    return null;
  }

  return {
    tokensPerSecond,
    costUsd,
    costSource: costUsd === null ? null : "gateway",
  };
}

function InlineResponseTimeline({
  timeline,
}: {
  timeline: WebAgentResponseTimeline;
}) {
  if (timeline.segments.length === 0) {
    return null;
  }

  const totalDurationMs = Math.max(
    timeline.totalDurationMs,
    timeline.segments.reduce((total, segment) => total + segment.durationMs, 0),
    1,
  );

  const timelineLabel = `Response timeline, ${formatDurationMs(totalDurationMs)} total`;

  const timelineStrip = (
    <span
      aria-label={timelineLabel}
      className="ml-1 inline-flex h-5 w-28 shrink-0 items-center rounded px-1 align-middle"
    >
      <span className="inline-flex h-2 w-full overflow-hidden rounded-full bg-muted-foreground/15">
        {timeline.segments.map((segment) => {
          const width = Math.max(
            1,
            (segment.durationMs / totalDurationMs) * 100,
          );

          return (
            <span
              key={segment.id}
              aria-hidden
              className={TIMELINE_CATEGORY_CLASS_NAMES[segment.category]}
              style={{ width: `${width}%` }}
            />
          );
        })}
      </span>
    </span>
  );

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>{timelineStrip}</TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div className="font-medium text-foreground">
            Response timeline · {formatDurationMs(totalDurationMs)}
          </div>
          <div className="grid gap-1">
            {timeline.segments.map((segment) => (
              <div
                key={segment.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2"
              >
                <span
                  className={`size-2 rounded-full ${TIMELINE_CATEGORY_CLASS_NAMES[segment.category]}`}
                />
                <span className="truncate">
                  {segment.label}
                  {segment.measured === false ? " (inferred)" : ""}
                </span>
                <span className="tabular-nums">
                  {formatDurationMs(segment.durationMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact pill shown on hover below an assistant message to indicate which
 * model produced the response.
 *
 * - Normal turn: shows the model display name.
 * - Variant turn: shows the variant label; tooltip reveals the resolved model.
 * - When the gateway reports a cost, the cumulative USD cost is rendered
 *   next to the model name.
 */
export function MessageModelPill({
  metadata,
  modelOptions,
  responseStats,
}: MessageModelPillProps) {
  const {
    selectedModelId,
    modelId: resolvedModelId,
    inferenceRoute,
    inferenceProfileName,
    totalMessageCost,
  } = metadata;

  if (!selectedModelId && !resolvedModelId) {
    return null;
  }

  const selectedOption = selectedModelId
    ? modelOptions.find((o) => o.id === selectedModelId)
    : undefined;
  const resolvedOption = resolvedModelId
    ? modelOptions.find((o) => o.id === resolvedModelId)
    : undefined;

  const option = selectedOption ?? resolvedOption;
  const displayLabel =
    option?.shortLabel ?? option?.label ?? selectedModelId ?? resolvedModelId;

  if (!displayLabel) {
    return null;
  }

  const provider =
    option?.provider ??
    getProviderFromModelId(selectedModelId ?? resolvedModelId ?? "");

  const shortLabel = option
    ? (option.shortLabel ?? stripProviderPrefix(option.label, provider))
    : displayLabel;

  const isVariant = selectedOption?.isVariant ?? false;
  const metadataResponseStats = getMetadataResponseStats(metadata);
  const mergedResponseStats: ToolCallsSummaryResponseStats | null =
    responseStats || metadataResponseStats
      ? {
          tokensPerSecond:
            responseStats?.tokensPerSecond ??
            metadataResponseStats?.tokensPerSecond ??
            null,
          costUsd:
            responseStats?.costUsd ?? metadataResponseStats?.costUsd ?? null,
          costSource:
            responseStats?.costSource ??
            metadataResponseStats?.costSource ??
            null,
        }
      : null;
  const responseStatSegments =
    formatToolCallsSummaryResponseStats(mergedResponseStats);

  // For variants, tooltip shows the underlying model that actually ran.
  // When cost is available we also surface it in the tooltip so the exact
  // value is visible even if the compact display rounds.
  const tooltipParts: string[] = [];
  if (isVariant && resolvedModelId && resolvedModelId !== selectedModelId) {
    tooltipParts.push(resolvedOption?.label ?? resolvedModelId);
  }
  if (
    typeof totalMessageCost === "number" &&
    Number.isFinite(totalMessageCost) &&
    totalMessageCost >= 0
  ) {
    tooltipParts.push(
      `Cost: ${(totalMessageCost as number).toFixed(6)} (gateway)`,
    );
  }
  if (inferenceRoute === "user") {
    tooltipParts.push(
      `Inference: ${inferenceProfileName ? `User profile (${inferenceProfileName})` : "User profile"}`,
    );
  } else if (inferenceRoute === "gateway") {
    tooltipParts.push("Inference: Vercel AI Gateway");
  }

  const pill = (
    <span className="inline-flex max-w-[460px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground/80">
      <ProviderIcon provider={provider} className="size-3 shrink-0" />
      <span className="truncate">{shortLabel}</span>
      {responseStatSegments.map((segment) => (
        <span key={segment} className="inline-flex items-center gap-1">
          <span aria-hidden className="text-muted-foreground/30">
            ·
          </span>
          <span className="tabular-nums">{segment}</span>
        </span>
      ))}
      {metadata.responseTimeline && (
        <InlineResponseTimeline timeline={metadata.responseTimeline} />
      )}
    </span>
  );

  if (tooltipParts.length === 0) {
    return pill;
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" align="start">
        <span className="text-xs whitespace-pre-line">
          {tooltipParts.join("\n")}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
