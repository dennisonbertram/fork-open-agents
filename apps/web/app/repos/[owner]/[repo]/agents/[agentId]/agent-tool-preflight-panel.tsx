"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useAgentToolPreflight,
  type AgentToolPreflightPredictedState,
  type AgentToolPreflightToolkit,
} from "./use-agent-tool-preflight";

export interface AgentToolPreflightPanelProps {
  agentId: string;
  /**
   * Toolkit slugs configured on the agent, known synchronously from the
   * agent's own config (so skeleton row count has no layout shift while
   * the preflight fetch is in flight).
   */
  configuredSlugs: string[];
}

// ---- Copy (plain language — never show a raw toolkit slug) -----------------

const CONNECT_HREF = "/settings/composio";

const STATE_LABEL: Record<AgentToolPreflightPredictedState, string> = {
  ready: "Ready",
  blocked_by_repo_policy: "Blocked by repo policy",
  not_connected: "Not connected",
  auth_expired: "Auth expired",
  runtime_mode_incompatible: "Unavailable in this runtime mode",
  composio_unreachable: "Composio unreachable",
};

const STATE_CHIP_CLASS: Record<AgentToolPreflightPredictedState, string> = {
  ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocked_by_repo_policy:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  not_connected: "border-border bg-muted/40 text-muted-foreground",
  auth_expired:
    "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  runtime_mode_incompatible: "border-border bg-muted/40 text-muted-foreground",
  composio_unreachable:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function policyReasonCopy(
  policyReason: AgentToolPreflightToolkit["policyReason"],
): string {
  if (policyReason === "not_in_repo_allowlist") {
    return "this toolkit is not in the repository's allowlist";
  }
  // "repo_policy_blocked" — the denylist rule.
  return "this toolkit is on the repository's denylist";
}

function ToolkitStatusChip({
  predictedState,
}: {
  predictedState: AgentToolPreflightPredictedState;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-medium",
        STATE_CHIP_CLASS[predictedState],
      )}
    >
      {STATE_LABEL[predictedState]}
    </Badge>
  );
}

function ToolkitActionLink({
  toolkit,
}: {
  toolkit: AgentToolPreflightToolkit;
}) {
  switch (toolkit.predictedState) {
    case "not_connected":
      return (
        <Link
          href={CONNECT_HREF}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Connect
        </Link>
      );
    case "auth_expired":
      return (
        <Link
          href={CONNECT_HREF}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Reconnect
        </Link>
      );
    case "blocked_by_repo_policy":
      return (
        <Link
          href={CONNECT_HREF}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Settings → repo tools
        </Link>
      );
    default:
      return null;
  }
}

function ToolkitRow({ toolkit }: { toolkit: AgentToolPreflightToolkit }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{toolkit.slug}</p>
        {toolkit.predictedState === "blocked_by_repo_policy" && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Blocked because {policyReasonCopy(toolkit.policyReason)}.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ToolkitStatusChip predictedState={toolkit.predictedState} />
        <ToolkitActionLink toolkit={toolkit} />
      </div>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, index) => (
        <div
          // biome-ignore lint: index is a stable key for a fixed-length skeleton list
          key={index}
          data-preflight-skeleton-row=""
          className="flex items-center justify-between gap-2 px-4 py-2.5"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * "Next run: tool availability" panel — agent detail page entry point
 * (#802). Loads on mount, calls the preflight endpoint with the agent's
 * configured toolkit slugs, and renders one row per toolkit with a
 * text-labeled status chip and, where actionable, a single action link.
 */
export function AgentToolPreflightPanel({
  agentId,
  configuredSlugs,
}: AgentToolPreflightPanelProps) {
  const { data, error, isLoading, mutate } = useAgentToolPreflight(agentId);

  if (configuredSlugs.length === 0) {
    return (
      <section className="rounded-md border border-border">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Next run: tool availability</h2>
        </div>
        <div className="px-4 py-4 text-sm text-muted-foreground">
          No tools configured for this agent.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Next run: tool availability</h2>
      </div>

      {error ? (
        <div className="px-4 py-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            Could not load tool availability for this agent.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => mutate()}
          >
            Retry
          </Button>
        </div>
      ) : isLoading || !data ? (
        <SkeletonRows count={configuredSlugs.length} />
      ) : (
        <>
          {data.toolkits.some(
            (toolkit) => toolkit.predictedState === "composio_unreachable",
          ) && (
            <div className="border-b border-border bg-amber-500/5 px-4 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Composio unreachable — predicted status could not be
                confirmed for any toolkit below.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => mutate()}
              >
                Retry
              </Button>
            </div>
          )}
          <div className="divide-y divide-border">
            {data.toolkits.map((toolkit) => (
              <ToolkitRow key={toolkit.slug} toolkit={toolkit} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
