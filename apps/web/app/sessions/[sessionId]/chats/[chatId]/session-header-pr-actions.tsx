"use client";

/**
 * A single contextual PR action button in the session header (top-right), in
 * the spirit of conductor.build. It shows one action based on the branch/PR
 * state and, on click, sends a templated prompt to the agent immediately:
 *
 *   default (no open PR)     → Create PR
 *   PR open + mergeable      → Merge PR
 *   PR open + merge conflicts → Resolve Conflicts
 *
 * Create PR is the default whenever there is no open PR (including after a PR is
 * merged/closed). Merge readiness (conflict detection) is fetched only while a
 * PR is open. Hidden only for chat-only (no-repo) sessions, which have no git.
 */

import { GitMerge, GitPullRequest, Wrench } from "lucide-react";
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
  busy: boolean;
  onCreatePr: () => void;
  onMergePr: () => void;
  onResolveConflicts: (baseBranchRef: string) => void;
};

const CONFLICT_REASON = /merge conflict/i;

export type PrAction = "create" | "merge" | "resolve";

/**
 * Pure decision: which single PR action to show. Create PR is the default
 * (no open PR); an open PR shows Merge, or Resolve Conflicts when blocked by
 * conflicts.
 */
export function selectPrAction(params: {
  hasExistingPr: boolean;
  prStatus: "open" | "closed" | "merged" | null;
  mergeReadinessReasons?: string[];
}): PrAction {
  const prOpen = params.hasExistingPr && params.prStatus === "open";
  if (!prOpen) {
    return "create";
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

  // Chat-only sessions have no git at all — the action doesn't apply.
  if (!hasRepo) {
    return null;
  }

  const action = selectPrAction({
    hasExistingPr,
    prStatus,
    mergeReadinessReasons: readiness?.reasons,
  });

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
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {busy ? "Agent is working…" : tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
