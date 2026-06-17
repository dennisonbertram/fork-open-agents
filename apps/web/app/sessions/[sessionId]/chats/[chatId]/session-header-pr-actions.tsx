"use client";

/**
 * Contextual PR action button shown in the session header (top-right), in the
 * spirit of conductor.build. Exactly one action surfaces based on the branch/PR
 * state, and clicking it sends a templated prompt to the agent immediately:
 *
 *   no PR + local changes   → Create PR
 *   PR open + mergeable      → Merge PR
 *   PR open + conflicts      → Resolve Conflicts
 *   merged / closed / clean  → (nothing)
 *
 * Merge readiness (conflict detection) is fetched only when a PR is open.
 */

import { GitMerge, GitPullRequest, Loader2, Wrench } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetcher } from "@/lib/swr";

type MergeReadiness = {
  canMerge: boolean;
  reasons: string[];
  pr: { baseBranch: string | null } | null;
};

export type SessionHeaderPrActionsProps = {
  sessionId: string;
  hasRepo: boolean;
  hasExistingPr: boolean;
  prStatus: "open" | "closed" | "merged" | null;
  hasChanges: boolean;
  busy: boolean;
  onCreatePr: () => void;
  onMergePr: () => void;
  onResolveConflicts: (baseBranchRef: string) => void;
};

const CONFLICT_REASON = /merge conflict/i;

export type PrAction = "create" | "merge" | "resolve" | null;

/** Pure decision: which single PR action (if any) applies to the current state. */
export function selectPrAction(params: {
  hasRepo: boolean;
  hasExistingPr: boolean;
  prStatus: "open" | "closed" | "merged" | null;
  hasChanges: boolean;
  /** Reasons from merge readiness; used only to detect conflicts. */
  mergeReadinessReasons?: string[];
}): PrAction {
  if (!params.hasRepo) {
    return null;
  }
  if (!params.hasExistingPr) {
    return params.hasChanges ? "create" : null;
  }
  if (params.prStatus !== "open") {
    return null;
  }
  const hasConflicts = (params.mergeReadinessReasons ?? []).some((reason) =>
    CONFLICT_REASON.test(reason),
  );
  return hasConflicts ? "resolve" : "merge";
}

export function SessionHeaderPrActions({
  sessionId,
  hasRepo,
  hasExistingPr,
  prStatus,
  hasChanges,
  busy,
  onCreatePr,
  onMergePr,
  onResolveConflicts,
}: SessionHeaderPrActionsProps) {
  const prOpen = hasExistingPr && prStatus === "open";

  // Only poll merge readiness while a PR is open — that's the only state where
  // we need to distinguish "mergeable" from "has conflicts".
  const { data: readiness } = useSWR<MergeReadiness>(
    prOpen ? `/api/sessions/${sessionId}/git/pr/readiness` : null,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 0 },
  );

  const action = selectPrAction({
    hasRepo,
    hasExistingPr,
    prStatus,
    hasChanges,
    mergeReadinessReasons: readiness?.reasons,
  });

  if (action === "create") {
    return (
      <PrActionButton
        busy={busy}
        icon={<GitPullRequest className="h-3.5 w-3.5" />}
        label="Create PR"
        onClick={onCreatePr}
        tooltip="Ask the agent to commit, push, and open a pull request"
      />
    );
  }

  if (action === "resolve") {
    return (
      <PrActionButton
        busy={busy}
        icon={<Wrench className="h-3.5 w-3.5" />}
        label="Resolve Conflicts"
        onClick={() =>
          onResolveConflicts(readiness?.pr?.baseBranch ?? "the base branch")
        }
        tooltip="Ask the agent to resolve the merge conflicts on this branch"
      />
    );
  }

  if (action === "merge") {
    return (
      <PrActionButton
        busy={busy}
        icon={<GitMerge className="h-3.5 w-3.5" />}
        label="Merge PR"
        onClick={onMergePr}
        tooltip="Ask the agent to merge the open pull request"
      />
    );
  }

  return null;
}

function PrActionButton({
  busy,
  icon,
  label,
  tooltip,
  onClick,
}: {
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy}
          onClick={onClick}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
