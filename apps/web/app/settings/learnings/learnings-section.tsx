"use client";

import { Lightbulb, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type { LearningConfidence } from "@/lib/learnings/types";
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
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import { SettingsSection } from "@/components/ui/settings-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { LearningDetailSheet } from "./learning-detail-sheet";
import { LearningFeedTable } from "./learning-feed-table";
import type {
  LearningFeedItem,
  LearningsResponse,
  LearningsVerdict,
} from "./types";

const DEFAULT_VERDICT: LearningsVerdict = {
  status: "unavailable" as const,
  headline: "Choose a repository",
  detail: "Enter an owner and repo to inspect learnings.",
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load learnings");
  }
  return (await response.json()) as T;
}

function buildLearningsUrl(repoOwner: string, repoName: string) {
  const params = new URLSearchParams({ repoOwner, repoName });
  return `/api/learnings?${params.toString()}`;
}

function canToggleAgent(verdict: LearningsResponse["verdict"] | undefined) {
  if (!verdict) {
    return false;
  }
  if (verdict.status === "error" || verdict.status === "unavailable") {
    return false;
  }
  return verdict.errorKind !== "event_subscription_missing";
}

function LearningsTableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full" />
      <div className="space-y-2 rounded-md border border-border p-3">
        {[1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function LearningsSectionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <Skeleton className="mb-4 h-4 w-36" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <Skeleton className="mb-4 h-4 w-36" />
        <LearningsTableSkeleton />
      </div>
    </div>
  );
}

export function LearningsSection({
  initialRepoOwner = "",
  initialRepoName = "",
}: {
  initialRepoOwner?: string;
  initialRepoName?: string;
}) {
  const [repoOwner, setRepoOwner] = useState(initialRepoOwner);
  const [repoName, setRepoName] = useState(initialRepoName);
  const [selectedLearning, setSelectedLearning] =
    useState<LearningFeedItem | null>(null);
  const [mutating, setMutating] = useState(false);

  const normalizedRepoOwner = repoOwner.trim();
  const normalizedRepoName = repoName.trim();
  const repoSelected = Boolean(normalizedRepoOwner && normalizedRepoName);
  const swrKey = repoSelected
    ? buildLearningsUrl(normalizedRepoOwner, normalizedRepoName)
    : null;
  const { data, error, isLoading, mutate } = useSWR<LearningsResponse>(
    swrKey,
    fetchJson,
  );

  const verdict = error
    ? {
        status: "error" as const,
        headline: "Failed to load learnings.",
        detail: "Try again, or check operator details if this keeps failing.",
        errorKind: "feed_request_failed",
      }
    : (data?.verdict ?? DEFAULT_VERDICT);
  const learnings = data?.learnings ?? [];
  const toggleDisabled =
    !repoSelected || isLoading || mutating || !canToggleAgent(verdict);
  const checks = verdict.errorKind
    ? [
        {
          id: verdict.errorKind,
          label: "Diagnostic",
          status:
            verdict.status === "ready"
              ? ("ready" as const)
              : ("missing" as const),
          detail: `errorKind: ${verdict.errorKind}`,
        },
      ]
    : undefined;

  async function updateAgentEnabled(enabled: boolean) {
    if (!repoSelected || toggleDisabled) {
      return;
    }

    setMutating(true);
    try {
      const response = await fetch("/api/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoOwner: normalizedRepoOwner,
          repoName: normalizedRepoName,
          enabled,
        }),
      });
      if (!response.ok) {
        throw new Error("toggle failed");
      }
      toast.success(
        enabled ? "Learnings agent enabled" : "Learnings agent disabled",
      );
      await mutate();
    } catch {
      toast.error("Failed to update learnings agent");
    } finally {
      setMutating(false);
    }
  }

  async function patchLearning(
    learningId: string,
    body: { status?: "archived"; confidence?: LearningConfidence },
    successMessage: string,
  ) {
    setMutating(true);
    try {
      const response = await fetch(`/api/learnings/${learningId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error("patch failed");
      }
      toast.success(successMessage);
      await mutate();
      setSelectedLearning((current) =>
        current?.id === learningId ? null : current,
      );
    } catch {
      toast.error("Failed to update learning");
    } finally {
      setMutating(false);
    }
  }

  function submitFeedback(learningId: string, helpful: boolean) {
    toast.message(helpful ? "Feedback noted" : "Feedback noted");
    console.info("[learnings_ui]", {
      service: "learnings_ui",
      action: "feedback_submitted",
      learningId,
      helpful,
    });
  }

  const emptyCopy = repoSelected
    ? "No learnings yet - enable the agent for a repo and they'll appear after the next pull request."
    : "Choose a repository to inspect learned patterns and enable extraction.";

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Repository agent"
        description="Enable extraction for one repository at a time."
        action={
          <div className="flex items-center gap-2">
            {mutating ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
            <Label htmlFor="learnings-agent-toggle" className="text-sm">
              Enable
            </Label>
            <Switch
              id="learnings-agent-toggle"
              aria-label="Enable learnings agent"
              checked={Boolean(data?.enabled)}
              disabled={toggleDisabled}
              onCheckedChange={updateAgentEnabled}
            />
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="learnings-repo-owner">Owner</Label>
            <Input
              id="learnings-repo-owner"
              value={repoOwner}
              placeholder="dennisonbertram"
              onChange={(event) => setRepoOwner(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="learnings-repo-name">Repository</Label>
            <Input
              id="learnings-repo-name"
              value={repoName}
              placeholder="fork-open-agents"
              onChange={(event) => setRepoName(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <ReadinessVerdict
            status={isLoading ? "unavailable" : verdict.status}
            headline={
              isLoading ? "Loading learnings agent status." : verdict.headline
            }
            subtext={isLoading ? undefined : verdict.detail}
            checks={checks}
            onRefresh={repoSelected ? () => void mutate() : undefined}
            refreshing={isLoading}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Learning feed"
        description="Review extracted patterns, gotchas, and conventions before using them as guidance."
      >
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              Failed to load learnings.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void mutate()}
            >
              <RotateCw className="size-4" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <LearningsTableSkeleton />
        ) : learnings.length === 0 ? (
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Lightbulb className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No learnings yet</EmptyTitle>
              <EmptyDescription className="max-w-md text-pretty">
                {emptyCopy}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                disabled={toggleDisabled}
                onClick={() => void updateAgentEnabled(true)}
              >
                Enable learnings agent
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <p className="text-pretty text-xs text-muted-foreground">
              AI-derived - confidence labels are guidance only; verify each
              learning through its evidence.
            </p>
            <LearningFeedTable
              learnings={learnings}
              onOpenLearning={setSelectedLearning}
              onArchiveLearning={(learningId) =>
                void patchLearning(
                  learningId,
                  { status: "archived" },
                  "Learning archived",
                )
              }
              onOverrideConfidence={(learningId, confidence) =>
                void patchLearning(
                  learningId,
                  { confidence },
                  "Confidence updated",
                )
              }
              archiving={mutating}
            />
          </>
        )}
      </SettingsSection>

      <LearningDetailSheet
        learning={selectedLearning}
        open={Boolean(selectedLearning)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedLearning(null);
          }
        }}
        onFeedback={submitFeedback}
      />
    </div>
  );
}
