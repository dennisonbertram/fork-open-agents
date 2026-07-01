"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  DESTRUCTIVE_ACTIONS,
  GITHUB_TOOL_ACTIONS,
  type GitHubToolAction,
} from "@/lib/background-agents/github-actions";
import { cn } from "@/lib/utils";

export interface GitHubActionsSectionProps {
  /** Currently enabled GitHub tool actions for this agent. */
  enabledActions: GitHubToolAction[];
  /** Called with the updated array when an action toggle changes. */
  onChange: (next: GitHubToolAction[]) => void;
  /**
   * Sub-toggle bound to merge_pull_request only, shown when that action is
   * enabled. When true (the default), the merge tool refuses to merge
   * unless the PR's combined CI status is green — enforced inside the tool
   * itself, not just this UI (see background-agent-tools.ts buildMergeTool).
   */
  requireCiGreenToMerge: boolean;
  onRequireCiGreenChange: (next: boolean) => void;
  /** Disable interaction while the parent form is saving. */
  disabled?: boolean;
}

const ACTION_LABELS: Record<GitHubToolAction, string> = {
  open_pull_request: "Open a pull request",
  comment_on_pr_or_issue: "Comment on a PR or issue",
  approve_pull_request: "Approve a pull request",
  request_changes: "Request changes on a pull request",
  merge_pull_request: "Merge a pull request",
  push: "Push commits (including force-push)",
  delete_branch: "Delete a branch",
};

const ACTION_CAPTIONS: Record<GitHubToolAction, string> = {
  open_pull_request:
    "Commits staged sandbox changes and opens a pull request via the GitHub App.",
  comment_on_pr_or_issue: "Leaves a comment on a pull request or issue.",
  approve_pull_request:
    "Approves a pull request review. A GitHub App cannot approve its own pull requests.",
  request_changes: "Requests changes on a pull request review.",
  merge_pull_request:
    "Merges a pull request using the configured merge method.",
  push: "Pushes commits to a branch. Force-push overwrites remote history.",
  delete_branch: "Deletes a branch.",
};

/**
 * Pure helper: returns the updated enabled-actions array after toggling
 * `action` on/off. Extracted so it's unit-testable without DOM interaction —
 * this repo's component tests use renderToStaticMarkup, which cannot
 * simulate clicks (see toggleBuiltinToolName in standard-toolpack-section.tsx
 * for the established pattern).
 */
export function toggleGitHubAction(
  enabled: GitHubToolAction[],
  action: GitHubToolAction,
): GitHubToolAction[] {
  if (enabled.includes(action)) {
    return enabled.filter((a) => a !== action);
  }
  return [...enabled, action];
}

/**
 * Returns true when `action` should render the visually-distinct
 * "Irreversible" caption. push and delete_branch always show it. merge_pull_request
 * shows it only when the CI-green gate is off (the gate itself is the safety
 * net; disabling it is what makes the merge action irreversible in the sense
 * that a broken merge can land without a check). This is a label only — it
 * never disables the toggle or narrows the write-scope mechanism.
 */
function isIrreversible(
  action: GitHubToolAction,
  requireCiGreenToMerge: boolean,
): boolean {
  if (!DESTRUCTIVE_ACTIONS.has(action)) {
    return false;
  }
  if (action === "merge_pull_request") {
    return !requireCiGreenToMerge;
  }
  return true;
}

/**
 * "GitHub actions" entry in StandardToolpackSection's Tools panel — an
 * expandable (chevron) list of the 7 GitHub tool actions a background agent
 * can be granted (#740). open_pull_request and comment_on_pr_or_issue are
 * on by default; every other action is off by default and must be
 * explicitly enabled. Every action is bounded by the agent's write scope
 * (GitHubWriteScopeSection) and executed with a per-call minted-and-revoked
 * installation token — no standing credential exists across a turn.
 */
export function GitHubActionsSection({
  enabledActions,
  onChange,
  requireCiGreenToMerge,
  onRequireCiGreenChange,
  disabled = false,
}: GitHubActionsSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
        GitHub actions
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        What this agent may do on GitHub, via a per-call, write-scope-bounded
        installation token. Off by default except opening pull requests and
        commenting.
      </p>
      {/* Always render children — use CSS visibility so labels remain in
          markup for tests, matching the "Standard toolpack" pattern. */}
      <div className={cn("mt-3 space-y-2", open ? "" : "hidden")}>
        {GITHUB_TOOL_ACTIONS.map((action) => {
          const checked = enabledActions.includes(action);
          const irreversible = isIrreversible(action, requireCiGreenToMerge);
          return (
            <div
              key={action}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5"
            >
              <div>
                <p className="text-sm font-medium">{ACTION_LABELS[action]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ACTION_CAPTIONS[action]}
                </p>
                {irreversible && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase text-destructive">
                    Irreversible
                  </p>
                )}
                {action === "merge_pull_request" && checked && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded border border-border/60 bg-muted/20 p-2">
                    <span className="text-xs text-foreground">
                      Require CI checks to pass before merging
                    </span>
                    <Switch
                      checked={requireCiGreenToMerge}
                      disabled={disabled}
                      aria-label="Require CI checks to pass before merging"
                      onCheckedChange={() =>
                        onRequireCiGreenChange(!requireCiGreenToMerge)
                      }
                    />
                  </div>
                )}
              </div>
              <Switch
                checked={checked}
                disabled={disabled}
                aria-label={ACTION_LABELS[action]}
                onCheckedChange={() =>
                  onChange(toggleGitHubAction(enabledActions, action))
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
