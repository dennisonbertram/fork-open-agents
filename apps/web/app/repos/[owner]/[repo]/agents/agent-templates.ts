/**
 * Agent template definitions for the repo-dashboard creation flow.
 * Each template prefills the spec fields so users can review and edit
 * before saving, rather than filling a raw form.
 */
import type {
  GithubActions,
  OutputMode,
  TriggerKind,
} from "@/lib/background-agents/agent-spec";

export type AgentTemplate = {
  /** Display name shown in the template picker */
  name: string;
  /** Short purpose description shown in the picker and prefilled as goal */
  goal: string;
  /** Trigger kind to prefill */
  triggerKind: TriggerKind;
  /** Prefilled instructions for the agent */
  instructions: string;
  /**
   * Deprecated (#748/#C7). Kept only because FormState/BackgroundAgent still
   * carry it for backward compatibility; githubActions is the real behavior
   * driver (#747).
   */
  outputMode: OutputMode;
  /** Default GitHub action toggles for this template. */
  githubActions: GithubActions;
  /** Default check command (empty means none) */
  defaultCheckCommand: string;
  /** Whether the agent starts enabled — always false for new agents */
  defaultEnabled: false;
  /** Human-readable note about permissions (shown when a write action is enabled) */
  permissionsNote?: string;
  /** Default schedule for schedule.cron templates */
  defaultSchedule?: string;
};

export type BlankTemplate = {
  name: "";
  goal: "";
  triggerKind: TriggerKind;
  instructions: "";
  outputMode: OutputMode;
  githubActions: GithubActions;
  defaultCheckCommand: "";
  defaultEnabled: false;
};

/**
 * The 5 named templates available in the creation flow.
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "PR Backlog Maintainer",
    goal: "Keep open pull requests up to date by reviewing and summarising them.",
    triggerKind: "github.pull_request",
    instructions:
      "When a pull request is opened or updated, review the diff and add a brief summary comment. Highlight breaking changes, missing tests, and potential conflicts with the main branch. Do not approve or merge.",
    outputMode: "none",
    githubActions: { comment_on_pr_or_issue: true },
    defaultCheckCommand: "",
    defaultEnabled: false,
  },
  {
    name: "Failing Checks Fixer",
    goal: "Attempt a minimal fix on pull request events and leave it as a draft PR.",
    triggerKind: "github.pull_request",
    instructions:
      "When a pull request is opened or updated, look for an obvious, minimal fix (lint, formatting, small type errors) and push it as a draft PR targeting the same branch, with a comment explaining the change. This agent reacts to pull request events — it does not detect or wait for a specific CI check result. Do not merge.",
    outputMode: "ready_pr",
    githubActions: {
      push: true,
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    },
    defaultCheckCommand: "",
    defaultEnabled: false,
    permissionsNote:
      "Requires write access to contents and pull requests to push the fix and open a draft PR.",
  },
  {
    name: "Issue Triage Agent",
    goal: "Label and prioritise newly opened issues automatically.",
    triggerKind: "github.issue",
    instructions:
      "When a new issue is opened, read the title and body. Apply one or more labels from the repo label set to categorise the issue (bug, enhancement, documentation, question, etc.). Add a short triage comment acknowledging the report and describing next steps. Do not close issues.",
    outputMode: "none",
    githubActions: { comment_on_pr_or_issue: true },
    defaultCheckCommand: "",
    defaultEnabled: false,
  },
  {
    name: "Release Notes Agent",
    goal: "Generate release notes from merged PRs on a weekly schedule.",
    triggerKind: "schedule.cron",
    instructions:
      "Every Monday morning, query the repository for pull requests merged in the previous 7 days. Group them by type (features, bug fixes, chores). Draft a Markdown release notes document and create a draft PR that adds it to the CHANGELOG or docs/releases directory. Do not publish or tag a release.",
    outputMode: "ready_pr",
    githubActions: { push: true, open_pull_request: true },
    defaultCheckCommand: "",
    defaultEnabled: false,
    defaultSchedule: "0 9 * * 1",
    permissionsNote:
      "Requires write access to contents and pull requests to create the release notes draft PR.",
  },
  {
    name: "Docs Drift Checker",
    goal: "Detect documentation that has drifted from the implementation.",
    triggerKind: "github.pull_request",
    instructions:
      "When a pull request changes source files, check whether corresponding documentation files are also updated. If source changes are present but no docs update is included, add a comment listing the documentation files that appear to be affected. Do not block the PR; only report the drift.",
    outputMode: "none",
    githubActions: { comment_on_pr_or_issue: true },
    defaultCheckCommand: "",
    defaultEnabled: false,
  },
];

/**
 * Returns a blank template with empty fields so the user starts from scratch.
 */
export function getBlankTemplate(): BlankTemplate {
  return {
    name: "",
    goal: "",
    triggerKind: "github.pull_request",
    instructions: "",
    outputMode: "none",
    githubActions: { open_pull_request: true, comment_on_pr_or_issue: true },
    defaultCheckCommand: "",
    defaultEnabled: false,
  };
}
