/**
 * loop-step-summary.ts tests (#768)
 *
 * Behavior contract:
 *   BT-LSS-001: a simple linear loop (start -> agent_step -> end) summarizes
 *               as a numbered, human-readable list of its work steps (start
 *               and end nodes are not listed as "steps" themselves).
 *   BT-LSS-002: a step whose only outgoing edge is "success" (implying the
 *               loop stops on failure) surfaces "(on failure: stop)".
 *   BT-LSS-003: a github_check node summarizes using its check kind, not raw
 *               JSON.
 *   BT-LSS-004: an empty definition (no work steps) returns an empty list
 *               without throwing.
 */

import { describe, expect, test } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { summarizeLoopSteps } from "./loop-step-summary";

const reviewAndComment: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "list",
      kind: "agent_step",
      label: "List open PRs",
      position: { x: 200, y: 0 },
      instructions: "List open PRs.",
    },
    {
      id: "review",
      kind: "agent_step",
      label: "Review and comment",
      position: { x: 400, y: 0 },
      instructions: "Review and comment on each PR.",
    },
    { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "list", when: "always" },
    { id: "e2", source: "list", target: "review", when: "success" },
    { id: "e3", source: "review", target: "end", when: "success" },
  ],
};

describe("summarizeLoopSteps", () => {
  test("BT-LSS-001: summarizes a linear loop as a numbered human-readable list", () => {
    const summary = summarizeLoopSteps(reviewAndComment);

    expect(summary).toHaveLength(2);
    expect(summary[0]).toContain("List open PRs");
    expect(summary[1]).toContain("Review and comment");
  });

  test("BT-LSS-002: a step with only a success edge shows '(on failure: stop)'", () => {
    const summary = summarizeLoopSteps(reviewAndComment);

    // Both steps here only have "success" outgoing edges — no failure
    // handling is wired, so the run stops on failure.
    expect(summary[1]).toMatch(/on failure: stop/i);
  });

  test("BT-LSS-003: a github_check node summarizes using its check kind, not raw JSON", () => {
    const definition: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "ci",
          kind: "github_check",
          label: "Check CI",
          position: { x: 200, y: 0 },
          check: { kind: "ci_status", refFrom: "trigger.ref" },
        },
        { id: "end", kind: "end", label: "Done", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "ci", when: "always" },
        { id: "e2", source: "ci", target: "end", when: "success" },
      ],
    };

    const summary = summarizeLoopSteps(definition);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain("Check CI");
    expect(summary[0]).not.toContain("{");
    expect(summary[0]).not.toContain('"kind"');
  });

  test("BT-LSS-004: an empty definition returns an empty list without throwing", () => {
    const definition: LoopDefinition = { nodes: [], edges: [] };
    expect(() => summarizeLoopSteps(definition)).not.toThrow();
    expect(summarizeLoopSteps(definition)).toEqual([]);
  });
});
