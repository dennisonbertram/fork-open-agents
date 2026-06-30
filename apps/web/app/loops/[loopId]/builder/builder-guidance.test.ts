import { describe, expect, test } from "bun:test";
import { buildBuilderGuidance } from "./builder-guidance";
import { definitionToFlow } from "./definition-mapping";
import type { LoopDefinition } from "@/lib/agent-loops/types";

const starterDefinition: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end", kind: "end", label: "End", position: { x: 300, y: 0 } },
  ],
  edges: [],
};

const validDefinition: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "agent",
      kind: "agent_step",
      label: "Draft summary",
      position: { x: 300, y: 0 },
      instructions: "Summarize the issue.",
    },
    { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "start-agent", source: "start", target: "agent", when: "always" },
    { id: "agent-end", source: "agent", target: "end", when: "success" },
  ],
};

const validGithubCheckDefinition: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "issues",
      kind: "github_check",
      label: "Open issues",
      position: { x: 300, y: 0 },
      check: { kind: "list_issues", state: "open" },
    },
    { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "start-issues", source: "start", target: "issues", when: "always" },
    { id: "issues-end", source: "issues", target: "end", when: "success" },
  ],
};

describe("buildBuilderGuidance", () => {
  test("points new loops at the first connected agent step", () => {
    const { nodes, edges } = definitionToFlow(starterDefinition);
    const guidance = buildBuilderGuidance({
      nodes,
      edges,
      validationErrors: [
        {
          kind: "loop_invalid",
          rule: "no_outgoing_edge",
          nodeId: "start",
          message:
            'Node "start" (kind: start) has no outgoing edges. Every non-end node must have at least one.',
        },
      ],
      isDirty: false,
    });

    expect(guidance.headline).toBe("Build the loop one card at a time");
    expect(guidance.steps[0]).toMatchObject({
      title: "Start with one work card",
      state: "current",
    });
    expect(guidance.steps[1]).toMatchObject({
      title: "Keep every card connected",
      state: "blocked",
    });
  });

  test("surfaces the first useful validation error as the active fix", () => {
    const { nodes, edges } = definitionToFlow(validDefinition);
    const guidance = buildBuilderGuidance({
      nodes,
      edges,
      validationErrors: [
        {
          kind: "loop_invalid",
          rule: "missing_node_config",
          nodeId: "agent",
          nodeKind: "agent_step",
          message: "Agent step needs instructions before it can run.",
        },
      ],
      isDirty: true,
    });

    expect(guidance.headline).toBe("One fix before this loop can run");
    expect(guidance.detail).toBe(
      "Agent step needs instructions before it can run.",
    );
    expect(guidance.steps[3]).toMatchObject({
      title: "Save when the badge is green",
      state: "current",
    });
  });

  test("tells the user when a valid dirty loop is ready to save", () => {
    const { nodes, edges } = definitionToFlow(validDefinition);
    nodes[1] = { ...nodes[1]!, selected: true };
    const guidance = buildBuilderGuidance({
      nodes,
      edges,
      validationErrors: [],
      isDirty: true,
    });

    expect(guidance.headline).toBe("This loop is ready to save");
    expect(guidance.steps[2]).toMatchObject({
      title: "Configure Draft summary",
      state: "current",
    });
    expect(guidance.steps[3]).toMatchObject({
      state: "done",
    });
  });

  test("treats valid GitHub-check-only loops as ready to save", () => {
    const { nodes, edges } = definitionToFlow(validGithubCheckDefinition);
    const guidance = buildBuilderGuidance({
      nodes,
      edges,
      validationErrors: [],
      isDirty: true,
    });

    expect(guidance.headline).toBe("This loop is ready to save");
    expect(guidance.steps[0]).toMatchObject({
      title: "Start with one work card",
      state: "done",
    });
    expect(guidance.steps[3]).toMatchObject({
      state: "done",
    });
  });
});
