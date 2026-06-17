"use client";

/**
 * PR action buttons shown in the session header (top-right), in the spirit of
 * conductor.build. All three actions are always visible (the UI doesn't shift);
 * each is enabled only when it applies, and disabled (greyed, with a tooltip
 * explaining why) otherwise. Clicking an enabled action sends a templated
 * prompt to the agent immediately:
 *
 *   Create PR         — enabled when there are changes and no PR yet
 *   Merge PR          — enabled when a PR is open and mergeable
 *   Resolve Conflicts — enabled when a PR is open with merge conflicts
 *
 * Merge readiness (conflict detection) is fetched only while a PR is open.
 * The whole group is hidden only for chat-only (no-repo) sessions, which have
 * no git at all.
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
  hasChanges: boolean;
  busy: boolean;
  onCreatePr: () => void;
  onMergePr: () => void;
  onResolveConflicts: (baseBranchRef: string) => void;
};

const CONFLICT_REASON = /merge conflict/i;

export type PrActionState = { enabled: boolean; reason: string };
export type PrActionStates = {
  create: PrActionState;
  merge: PrActionState;
  resolve: PrActionState;
};

/**
 * Pure decision: enabled/disabled state (and the tooltip reason) for each of the
 * three PR actions. Disabled reasons double as the tooltip so a greyed button
 * always explains itself.
 */
export function getPrActionStates(params: {
  hasExistingPr: boolean;
  prStatus: "open" | "closed" | "merged" | null;
  hasChanges: boolean;
  busy: boolean;
  /** Reasons from merge readiness; used only to detect conflicts. */
  mergeReadinessReasons?: string[];
}): PrActionStates {
  const { busy, hasChanges, hasExistingPr, prStatus } = params;
  const prOpen = hasExistingPr && prStatus === "open";
  const hasConflicts = (params.mergeReadinessReasons ?? []).some((reason) =>
    CONFLICT_REASON.test(reason),
  );
  const busyState: PrActionState = {
    enabled: false,
    reason: "Agent is working…",
  };

  let create: PrActionState;
  if (busy) {
    create = busyState;
  } else if (hasExistingPr) {
    create = {
      enabled: false,
      reason: "A pull request already exists for this branch",
    };
  } else if (hasChanges) {
    create = { enabled: true, reason: "Commit, push, and open a pull request" };
  } else {
    create = {
      enabled: false,
      reason: "No changes to open a pull request for yet",
    };
  }

  let merge: PrActionState;
  if (busy) {
    merge = busyState;
  } else if (!prOpen) {
    merge = { enabled: false, reason: "No open pull request to merge" };
  } else if (hasConflicts) {
    merge = { enabled: false, reason: "Resolve the merge conflicts first" };
  } else {
    merge = { enabled: true, reason: "Merge the open pull request" };
  }

  let resolve: PrActionState;
  if (busy) {
    resolve = busyState;
  } else if (!prOpen) {
    resolve = { enabled: false, reason: "No open pull request" };
  } else if (hasConflicts) {
    resolve = {
      enabled: true,
      reason: "Resolve the merge conflicts on this branch",
    };
  } else {
    resolve = { enabled: false, reason: "No merge conflicts to resolve" };
  }

  return { create, merge, resolve };
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

  // Chat-only sessions have no git at all — the group simply doesn't apply.
  if (!hasRepo) {
    return null;
  }

  const states = getPrActionStates({
    hasExistingPr,
    prStatus,
    hasChanges,
    busy,
    mergeReadinessReasons: readiness?.reasons,
  });

  return (
    <div className="flex items-center gap-1">
      <PrActionButton
        icon={<GitPullRequest className="h-3.5 w-3.5" />}
        label="Create PR"
        onClick={onCreatePr}
        state={states.create}
      />
      <PrActionButton
        icon={<GitMerge className="h-3.5 w-3.5" />}
        label="Merge PR"
        onClick={onMergePr}
        state={states.merge}
      />
      <PrActionButton
        icon={<Wrench className="h-3.5 w-3.5" />}
        label="Resolve Conflicts"
        onClick={() =>
          onResolveConflicts(readiness?.pr?.baseBranch ?? "the base branch")
        }
        state={states.resolve}
      />
    </div>
  );
}

function PrActionButton({
  state,
  icon,
  label,
  onClick,
}: {
  state: PrActionState;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Span wrapper so the tooltip still fires on a disabled button. */}
        <span className="inline-flex">
          <Button
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={!state.enabled}
            onClick={onClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{state.reason}</TooltipContent>
    </Tooltip>
  );
}
