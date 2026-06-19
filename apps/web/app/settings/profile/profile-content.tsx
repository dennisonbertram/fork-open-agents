"use client";

import { formatTokens } from "@open-agents/shared";
import { useMemo, useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import type { DateRange } from "react-day-picker";
import { ContributionChart } from "@/components/contribution-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaderboardRank } from "@/hooks/use-leaderboard-rank";
import { useSession } from "@/hooks/use-session";
import type { AvailableModel } from "@/lib/models";
import { ProfileRank } from "./profile-rank";
import { fetcher } from "@/lib/swr";
import { formatDateOnly } from "@/lib/usage/date-range";
import {
  aggregateUsageByModel,
  displayModelId,
  estimateUsageCost,
  formatUsd,
  getCostEstimateDetail,
  mergeUsageDays,
  sumUsageRows,
  type DailyUsageRow,
  type UsageTotals,
} from "@/lib/usage/summary";
import type { UsageInsights, UsageRepositoryInsight } from "@/lib/usage/types";
import { UsageInsightsSection } from "../usage/usage-insights-section";

// ── Types ──────────────────────────────────────────────────────────────────

interface UsageResponse {
  usage: DailyUsageRow[];
  insights: UsageInsights;
  domainLeaderboard: unknown;
}

interface ModelsResponse {
  models: AvailableModel[];
}

// Gray-scale dot classes: brightest first (top rank), darkest last
const RANK_DOT_CLASSES = [
  "bg-neutral-100 dark:bg-neutral-200",
  "bg-neutral-300 dark:bg-neutral-400",
  "bg-neutral-400 dark:bg-neutral-500",
  "bg-neutral-500 dark:bg-neutral-600",
  "bg-neutral-600 dark:bg-neutral-700",
];

// ── Sub-components ─────────────────────────────────────────────────────────

function StatItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold font-mono tabular-nums">
          {value}
        </span>
      </div>
      {detail ? (
        <div className="mt-1 text-right text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

/** Ranked list with grayscale dots — used for agent split, model usage, code churn */
function RankedList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; subtext?: string }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={item.label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${RANK_DOT_CLASSES[i % RANK_DOT_CLASSES.length]}`}
            />
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top repos for sidebar ──────────────────────────────────────────────────

function TopRepos({ repos }: { repos: UsageRepositoryInsight[] }) {
  const top3 = repos.slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Top repositories
      </h3>
      <div className="space-y-2">
        {top3.map((repo) => (
          <div
            key={`${repo.repoOwner}/${repo.repoName}`}
            className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              <p className="truncate text-sm font-medium">
                {repo.repoOwner}/{repo.repoName}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                {repo.sessionCount.toLocaleString()} sessions
              </span>
              <span className="font-mono tabular-nums">
                {repo.totalLinesChanged.toLocaleString()} lines
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile sidebar (left column) ──────────────────────────────────────────

function ProfileSidebar({
  totals,
  topRepos,
  estimatedCostValue,
  estimatedCostDetail,
}: {
  totals: UsageTotals | null;
  topRepos: UsageRepositoryInsight[] | null;
  estimatedCostValue: string;
  estimatedCostDetail: string;
}) {
  if (!totals && !topRepos) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  const totalTokens = totals ? totals.inputTokens + totals.outputTokens : 0;

  return (
    <div className="space-y-5">
      {totals && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Usage
          </h3>
          <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-1 divide-y divide-border/50">
            <StatItem label="Total tokens" value={formatTokens(totalTokens)} />
            <StatItem
              label="Estimated cost"
              value={estimatedCostValue}
              detail={estimatedCostDetail}
            />
            <StatItem
              label="Messages"
              value={totals.messageCount.toLocaleString()}
            />
            <StatItem
              label="Tool calls"
              value={totals.toolCallCount.toLocaleString()}
            />
          </div>
        </div>
      )}

      {/* Top repos */}
      {topRepos && <TopRepos repos={topRepos} />}
    </div>
  );
}

function IdentityField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="truncate text-sm text-foreground">{value}</div>
    </div>
  );
}

function ProfileIdentityCard() {
  const { session, loading } = useSession();
  const { rank, loading: rankLoading } = useLeaderboardRank();

  if (loading) {
    return (
      <section className="rounded-lg border border-border/50 bg-muted/10 p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </section>
    );
  }

  if (!session?.user) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border/50 bg-muted/10 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {session.user.avatar ? (
            <Image
              src={session.user.avatar}
              alt={session.user.username}
              width={64}
              height={64}
              className="shrink-0 rounded-full"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">
              {session.user.name ?? session.user.username}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              @{session.user.username}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your profile information is synced from Vercel.
            </p>
          </div>
        </div>
        <ProfileRank rank={rank} loading={rankLoading} />
      </div>

      <div className="mt-5 grid gap-4 border-border/50 border-t pt-4 sm:grid-cols-3">
        <IdentityField label="Username" value={session.user.username} />
        <IdentityField label="Email" value={session.user.email} />
        <IdentityField label="Name" value={session.user.name} />
      </div>
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ProfileContent() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const filteredUsagePath = useMemo(() => {
    if (!dateRange?.from) return null;
    const from = formatDateOnly(dateRange.from);
    const to = formatDateOnly(dateRange.to ?? dateRange.from);
    const query = new URLSearchParams({ from, to });
    return `/api/usage?${query.toString()}`;
  }, [dateRange]);

  const {
    data: fullData,
    isLoading: isFullDataLoading,
    error: fullDataError,
  } = useSWR<UsageResponse>("/api/usage", fetcher);
  const {
    data: filteredData,
    isLoading: isFilteredDataLoading,
    error: filteredDataError,
  } = useSWR<UsageResponse>(filteredUsagePath, fetcher);
  const { data: modelsData, isLoading: isModelsLoading } =
    useSWR<ModelsResponse>("/api/models", fetcher);

  const data = filteredUsagePath ? filteredData : fullData;
  const isLoading =
    isFullDataLoading || (filteredUsagePath !== null && isFilteredDataLoading);
  const error = fullDataError ?? filteredDataError;

  const {
    totals,
    chartData,
    modelUsage,
    mainTotals,
    subagentTotals,
    costEstimate,
  } = useMemo(() => {
    const selectedUsage = data?.usage ?? [];
    const chartUsage = fullData?.usage ?? selectedUsage;
    const aggregatedModelUsage = aggregateUsageByModel(selectedUsage);
    const main = selectedUsage.filter((r) => r.agentType === "main");
    const subagent = selectedUsage.filter((r) => r.agentType === "subagent");
    return {
      totals: sumUsageRows(selectedUsage),
      chartData: mergeUsageDays(chartUsage),
      modelUsage: aggregatedModelUsage,
      mainTotals: sumUsageRows(main),
      subagentTotals: sumUsageRows(subagent),
      costEstimate: estimateUsageCost(
        aggregatedModelUsage,
        modelsData?.models ?? [],
      ),
    };
  }, [data, fullData, modelsData]);

  const mainTokens = mainTotals.inputTokens + mainTotals.outputTokens;
  const subagentTokens =
    subagentTotals.inputTokens + subagentTotals.outputTokens;
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const hasUsage = totalTokens > 0 || totals.messageCount > 0;
  const estimatedCostValue =
    costEstimate && costEstimate.pricedTokens > 0
      ? formatUsd(costEstimate.amount)
      : "—";
  const estimatedCostDetail = hasUsage
    ? getCostEstimateDetail(costEstimate, isModelsLoading)
    : "No usage yet";

  // Build ranked-list items for agent split
  const agentItems = [
    { label: "Main agent", value: formatTokens(mainTokens) },
    { label: "Subagents", value: formatTokens(subagentTokens) },
  ].filter((i) => i.value !== "0");

  // Build ranked-list items for model usage (top 5)
  const modelItems = modelUsage.slice(0, 5).map((m) => ({
    label: displayModelId(m.modelId),
    value: formatTokens(m.inputTokens + m.outputTokens),
  }));

  // Build ranked-list items for code churn
  const codeChurnItems = data?.insights
    ? [
        {
          label: "Lines added",
          value: data.insights.code.linesAdded.toLocaleString(),
        },
        {
          label: "Lines removed",
          value: data.insights.code.linesRemoved.toLocaleString(),
        },
        {
          label: "Total changed",
          value: data.insights.code.totalLinesChanged.toLocaleString(),
        },
      ]
    : [];

  const dateRangeLabel = dateRange?.from
    ? (() => {
        const fromLabel = dateRange.from.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const toDate = dateRange.to ?? dateRange.from;
        const toLabel = toDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        return fromLabel === toLabel
          ? `Activity for ${fromLabel}`
          : `${fromLabel} – ${toLabel}`;
      })()
    : null;

  const topRepos = data?.insights?.topRepositories ?? null;

  return (
    <div className="space-y-8">
      <ProfileIdentityCard />
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        {/* Left sidebar */}
        <div className="w-full shrink-0 lg:w-56">
          <ProfileSidebar
            totals={isLoading ? null : totals}
            topRepos={isLoading ? null : topRepos}
            estimatedCostValue={estimatedCostValue}
            estimatedCostDetail={estimatedCostDetail}
          />
        </div>

        {/* Right content */}
        <div className="min-w-0 flex-1 space-y-8">
          {/* Activity grid */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Activity
              </h2>
              {!dateRangeLabel && (
                <p className="text-xs text-muted-foreground">
                  last ~9 months of daily activity
                </p>
              )}
              {dateRangeLabel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 py-0 text-xs text-muted-foreground"
                  onClick={() => setDateRange(undefined)}
                >
                  {dateRangeLabel} · Clear
                </Button>
              )}
            </div>
            {isLoading ? (
              <Skeleton className="h-[96px] w-full rounded-md" />
            ) : (
              <ContributionChart
                data={chartData}
                selectedRange={dateRange}
                onSelectRange={setDateRange}
              />
            )}
          </div>

          {/* Usage breakdown — ranked lists in a grid */}
          {isLoading ? (
            <div className="grid gap-6 sm:grid-cols-3">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              Failed to load usage data.
            </p>
          ) : (
            <>
              {!hasUsage && modelItems.length === 0 ? (
                <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                  No agent activity yet — start a chat to see usage.
                </div>
              ) : null}
              {(hasUsage ||
                modelItems.length > 0 ||
                codeChurnItems.length > 0) && (
                <div className="grid gap-8 sm:grid-cols-3">
                  {hasUsage && (
                    <RankedList title="Agent split" items={agentItems} />
                  )}
                  {modelItems.length > 0 && (
                    <RankedList title="Top models" items={modelItems} />
                  )}
                  {codeChurnItems.length > 0 && (
                    <RankedList title="Code churn" items={codeChurnItems} />
                  )}
                </div>
              )}

              {/* Insights */}
              {data?.insights ? (
                <UsageInsightsSection insights={data.insights} />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
