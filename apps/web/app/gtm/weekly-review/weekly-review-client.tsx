"use client";

import { format, subDays } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type {
  GtmLearningContextItem,
  RunGtmWeeklyReviewResult,
} from "@/lib/gtm-weekly-review/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type GtmLearningContextResponse = {
  learnings: Array<
    Omit<GtmLearningContextItem, "updatedAt"> & { updatedAt: string }
  >;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load GTM weekly review data");
  }
  return (await response.json()) as T;
}

function defaultWeekStart() {
  return format(subDays(new Date(), 7), "yyyy-MM-dd");
}

function defaultWeekEnd() {
  return format(new Date(), "yyyy-MM-dd");
}

function statusVariant(status: string) {
  if (status === "completed" || status === "approved") {
    return "default" as const;
  }
  if (status === "partial" || status === "pending" || status === "merged") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function ReviewSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function MetricList({
  metrics,
}: {
  metrics: RunGtmWeeklyReviewResult["experimentSummaries"][number]["metricSummary"];
}) {
  if (metrics.length === 0) {
    return <span className="text-muted-foreground">No metrics</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {metrics.map((metric) => (
        <Badge key={metric.key} variant="outline">
          {metric.key}: {String(metric.value)}
        </Badge>
      ))}
    </div>
  );
}

export function ReviewResult({ result }: { result: RunGtmWeeklyReviewResult }) {
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Review run</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.experimentSummaries.length} experiments,{" "}
              {result.sourceGaps.length} source gaps,{" "}
              {result.persistedLearningIds.length} learnings persisted
            </p>
          </div>
          <Badge variant={statusVariant(result.status)}>{result.status}</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Experiments</h2>
        </div>
        {result.experimentSummaries.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No completed experiments for this window.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Experiment</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Metrics</th>
                  <th className="px-3 py-2 font-medium">Signals</th>
                </tr>
              </thead>
              <tbody>
                {result.experimentSummaries.map((experiment) => (
                  <tr
                    key={experiment.experimentId}
                    className="border-t border-border align-top"
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium">{experiment.title}</div>
                      <div className="mt-1 text-muted-foreground">
                        {experiment.hypothesis}
                      </div>
                    </td>
                    <td className="px-3 py-3">{experiment.channel}</td>
                    <td className="px-3 py-3">
                      <MetricList metrics={experiment.metricSummary} />
                    </td>
                    <td className="px-3 py-3">
                      {experiment.qualitativeSignals.length > 0
                        ? experiment.qualitativeSignals.join("; ")
                        : "No qualitative signal"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Source gaps</h2>
          </div>
          <div className="space-y-2">
            {result.sourceGaps.length === 0 ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No source gaps in this review.
              </div>
            ) : (
              result.sourceGaps.map((gap) => (
                <div
                  key={`${gap.experimentId}-${gap.sourceKind}-${gap.errorKind}`}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{gap.sourceKind}</Badge>
                    <span className="font-medium">{gap.errorKind}</span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{gap.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Next bets</h2>
          </div>
          <div className="space-y-2">
            {result.nextBets.length === 0 ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No next bets generated for this window.
              </div>
            ) : (
              result.nextBets.map((bet) => (
                <div
                  key={`${bet.title}-${bet.rationale}`}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{bet.title}</span>
                    <Badge variant={statusVariant(bet.confidence)}>
                      {bet.confidence}
                    </Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">{bet.rationale}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Learning candidates</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {result.learningCandidates.length === 0 ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No learning candidates extracted.
            </div>
          ) : (
            result.learningCandidates.map((candidate) => (
              <div
                key={candidate.candidateKey}
                className="rounded-md border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{candidate.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {candidate.summary}
                    </p>
                  </div>
                  <Badge variant={statusVariant(candidate.approvalStatus)}>
                    {candidate.approvalStatus}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{candidate.confidence}</Badge>
                  <Badge variant="outline">{candidate.redactionStatus}</Badge>
                  <Badge variant="outline">
                    {candidate.evidenceRefs.length} evidence
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export function GtmWeeklyReviewClient() {
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [weekEnd, setWeekEnd] = useState(defaultWeekEnd);
  const [reviewResult, setReviewResult] =
    useState<RunGtmWeeklyReviewResult | null>(null);
  const [running, setRunning] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<GtmLearningContextResponse>(
    "/api/gtm/weekly-review",
    fetchJson,
  );
  const learnings = data?.learnings ?? [];

  async function runReview() {
    setRunning(true);
    try {
      const response = await fetch("/api/gtm/weekly-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, weekEnd }),
      });
      if (!response.ok) {
        throw new Error("review failed");
      }
      const body = (await response.json()) as RunGtmWeeklyReviewResult;
      setReviewResult(body);
      toast.success("Weekly review completed");
      await mutate();
    } catch {
      toast.error("Failed to run weekly review");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="gtm-week-start">Week start</Label>
            <Input
              id="gtm-week-start"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-week-end">Week end</Label>
            <Input
              id="gtm-week-end"
              type="date"
              value={weekEnd}
              onChange={(event) => setWeekEnd(event.target.value)}
            />
          </div>
          <Button onClick={runReview} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Run review
          </Button>
        </div>
      </section>

      {reviewResult ? (
        <ReviewResult result={reviewResult} />
      ) : (
        <Empty className="rounded-md border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lightbulb />
            </EmptyMedia>
            <EmptyTitle>No review run selected</EmptyTitle>
            <EmptyDescription>
              Choose a week and run the review to summarize completed
              experiments, source gaps, next bets, and learning candidates.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={runReview} disabled={running} variant="outline">
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Run review
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Approved GTM learnings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active learnings available to future GTM agents.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <ReviewSkeleton />
        ) : error ? (
          <div className="rounded-md border border-border p-4 text-sm">
            Failed to load GTM learnings.
          </div>
        ) : learnings.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No approved GTM learnings yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {learnings.map((learning) => (
              <div
                key={learning.learningId}
                className="rounded-md border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">{learning.title}</h3>
                  <Badge variant={statusVariant(learning.confidence)}>
                    {learning.confidence}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {learning.summary}
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {learning.evidenceRefs.length} evidence refs
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
