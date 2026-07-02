"use client";

import {
  AlertTriangle,
  FileSearch,
  GitPullRequestArrow,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type {
  GtmActivationQueueItem,
  RunGtmActivationWatcherResult,
} from "@/lib/gtm-activation/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalDecisionControls } from "../_components/approval-decision-controls";

type ActivationQueueResponse = {
  signals: Array<
    Omit<GtmActivationQueueItem, "updatedAt"> & { updatedAt: string }
  >;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load activation signals");
  }
  return (await response.json()) as T;
}

function statusVariant(status: string) {
  if (status === "high") {
    return "default" as const;
  }
  if (status === "medium" || status === "pending") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function stringFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function draftIssue(metadata: Record<string, unknown>) {
  const value = metadata.draftIssue;
  if (!value || typeof value !== "object") {
    return null;
  }
  const issue = value as Record<string, unknown>;
  return {
    title: typeof issue.title === "string" ? issue.title : "Issue draft",
    body: typeof issue.body === "string" ? issue.body : "",
  };
}

export function ActivationQueue({
  signals,
}: {
  signals: ActivationQueueResponse["signals"];
}) {
  if (signals.length === 0) {
    return (
      <Empty className="rounded-md border border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileSearch />
          </EmptyMedia>
          <EmptyTitle>No activation signals</EmptyTitle>
          <EmptyDescription>
            Run the watcher to surface stuck users, objections, product
            requests, and approval-gated issue drafts.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-3">
      {signals.map((signal) => {
        const signalType =
          stringFromMetadata(signal.metadata, "signalType") ??
          signal.signalType;
        const intervention =
          stringFromMetadata(signal.metadata, "suggestedIntervention") ??
          "Review evidence and decide the next operator action.";
        const issue = draftIssue(signal.metadata);

        return (
          <div
            key={signal.signalId}
            className="rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(signal.severity)}>
                    {signal.severity}
                  </Badge>
                  <Badge variant="outline">{signalType}</Badge>
                  <Badge variant="secondary">pending approval</Badge>
                </div>
                <h2 className="mt-3 font-medium">{signal.summary}</h2>
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(signal.updatedAt).toLocaleString()}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  Suggested intervention
                </div>
                <p className="mt-2 text-muted-foreground">{intervention}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {signal.evidenceRefs.length} evidence
                  </Badge>
                  <Badge variant="outline">{signal.signalId}</Badge>
                </div>
                {signal.approvalId ? (
                  <div className="mt-3">
                    <ApprovalDecisionControls approvalId={signal.approvalId} />
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <GitPullRequestArrow className="h-4 w-4 text-muted-foreground" />
                  Issue draft preview
                </div>
                <div className="mt-2 font-medium">
                  {issue?.title ?? "No issue draft stored"}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {issue?.body ?? "Approval is still required before filing."}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ActivationRunResult({
  result,
}: {
  result: RunGtmActivationWatcherResult;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Watcher run</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.signalIds.length} signals, {result.approvalIds.length} issue
            approvals, {result.dedupedCount} deduped
          </p>
        </div>
        <Badge variant="secondary">draft issue only</Badge>
      </div>
    </section>
  );
}

export function GtmActivationClient() {
  const [targetUserHash, setTargetUserHash] = useState("user_demo_hash");
  const [failureCount, setFailureCount] = useState("3");
  const [objectionText, setObjectionText] = useState(
    "Security review is blocking the first successful session.",
  );
  const [featureRequestText, setFeatureRequestText] = useState(
    "GitHub App install status should be clearer during onboarding.",
  );
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunGtmActivationWatcherResult | null>(
    null,
  );

  const { data, error, isLoading, mutate } = useSWR<ActivationQueueResponse>(
    "/api/gtm/activation/signals",
    fetchJson,
  );

  async function runWatcher() {
    setRunning(true);
    try {
      const response = await fetch("/api/gtm/activation/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: [
            {
              targetUserHash,
              githubInstalled: true,
              sessionCount: 1,
              failureCount: Number(failureCount) || 0,
              objectionText,
              featureRequestText,
              evidenceRefs: [
                {
                  sourceType: "product",
                  recordId: "activation-queue-ui",
                  excerpt: objectionText || featureRequestText,
                  retrievedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error("activation watcher failed");
      }

      const result = (await response.json()) as RunGtmActivationWatcherResult;
      setLastRun(result);
      toast.success("Activation watcher completed");
      await mutate();
    } catch {
      toast.error("Failed to run activation watcher");
    } finally {
      setRunning(false);
    }
  }

  const signals = data?.signals ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_160px]">
          <div className="space-y-2">
            <Label htmlFor="gtm-activation-user">Target user hash</Label>
            <Input
              id="gtm-activation-user"
              value={targetUserHash}
              onChange={(event) => setTargetUserHash(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-activation-failures">Failures</Label>
            <Input
              id="gtm-activation-failures"
              inputMode="numeric"
              value={failureCount}
              onChange={(event) => setFailureCount(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gtm-activation-objection">Objection</Label>
            <Textarea
              id="gtm-activation-objection"
              value={objectionText}
              onChange={(event) => setObjectionText(event.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-activation-request">Product request</Label>
            <Textarea
              id="gtm-activation-request"
              value={featureRequestText}
              onChange={(event) => setFeatureRequestText(event.target.value)}
              rows={4}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Issue filing remains blocked until the approval is consumed.
          </div>
          <Button onClick={runWatcher} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Run watcher
          </Button>
        </div>
      </section>

      {lastRun ? <ActivationRunResult result={lastRun} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Activation signal queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Private draft signals with approval-gated GitHub issue previews.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <QueueSkeleton />
        ) : error ? (
          <div className="rounded-md border border-border p-4 text-sm">
            Failed to load activation signals.
          </div>
        ) : (
          <ActivationQueue signals={signals} />
        )}
      </section>
    </div>
  );
}
