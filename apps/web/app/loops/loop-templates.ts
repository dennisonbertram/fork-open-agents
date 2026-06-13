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

export type LoopTemplate = {
  slug: string;
  name: string;
  /** One-line description shown on the template card. */
  description: string;
  /** Short, human phrasing of when this loop runs. */
  suggestedTrigger: string;
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

const mergeWhenGreen: LoopTemplate = {
  slug: "merge-when-green",
  name: "Merge when green",
  description:
    "Check a PR's CI status; if it's passing, merge it. Teaches the GitHub check node.",
  suggestedTrigger: "On a new PR",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "ci",
        kind: "github_check",
        label: "Check CI",
        position: { x: 240, y: 0 },
        check: { kind: "ci_status", refFrom: "context.start.ref" },
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

/** All starter templates, in display order (simplest first). */
export const LOOP_TEMPLATES: LoopTemplate[] = [
  reviewToIssues,
  backlogToPr,
  mergeWhenGreen,
  emailTriage,
];

export function getLoopTemplate(slug: string): LoopTemplate | undefined {
  return LOOP_TEMPLATES.find((t) => t.slug === slug);
}
