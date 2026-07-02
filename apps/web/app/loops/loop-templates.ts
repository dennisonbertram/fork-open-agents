/**
 * loop-templates.ts — starter templates for the "New loop" experience.
 *
 * Each template is a complete, valid LoopDefinition (validated by
 * loop-templates.test.ts against validateLoopDefinition, so a broken template
 * can never ship). Templates give first-time users a working, connected graph
 * to start from instead of a blank canvas or raw JSON.
 *
 * `requiresTool` flags a capability the agent steps depend on (e.g. an email
 * connector) so the UI can surface a "needs setup" hint.
 */

import type { LoopDefinition } from "@/lib/agent-loops/types";

export type LoopTemplateTrigger = "schedule" | "github_pr" | "manual";

/**
 * Machine-readable trigger suggestion (#765). Mirrors the shape the loop
 * trigger API (`POST /api/agent-loops/[loopId]/triggers`, #762) accepts, so
 * the post-create nudge can attach it with a single API call. Creating a loop
 * from a template never auto-attaches this — it is purely a one-click
 * suggestion the user can accept or ignore.
 */
export type LoopTemplateSuggestedTriggerSpec =
  | { kind: "schedule.cron"; schedule: string }
  | {
      kind:
        | "github.pull_request"
        | "github.pull_request_review"
        | "github.deployment_status"
        | "github.issue"
        | "github.check_suite";
    };

export type LoopTemplate = {
  slug: string;
  name: string;
  /** One-line description shown on the template card. */
  description: string;
  /** Short, human phrasing of when this loop runs. */
  suggestedTrigger: string;
  /**
   * Machine-readable trigger suggestion (#765), when this template's job
   * benefits from one. Absent when no single trigger kind is an obvious fit
   * (e.g. email-triage needs an unshipped email-poll trigger kind).
   */
  suggestedTriggerSpec?: LoopTemplateSuggestedTriggerSpec;
  /** Capability the agent steps need before this loop can run, if any. */
  requiresTool?: string;
  definition: LoopDefinition;
};

// ── Templates ──────────────────────────────────────────────────────────────────

const reviewToIssues: LoopTemplate = {
  slug: "review-to-issues",
  name: "Review to issues",
  description:
    "Review the repository, compile a list of problems, and file each one as a GitHub issue.",
  suggestedTrigger: "When a new PR opens (or on a schedule you choose)",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "review",
        kind: "agent_step",
        label: "Review code",
        position: { x: 260, y: 0 },
        instructions:
          'Review the repository for bugs, risks, and missing tests. Write {"issues":[{"title":"...","body":"..."}]} to /tmp/loop-step-output.json.',
      },
      {
        id: "file",
        kind: "agent_step",
        label: "File issues",
        position: { x: 520, y: 0 },
        instructions:
          'For each item in context.review.issues, run `gh issue create --title "..." --body "..."`. Write {"filed": <count>} to /tmp/loop-step-output.json.',
      },
      { id: "end", kind: "end", label: "Done", position: { x: 780, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "review", when: "always" },
      { id: "e2", source: "review", target: "file", when: "success" },
      { id: "e3", source: "file", target: "end", when: "success" },
    ],
  },
};

const backlogToPr: LoopTemplate = {
  slug: "backlog-to-pr",
  name: "Backlog → PR",
  description:
    "Pick an issue, implement it, review the result, and loop on fixes until it passes — then open a PR.",
  suggestedTrigger: "Every hour, or manually",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "pick",
        kind: "agent_step",
        label: "Pick issue",
        position: { x: 240, y: 0 },
        instructions:
          'Take the top open issue off the backlog (`gh issue list`). Write {"issue": <number>, "title": "..."} to /tmp/loop-step-output.json.',
      },
      {
        id: "implement",
        kind: "agent_step",
        label: "Implement",
        position: { x: 480, y: 0 },
        instructions:
          'Implement context.pick.issue on a feature branch. Write {"branch": "..."} to /tmp/loop-step-output.json.',
      },
      {
        id: "review",
        kind: "agent_step",
        label: "Review",
        position: { x: 720, y: 0 },
        instructions:
          'Review the diff for correctness, tests, and scope. Write {"passed": true|false, "notes": "..."} to /tmp/loop-step-output.json.',
      },
      {
        id: "gate",
        kind: "condition",
        label: "Passed?",
        position: { x: 960, y: 0 },
        condition: { path: "review.passed", op: "eq", value: true },
      },
      {
        id: "fix",
        kind: "agent_step",
        label: "Fix issues",
        position: { x: 720, y: 200 },
        instructions:
          'Address context.review.notes on the same branch. Write {"fixed": true} to /tmp/loop-step-output.json.',
      },
      {
        id: "pr",
        kind: "agent_step",
        label: "Open PR",
        position: { x: 1200, y: 0 },
        instructions:
          'Open a PR from the working branch with a summary (`gh pr create`). Write {"pr": <number>} to /tmp/loop-step-output.json.',
        // #765: this step is the one place `gh pr create` is legitimate in
        // this template — declare pull-request WRITE so the step-prompt
        // builder's conditional permission (loop-step-prompt.ts) lifts the
        // default PR-creation prohibition for this node only.
        permissions: { github: { pullRequests: "write" } },
      },
      { id: "end", kind: "end", label: "Done", position: { x: 1440, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "pick", when: "always" },
      { id: "e2", source: "pick", target: "implement", when: "success" },
      { id: "e3", source: "implement", target: "review", when: "success" },
      { id: "e4", source: "review", target: "gate", when: "success" },
      { id: "e5", source: "gate", target: "pr", when: "true" },
      { id: "e6", source: "gate", target: "fix", when: "false" },
      { id: "e7", source: "fix", target: "review", when: "success" },
      { id: "e8", source: "pr", target: "end", when: "success" },
    ],
  },
};

const emailTriage: LoopTemplate = {
  slug: "email-triage",
  name: "Email triage",
  description:
    "Check the inbox, and when a new email is a feature request, file it as an issue.",
  suggestedTrigger: "Every 15 minutes",
  requiresTool: "An email connector (e.g. Gmail via Composio)",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "check",
        kind: "agent_step",
        label: "Check inbox",
        position: { x: 240, y: 0 },
        instructions:
          'Check the inbox for unread mail using the email tool. Write {"hasNew": true|false, "latest": {"subject": "...", "body": "..."}} to /tmp/loop-step-output.json.',
      },
      {
        id: "hasNew",
        kind: "condition",
        label: "New email?",
        position: { x: 480, y: 0 },
        condition: { path: "check.hasNew", op: "eq", value: true },
      },
      {
        id: "classify",
        kind: "agent_step",
        label: "Feature request?",
        position: { x: 720, y: 0 },
        instructions:
          'Read context.check.latest. Decide if it is a feature request. Write {"isFeatureRequest": true|false} to /tmp/loop-step-output.json.',
      },
      {
        id: "isFeat",
        kind: "condition",
        label: "Is feature?",
        position: { x: 960, y: 0 },
        condition: {
          path: "classify.isFeatureRequest",
          op: "eq",
          value: true,
        },
      },
      {
        id: "file",
        kind: "agent_step",
        label: "File request",
        position: { x: 1200, y: 0 },
        instructions:
          'Open a feature-request issue from context.check.latest (`gh issue create`). Write {"filed": true} to /tmp/loop-step-output.json.',
      },
      { id: "end", kind: "end", label: "Done", position: { x: 1200, y: 200 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "check", when: "always" },
      { id: "e2", source: "check", target: "hasNew", when: "success" },
      { id: "e3", source: "hasNew", target: "classify", when: "true" },
      { id: "e4", source: "hasNew", target: "end", when: "false" },
      { id: "e5", source: "classify", target: "isFeat", when: "success" },
      { id: "e6", source: "isFeat", target: "file", when: "true" },
      { id: "e7", source: "isFeat", target: "end", when: "false" },
      { id: "e8", source: "file", target: "end", when: "success" },
    ],
  },
};

const reviewPrsAndComment: LoopTemplate = {
  slug: "review-prs-and-comment",
  name: "Review PRs and comment",
  description:
    "List open pull requests and leave a review comment on each one. Agent steps only — this template never opens or merges anything.",
  // Worded as a suggestion, not an implemented/wired trigger: trigger CRUD
  // ships separately (#762/C1), so creating this template does not attach
  // any schedule or webhook by itself.
  suggestedTrigger: "A nightly schedule works well for this, if you add one",
  // #765: daily 02:00 UTC — matches the suggestedTrigger prose above. The
  // post-create nudge offers this as a one-click "Attach suggested trigger"
  // action; it is never auto-attached by creating the loop.
  suggestedTriggerSpec: { kind: "schedule.cron", schedule: "0 2 * * *" },
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "list",
        kind: "agent_step",
        label: "List open PRs",
        position: { x: 260, y: 0 },
        instructions:
          'List the repository\'s open pull requests (`gh pr list`). Write {"prs":[{"number": <n>, "title": "..."}]} to /tmp/loop-step-output.json.',
        // `gh pr list` needs pull-request read; the default minted token
        // carries contents-only scopes (lib/agent-loops/token-permissions.ts).
        permissions: { github: { pullRequests: "read" } },
      },
      {
        id: "review",
        kind: "agent_step",
        label: "Review and comment",
        position: { x: 520, y: 0 },
        instructions:
          'For each PR in context.list.prs, review its diff and leave a review comment summarizing findings, targeting it by number: `gh pr review <number> --comment --body "..."` (without a number, gh reviews the current branch\'s PR — wrong here). Do NOT approve, request changes, merge, or open any PR. Write {"commented": <count>} to /tmp/loop-step-output.json.',
        // Creating a PR review requires pull-request WRITE on the minted token.
        permissions: { github: { pullRequests: "write" } },
      },
      { id: "end", kind: "end", label: "Done", position: { x: 780, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "list", when: "always" },
      { id: "e2", source: "list", target: "review", when: "success" },
      { id: "e3", source: "review", target: "end", when: "success" },
    ],
  },
};

const mergeWhenGreen: LoopTemplate = {
  slug: "merge-when-green",
  name: "Merge when green",
  // #765: this template only works when it runs from a PR-event trigger —
  // its check node reads the PR's ref from trigger.ref (seeded by the
  // dispatcher bridge from the trigger's event payload). Creating this
  // template does NOT attach a trigger automatically; without one, "Run now"
  // has no trigger.ref to read and the check step fails with
  // condition_path_missing.
  description:
    "Check a PR's CI status; if it's passing, merge it. Teaches the GitHub check node. Needs a PR-event trigger to be useful — without one, there's no PR ref to check.",
  suggestedTrigger: "On a new PR (attach a PR-event trigger after creating)",
  // #765: matches the description above — the post-create nudge offers this
  // as a one-click "Attach suggested trigger" action; never auto-attached.
  suggestedTriggerSpec: { kind: "github.pull_request" },
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "ci",
        kind: "github_check",
        label: "Check CI",
        position: { x: 240, y: 0 },
        // #765: was "context.start.ref" — a path that can never resolve (no
        // node writes output under a "start" or "context" context key).
        // trigger.ref is seeded by the dispatcher bridge from the PR-event
        // trigger's payload (docs/plans/agent-loops-epic.md's trigger.*
        // contract) and is the PR head ref this check needs.
        check: { kind: "ci_status", refFrom: "trigger.ref" },
      },
      {
        id: "green",
        kind: "condition",
        label: "CI green?",
        position: { x: 480, y: 0 },
        condition: { path: "ci.state", op: "eq", value: "success" },
      },
      {
        id: "merge",
        kind: "agent_step",
        label: "Merge PR",
        position: { x: 720, y: 0 },
        instructions:
          'Merge the PR once CI is green (`gh pr merge --squash`). Write {"merged": true} to /tmp/loop-step-output.json.',
      },
      { id: "end", kind: "end", label: "Done", position: { x: 720, y: 200 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "ci", when: "always" },
      { id: "e2", source: "ci", target: "green", when: "success" },
      { id: "e3", source: "green", target: "merge", when: "true" },
      { id: "e4", source: "green", target: "end", when: "false" },
      { id: "e5", source: "merge", target: "end", when: "success" },
    ],
  },
};

/**
 * Spread node positions so the canvas has comfortable breathing room between
 * nodes (max node width is 200px; authored gaps were ~240-260, leaving labels
 * cramped). Scaling positions widens every gap proportionally without touching
 * graph structure.
 */
const SPACING_SCALE = 1.45;

function spaced(definition: LoopDefinition): LoopDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => ({
      ...node,
      position: {
        x: Math.round(node.position.x * SPACING_SCALE),
        y: Math.round(node.position.y * SPACING_SCALE),
      },
    })),
  };
}

function withSpacing(template: LoopTemplate): LoopTemplate {
  return { ...template, definition: spaced(template.definition) };
}

/** All starter templates, in display order (simplest first). */
export const LOOP_TEMPLATES: LoopTemplate[] = [
  reviewToIssues,
  reviewPrsAndComment,
  backlogToPr,
  mergeWhenGreen,
  emailTriage,
].map(withSpacing);

export function getLoopTemplate(slug: string): LoopTemplate | undefined {
  return LOOP_TEMPLATES.find((t) => t.slug === slug);
}
