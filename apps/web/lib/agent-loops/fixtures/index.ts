/**
 * Agent Loops — shared fixture corpus
 *
 * This module exports typed fixture objects covering every node kind, every
 * edge `when` value, cycles, guardrails, size-edge cases, and a comprehensive
 * INVALID set covering each validation rule (VR-01 through VR-18).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EXTENSION MANDATE                                               ║
 * ║  Every time a new LoopNode kind or LoopEdge `when` value is     ║
 * ║  added to types.ts you MUST add at least one valid fixture that  ║
 * ║  uses it and at least one invalid fixture that exercises its     ║
 * ║  configuration validation rules.  The parity suite in           ║
 * ║  apps/web/app/loops/definition-parity.test.ts runs every        ║
 * ║  fixture through server + builder validation and round-trip;     ║
 * ║  un-covered node kinds will drift silently.                      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   import { VALID_FIXTURES, INVALID_FIXTURES } from
 *     "@/lib/agent-loops/fixtures";
 */

import type { LoopDefinition } from "../types";

// ── Fixture type ──────────────────────────────────────────────────────────────

export interface ValidFixture {
  /** Short identifier used in test descriptions. */
  id: string;
  /** Human-readable intent for this fixture. */
  intent: string;
  definition: LoopDefinition;
}

export interface InvalidFixture {
  /** Short identifier used in test descriptions. */
  id: string;
  /** Validation rule this fixture is designed to trigger. */
  rule: string;
  /** Human-readable description of why this should be rejected. */
  intent: string;
  definition: unknown;
}

// ════════════════════════════════════════════════════════════════════════════
// VALID FIXTURES
// ════════════════════════════════════════════════════════════════════════════

// ── V-01: Minimal start→end loop ─────────────────────────────────────────────

const MINIMAL: ValidFixture = {
  id: "V-01-minimal",
  intent:
    "Smallest valid definition: one start node, one end node, one always edge. Tests VR-01/VR-02/VR-04/VR-08 at minimum.",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── V-02: Agent step node with all optional fields ────────────────────────────

const AGENT_STEP_FULL: ValidFixture = {
  id: "V-02-agent-step-full",
  intent:
    "agent_step node with instructions, outputSchema, and checkCommand. Verifies all optional fields survive round-trip.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Full agent step",
        position: { x: 200, y: 0 },
        instructions: "Do useful work and output structured JSON.",
        outputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
        },
        checkCommand: "bun test",
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "end", when: "success" },
    ],
  },
};

// ── V-03: Agent step with failure edge ───────────────────────────────────────

const AGENT_STEP_FAILURE_EDGE: ValidFixture = {
  id: "V-03-agent-step-failure",
  intent:
    "agent_step with both success and failure outgoing edges. Exercises all non-condition when values.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step",
        position: { x: 200, y: 0 },
      },
      {
        id: "end-ok",
        kind: "end",
        label: "OK",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-fail",
        kind: "end",
        label: "Fail",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "end-ok", when: "success" },
      { id: "e3", source: "step1", target: "end-fail", when: "failure" },
    ],
  },
};

// ── V-04: github_check — list_issues kind ─────────────────────────────────────

const GITHUB_CHECK_LIST_ISSUES: ValidFixture = {
  id: "V-04-github-check-list-issues",
  intent:
    "github_check node with kind=list_issues and optional labels/state. Exercises VR-12 passing case.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh1",
        kind: "github_check",
        label: "List Issues",
        position: { x: 200, y: 0 },
        check: { kind: "list_issues", labels: ["bug", "p0"], state: "open" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh1", when: "always" },
      { id: "e2", source: "gh1", target: "end", when: "success" },
    ],
  },
};

// ── V-05: github_check — pr_status kind ──────────────────────────────────────

const GITHUB_CHECK_PR_STATUS: ValidFixture = {
  id: "V-05-github-check-pr-status",
  intent:
    "github_check node with kind=pr_status. Required field prNumberFrom must survive round-trip.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh-pr",
        kind: "github_check",
        label: "PR Status",
        position: { x: 200, y: 0 },
        check: { kind: "pr_status", prNumberFrom: "context.pr_number" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh-pr", when: "always" },
      { id: "e2", source: "gh-pr", target: "end", when: "success" },
    ],
  },
};

// ── V-06: github_check — deployment_status kind ───────────────────────────────

const GITHUB_CHECK_DEPLOYMENT_STATUS: ValidFixture = {
  id: "V-06-github-check-deployment-status",
  intent:
    "github_check node with kind=deployment_status and optional environment field.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh-deploy",
        kind: "github_check",
        label: "Deploy Status",
        position: { x: 200, y: 0 },
        check: { kind: "deployment_status", environment: "production" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh-deploy", when: "always" },
      { id: "e2", source: "gh-deploy", target: "end", when: "success" },
    ],
  },
};

// ── V-07: github_check — ci_status kind ──────────────────────────────────────

const GITHUB_CHECK_CI_STATUS: ValidFixture = {
  id: "V-07-github-check-ci-status",
  intent:
    "github_check node with kind=ci_status. Required refFrom must survive round-trip.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh-ci",
        kind: "github_check",
        label: "CI Status",
        position: { x: 200, y: 0 },
        check: { kind: "ci_status", refFrom: "context.branch" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh-ci", when: "always" },
      { id: "e2", source: "gh-ci", target: "end", when: "success" },
    ],
  },
};

// ── V-08: condition node — eq op ──────────────────────────────────────────────

const CONDITION_EQ: ValidFixture = {
  id: "V-08-condition-eq",
  intent:
    "condition node with op=eq (requires value field). Tests VR-13/VR-14 passing case. Uses true/false when values (VR-05, VR-18).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Status check",
        position: { x: 200, y: 0 },
        condition: { path: "status", op: "eq", value: "open" },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Open",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Closed",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-09: condition node — neq op ────────────────────────────────────────────

const CONDITION_NEQ: ValidFixture = {
  id: "V-09-condition-neq",
  intent: "condition node with op=neq and string value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Not failed",
        position: { x: 200, y: 0 },
        condition: { path: "result.status", op: "neq", value: "failed" },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Not failed",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Failed",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-10: condition node — gt op ─────────────────────────────────────────────

const CONDITION_GT: ValidFixture = {
  id: "V-10-condition-gt",
  intent: "condition node with op=gt and numeric value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Many issues",
        position: { x: 200, y: 0 },
        condition: { path: "issues.count", op: "gt", value: 5 },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Many",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Few",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-11: condition node — gte op ────────────────────────────────────────────

const CONDITION_GTE: ValidFixture = {
  id: "V-11-condition-gte",
  intent: "condition node with op=gte and numeric value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Threshold met",
        position: { x: 200, y: 0 },
        condition: { path: "score", op: "gte", value: 80 },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Pass",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Fail",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-12: condition node — lt op ─────────────────────────────────────────────

const CONDITION_LT: ValidFixture = {
  id: "V-12-condition-lt",
  intent: "condition node with op=lt and numeric value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Low error count",
        position: { x: 200, y: 0 },
        condition: { path: "errors.count", op: "lt", value: 3 },
      },
      {
        id: "end-t",
        kind: "end",
        label: "OK",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Too many",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-13: condition node — lte op ────────────────────────────────────────────

const CONDITION_LTE: ValidFixture = {
  id: "V-13-condition-lte",
  intent: "condition node with op=lte and numeric value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Within budget",
        position: { x: 200, y: 0 },
        condition: { path: "cost_usd", op: "lte", value: 100 },
      },
      {
        id: "end-t",
        kind: "end",
        label: "OK",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Over budget",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-14: condition node — exists op (no value required) ─────────────────────

const CONDITION_EXISTS: ValidFixture = {
  id: "V-14-condition-exists",
  intent:
    "condition node with op=exists, which is exempt from the value requirement (VR-14). Tests the exists exemption path.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Has output",
        position: { x: 200, y: 0 },
        condition: { path: "step1.output", op: "exists" },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Has output",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "No output",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-15: condition node — contains op ───────────────────────────────────────

const CONDITION_CONTAINS: ValidFixture = {
  id: "V-15-condition-contains",
  intent: "condition node with op=contains and string value.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Has keyword",
        position: { x: 200, y: 0 },
        condition: { path: "output.text", op: "contains", value: "error" },
      },
      {
        id: "end-t",
        kind: "end",
        label: "Found",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "Not found",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── V-16: Self-loop via condition pair (cycle) ────────────────────────────────

const SELF_LOOP_CONDITION: ValidFixture = {
  id: "V-16-self-loop-condition",
  intent:
    "Cycle via condition: step→condition, condition true→step (self-loop), condition false→end. VR-09 explicitly accepts cycles. Tests BFS can still reach end.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Do work",
        position: { x: 200, y: 0 },
        instructions: "Work on the task",
      },
      {
        id: "cond",
        kind: "condition",
        label: "Done?",
        position: { x: 400, y: 0 },
        condition: { path: "task.done", op: "exists" },
      },
      { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "cond", when: "success" },
      { id: "e3", source: "cond", target: "step1", when: "false" },
      { id: "e4", source: "cond", target: "end", when: "true" },
    ],
  },
};

// ── V-17: Multi-hop cycle ─────────────────────────────────────────────────────

const MULTI_HOP_CYCLE: ValidFixture = {
  id: "V-17-multi-hop-cycle",
  intent:
    "Multi-hop cycle: step1→step2→condition, condition false→step1 (multi-hop back-edge). VR-09 accepts cycles. End is still reachable from start via condition true branch.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step 1",
        position: { x: 200, y: 0 },
        instructions: "First pass",
      },
      {
        id: "step2",
        kind: "agent_step",
        label: "Step 2",
        position: { x: 400, y: 0 },
        instructions: "Second pass",
      },
      {
        id: "cond",
        kind: "condition",
        label: "Converged?",
        position: { x: 600, y: 0 },
        condition: { path: "convergence.score", op: "gte", value: 0.9 },
      },
      { id: "end", kind: "end", label: "Done", position: { x: 800, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "step2", when: "success" },
      { id: "e3", source: "step2", target: "cond", when: "success" },
      { id: "e4", source: "cond", target: "step1", when: "false" },
      { id: "e5", source: "cond", target: "end", when: "true" },
    ],
  },
};

// ── V-18: Multiple end nodes ──────────────────────────────────────────────────

const MULTIPLE_END_NODES: ValidFixture = {
  id: "V-18-multiple-ends",
  intent:
    "Graph with two distinct end nodes reachable from different branches. VR-02 only requires at least one; having more is legal.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step",
        position: { x: 200, y: 0 },
      },
      {
        id: "end-success",
        kind: "end",
        label: "Success",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-failure",
        kind: "end",
        label: "Failure",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "end-success", when: "success" },
      { id: "e3", source: "step1", target: "end-failure", when: "failure" },
    ],
  },
};

// ── V-19: Guardrails present ──────────────────────────────────────────────────
// Note: guardrails are stored separately from the definition in the DB
// (loopGuardrailsSchema). This fixture documents they are NOT part of
// LoopDefinition itself; the definition only has nodes/edges.
// This fixture is minimal to confirm that absence of guardrail fields
// in the definition is not a validation failure (correct behavior).
const GUARDRAILS_ABSENT_FROM_DEFINITION: ValidFixture = {
  id: "V-19-guardrails-not-in-definition",
  intent:
    "Confirms that LoopDefinition does not include guardrail fields; guardrails are a separate DB column. A definition without any guardrail keys is fully valid.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── V-20: Edge case — single character node ids ───────────────────────────────

const SINGLE_CHAR_IDS: ValidFixture = {
  id: "V-20-single-char-ids",
  intent:
    "Node ids with single character — boundary test for min(1) id length requirement.",
  definition: {
    nodes: [
      { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
      { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "x", source: "s", target: "e", when: "always" }],
  },
};

// ── V-21: Edge case — large positions ────────────────────────────────────────

const LARGE_POSITIONS: ValidFixture = {
  id: "V-21-large-positions",
  intent:
    "Node positions with very large coordinates — no size cap on positions, only on total serialized bytes (VR-10).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 99999, y: -99999 },
      },
      {
        id: "end",
        kind: "end",
        label: "End",
        position: { x: 199999, y: -99999 },
      },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── V-22: Complex graph with all node kinds ───────────────────────────────────

const ALL_NODE_KINDS: ValidFixture = {
  id: "V-22-all-node-kinds",
  intent:
    "Definition containing every node kind: start, agent_step, github_check, condition, end. The parity suite asserts this round-trips losslessly.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Analyze",
        position: { x: 200, y: 0 },
        instructions: "Analyze the repo state",
      },
      {
        id: "gh1",
        kind: "github_check",
        label: "Check CI",
        position: { x: 400, y: 0 },
        check: { kind: "ci_status", refFrom: "context.head_sha" },
      },
      {
        id: "cond1",
        kind: "condition",
        label: "CI passed?",
        position: { x: 600, y: 0 },
        condition: { path: "ci.conclusion", op: "eq", value: "success" },
      },
      {
        id: "step2",
        kind: "agent_step",
        label: "Fix issues",
        position: { x: 800, y: 100 },
        instructions: "Fix the CI failures",
      },
      { id: "end", kind: "end", label: "Done", position: { x: 1000, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "gh1", when: "success" },
      { id: "e3", source: "gh1", target: "cond1", when: "success" },
      { id: "e4", source: "cond1", target: "end", when: "true" },
      { id: "e5", source: "cond1", target: "step2", when: "false" },
      { id: "e6", source: "step2", target: "step1", when: "always" },
    ],
  },
};

// ── V-23: Parallel edges between same node pair ───────────────────────────────

const PARALLEL_EDGES: ValidFixture = {
  id: "V-23-parallel-edges",
  intent:
    "Two edges between start→step using different when values. VR-07 forbids duplicate (source,when) pairs but allows different when values. definitionToFlow adds parallelIndex/parallelCount.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step",
        position: { x: 200, y: 0 },
      },
      {
        id: "end-ok",
        kind: "end",
        label: "OK",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-fail",
        kind: "end",
        label: "Fail",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "end-ok", when: "success" },
      { id: "e3", source: "step1", target: "end-fail", when: "failure" },
    ],
  },
};

// ── V-24: Zero-position nodes (x:0, y:0) ─────────────────────────────────────

const ZERO_POSITIONS: ValidFixture = {
  id: "V-24-zero-positions",
  intent:
    "All nodes at (0,0). Zero is a valid position value; position is required but has no minimum constraint beyond being a number.",
  definition: {
    nodes: [
      { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
      { id: "end", kind: "end", label: "E", position: { x: 0, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── V-25: github_check list_issues with no optional fields ───────────────────

const GITHUB_CHECK_LIST_ISSUES_MINIMAL: ValidFixture = {
  id: "V-25-github-check-list-issues-minimal",
  intent:
    "github_check with kind=list_issues and no labels or state (both optional). VR-12 is satisfied by presence of check config.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh1",
        kind: "github_check",
        label: "Issues",
        position: { x: 200, y: 0 },
        check: { kind: "list_issues" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh1", when: "always" },
      { id: "e2", source: "gh1", target: "end", when: "success" },
    ],
  },
};

// ════════════════════════════════════════════════════════════════════════════
// INVALID FIXTURES — one per violated rule
// ════════════════════════════════════════════════════════════════════════════

// ── I-VR-01a: No start node ───────────────────────────────────────────────────

const INVALID_NO_START: InvalidFixture = {
  id: "I-VR-01a-no-start",
  rule: "no_start",
  intent: "VR-01: definition with no start node must be rejected.",
  definition: {
    nodes: [
      {
        id: "step1",
        kind: "agent_step",
        label: "Step",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "step1", target: "end", when: "success" }],
  },
};

// ── I-VR-01b: Multiple start nodes ───────────────────────────────────────────

const INVALID_MULTIPLE_STARTS: InvalidFixture = {
  id: "I-VR-01b-multiple-starts",
  rule: "multiple_start",
  intent: "VR-01: definition with two start nodes must be rejected.",
  definition: {
    nodes: [
      {
        id: "start1",
        kind: "start",
        label: "Start 1",
        position: { x: 0, y: 0 },
      },
      {
        id: "start2",
        kind: "start",
        label: "Start 2",
        position: { x: 100, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start1", target: "end", when: "always" },
      { id: "e2", source: "start2", target: "end", when: "always" },
    ],
  },
};

// ── I-VR-02: No end node ──────────────────────────────────────────────────────

const INVALID_NO_END: InvalidFixture = {
  id: "I-VR-02-no-end",
  rule: "no_end",
  intent: "VR-02: definition with no end node must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step",
        position: { x: 200, y: 0 },
      },
    ],
    edges: [{ id: "e1", source: "start", target: "step1", when: "always" }],
  },
};

// ── I-VR-03: Dangling edge — unknown source ───────────────────────────────────

const INVALID_DANGLING_EDGE_SOURCE: InvalidFixture = {
  id: "I-VR-03a-dangling-source",
  rule: "dangling_edge",
  intent:
    "VR-03: edge whose source references a node id that does not exist in nodes array.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "nonexistent", target: "end", when: "always" }],
  },
};

// ── I-VR-03b: Dangling edge — unknown target ──────────────────────────────────

const INVALID_DANGLING_EDGE_TARGET: InvalidFixture = {
  id: "I-VR-03b-dangling-target",
  rule: "dangling_edge",
  intent:
    "VR-03: edge whose target references a node id that does not exist in nodes array.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "end", when: "always" },
      { id: "e2", source: "start", target: "ghost-node", when: "always" },
    ],
  },
};

// ── I-VR-04: Non-end node with no outgoing edge ───────────────────────────────

const INVALID_NO_OUTGOING_EDGE: InvalidFixture = {
  id: "I-VR-04-no-outgoing-edge",
  rule: "no_outgoing_edge",
  intent:
    "VR-04: non-end node (agent_step) with no outgoing edges must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Dead end",
        position: { x: 200, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      // step1 has no outgoing edge
    ],
  },
};

// ── I-VR-05a: Condition node missing true edge ────────────────────────────────

const INVALID_CONDITION_MISSING_TRUE: InvalidFixture = {
  id: "I-VR-05a-condition-no-true",
  rule: "missing_condition_edge",
  intent:
    "VR-05: condition node with only a false outgoing edge must be rejected (missing true).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Check",
        position: { x: 200, y: 0 },
        condition: { path: "x", op: "exists" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end", when: "false" },
      // missing true edge
    ],
  },
};

// ── I-VR-05b: Condition node missing false edge ───────────────────────────────

const INVALID_CONDITION_MISSING_FALSE: InvalidFixture = {
  id: "I-VR-05b-condition-no-false",
  rule: "missing_condition_edge",
  intent:
    "VR-05: condition node with only a true outgoing edge must be rejected (missing false).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Check",
        position: { x: 200, y: 0 },
        condition: { path: "x", op: "exists" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end", when: "true" },
      // missing false edge
    ],
  },
};

// ── I-VR-06: Non-condition node using true/false when ────────────────────────

const INVALID_NON_CONDITION_TRUE_WHEN: InvalidFixture = {
  id: "I-VR-06-non-condition-true-when",
  rule: "invalid_when",
  intent:
    "VR-06: start node using when=true must be rejected (only condition nodes may use true/false).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "true" }],
  },
};

// ── I-VR-07: Duplicate (source, when) pair ────────────────────────────────────

const INVALID_DUPLICATE_WHEN: InvalidFixture = {
  id: "I-VR-07-duplicate-when",
  rule: "duplicate_when",
  intent:
    "VR-07: two edges from the same source with the same when value must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "end1",
        kind: "end",
        label: "End 1",
        position: { x: 200, y: -100 },
      },
      {
        id: "end2",
        kind: "end",
        label: "End 2",
        position: { x: 200, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "end1", when: "always" },
      { id: "e2", source: "start", target: "end2", when: "always" },
    ],
  },
};

// ── I-VR-08: End unreachable from start ──────────────────────────────────────

const INVALID_END_UNREACHABLE: InvalidFixture = {
  id: "I-VR-08-end-unreachable",
  rule: "end_unreachable",
  intent:
    "VR-08: start→step1, step1→step2 (cycle with no exit to end), end isolated. BFS from start cannot reach end.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Step 1",
        position: { x: 200, y: 0 },
      },
      {
        id: "step2",
        kind: "agent_step",
        label: "Step 2",
        position: { x: 400, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 600, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "step2", when: "success" },
      { id: "e3", source: "step2", target: "step1", when: "always" },
      // end is never reached
    ],
  },
};

// ── I-VR-10: Definition too large (>64KB) ─────────────────────────────────────

/** Build a definition that serializes to > 64KB. */
function buildOversizedDefinition(): unknown {
  const padding = "x".repeat(65 * 1024);
  return {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "step1",
        kind: "agent_step",
        label: "Padded",
        position: { x: 200, y: 0 },
        instructions: padding,
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "step1", when: "always" },
      { id: "e2", source: "step1", target: "end", when: "success" },
    ],
  };
}

const INVALID_TOO_LARGE: InvalidFixture = {
  id: "I-VR-10-too-large",
  rule: "definition_too_large",
  intent:
    "VR-10: definition whose serialized JSON exceeds 64KB must be rejected before schema parsing.",
  definition: buildOversizedDefinition(),
};

// ── I-VR-11: Forbidden node id ────────────────────────────────────────────────

const INVALID_FORBIDDEN_NODE_ID: InvalidFixture = {
  id: "I-VR-11-forbidden-id",
  rule: "forbidden_node_id",
  intent:
    "VR-11: node with id='__proto__' is forbidden (prototype-pollution risk).",
  definition: {
    nodes: [
      {
        id: "__proto__",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "__proto__", target: "end", when: "always" }],
  },
};

// ── I-VR-12: github_check node missing check config ──────────────────────────

const INVALID_GITHUB_CHECK_NO_CONFIG: InvalidFixture = {
  id: "I-VR-12-github-check-no-config",
  rule: "missing_node_config",
  intent:
    "VR-12: github_check node without a check config object must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "gh1",
        kind: "github_check",
        label: "Unconfigured",
        position: { x: 200, y: 0 },
        // no check field
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gh1", when: "always" },
      { id: "e2", source: "gh1", target: "end", when: "success" },
    ],
  },
};

// ── I-VR-13: condition node missing condition config ──────────────────────────

const INVALID_CONDITION_NO_CONFIG: InvalidFixture = {
  id: "I-VR-13-condition-no-config",
  rule: "missing_node_config",
  intent:
    "VR-13: condition node without a condition config object must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Unconfigured",
        position: { x: 200, y: 0 },
        // no condition field
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end", when: "true" },
      { id: "e3", source: "cond", target: "end", when: "false" },
    ],
  },
};

// ── I-VR-14: condition op requires value but value absent ─────────────────────

const INVALID_CONDITION_MISSING_VALUE: InvalidFixture = {
  id: "I-VR-14-condition-missing-value",
  rule: "missing_condition_value",
  intent:
    "VR-14: condition op=eq requires a value field; absent value must be rejected.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Missing value",
        position: { x: 200, y: 0 },
        condition: { path: "status", op: "eq" /* no value */ },
      },
      {
        id: "end-t",
        kind: "end",
        label: "True",
        position: { x: 400, y: -100 },
      },
      {
        id: "end-f",
        kind: "end",
        label: "False",
        position: { x: 400, y: 100 },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      { id: "e2", source: "cond", target: "end-t", when: "true" },
      { id: "e3", source: "cond", target: "end-f", when: "false" },
    ],
  },
};

// ── I-VR-15: Schema error — wrong type for position ──────────────────────────

const INVALID_SCHEMA_ERROR: InvalidFixture = {
  id: "I-VR-15-schema-error",
  rule: "schema_error",
  intent:
    "VR-15: position.x must be a number; string value fails zod structural validation.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: "not-a-number", y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── I-VR-17: Duplicate node ids ───────────────────────────────────────────────

const INVALID_DUPLICATE_NODE_ID: InvalidFixture = {
  id: "I-VR-17-duplicate-node-id",
  rule: "duplicate_node_id",
  intent:
    "VR-17: two nodes sharing the same id must be rejected before any downstream rule runs.",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "start",
        kind: "agent_step",
        label: "Duplicate",
        position: { x: 200, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
};

// ── I-VR-18: Condition node outgoing edge using non-true/false when ───────────

const INVALID_CONDITION_WRONG_WHEN: InvalidFixture = {
  id: "I-VR-18-condition-wrong-when",
  rule: "invalid_condition_edge",
  intent:
    "VR-18: condition node with a 'success' outgoing edge must be rejected (only true/false are legal for condition nodes).",
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "cond",
        kind: "condition",
        label: "Check",
        position: { x: 200, y: 0 },
        condition: { path: "x", op: "exists" },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", when: "always" },
      // VR-18 violation: condition node must not use 'success'
      { id: "e2", source: "cond", target: "end", when: "success" },
    ],
  },
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTED COLLECTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * All valid fixtures. The parity suite asserts:
 *   - validateLoopDefinition returns ok:true
 *   - definitionToFlow → flowToDefinition round-trip is deep-equal
 *   - double round-trip is byte-stable (JSON.stringify)
 */
export const VALID_FIXTURES: ValidFixture[] = [
  MINIMAL,
  AGENT_STEP_FULL,
  AGENT_STEP_FAILURE_EDGE,
  GITHUB_CHECK_LIST_ISSUES,
  GITHUB_CHECK_PR_STATUS,
  GITHUB_CHECK_DEPLOYMENT_STATUS,
  GITHUB_CHECK_CI_STATUS,
  CONDITION_EQ,
  CONDITION_NEQ,
  CONDITION_GT,
  CONDITION_GTE,
  CONDITION_LT,
  CONDITION_LTE,
  CONDITION_EXISTS,
  CONDITION_CONTAINS,
  SELF_LOOP_CONDITION,
  MULTI_HOP_CYCLE,
  MULTIPLE_END_NODES,
  GUARDRAILS_ABSENT_FROM_DEFINITION,
  SINGLE_CHAR_IDS,
  LARGE_POSITIONS,
  ALL_NODE_KINDS,
  PARALLEL_EDGES,
  ZERO_POSITIONS,
  GITHUB_CHECK_LIST_ISSUES_MINIMAL,
];

/**
 * All invalid fixtures. The parity suite asserts:
 *   - validateLoopDefinition returns ok:false
 *   - The errors array contains at least one error with a rule matching the fixture rule
 */
export const INVALID_FIXTURES: InvalidFixture[] = [
  INVALID_NO_START,
  INVALID_MULTIPLE_STARTS,
  INVALID_NO_END,
  INVALID_DANGLING_EDGE_SOURCE,
  INVALID_DANGLING_EDGE_TARGET,
  INVALID_NO_OUTGOING_EDGE,
  INVALID_CONDITION_MISSING_TRUE,
  INVALID_CONDITION_MISSING_FALSE,
  INVALID_NON_CONDITION_TRUE_WHEN,
  INVALID_DUPLICATE_WHEN,
  INVALID_END_UNREACHABLE,
  INVALID_TOO_LARGE,
  INVALID_FORBIDDEN_NODE_ID,
  INVALID_GITHUB_CHECK_NO_CONFIG,
  INVALID_CONDITION_NO_CONFIG,
  INVALID_CONDITION_MISSING_VALUE,
  INVALID_SCHEMA_ERROR,
  INVALID_DUPLICATE_NODE_ID,
  INVALID_CONDITION_WRONG_WHEN,
];
