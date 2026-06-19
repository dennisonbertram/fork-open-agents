import { describe, expect, test } from "bun:test";
import {
  type DraftLoop,
  draftLoopSchema,
  extractJsonObject,
  layoutDraftDefinition,
} from "./draft";
import { validateLoopDefinition } from "./validation";

const backlogDraft: DraftLoop = {
  name: "Backlog to PR",
  description: "Implement an issue and loop on fixes until review passes.",
  nodes: [
    { id: "start", kind: "start", label: "Start" },
    { id: "implement", kind: "agent_step", label: "Implement" },
    { id: "review", kind: "agent_step", label: "Review" },
    {
      id: "gate",
      kind: "condition",
      label: "Passed?",
      condition: { path: "review.passed", op: "eq", value: true },
    },
    { id: "fix", kind: "agent_step", label: "Fix" },
    { id: "pr", kind: "agent_step", label: "Open PR" },
    { id: "end", kind: "end", label: "Done" },
  ],
  edges: [
    { id: "e1", source: "start", target: "implement", when: "always" },
    { id: "e2", source: "implement", target: "review", when: "success" },
    { id: "e3", source: "review", target: "gate", when: "success" },
    { id: "e4", source: "gate", target: "pr", when: "true" },
    { id: "e5", source: "gate", target: "fix", when: "false" },
    { id: "e6", source: "fix", target: "review", when: "success" },
    { id: "e7", source: "pr", target: "end", when: "success" },
  ],
};

describe("draft → loop definition", () => {
  test("layout produces a definition that passes validateLoopDefinition", () => {
    const def = layoutDraftDefinition(backlogDraft);
    const result = validateLoopDefinition(def);
    if (!result.ok) {
      throw new Error(`invalid: ${JSON.stringify(result.errors)}`);
    }
    expect(result.ok).toBe(true);
  });

  test("every node gets a position and depth increases left-to-right", () => {
    const def = layoutDraftDefinition(backlogDraft);
    for (const node of def.nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
    const x = (id: string) =>
      def.nodes.find((n) => n.id === id)?.position.x ?? -1;
    expect(x("start")).toBeLessThan(x("implement"));
    expect(x("implement")).toBeLessThan(x("review"));
    expect(x("review")).toBeLessThan(x("gate"));
  });

  test("condition node carries its condition through layout", () => {
    const def = layoutDraftDefinition(backlogDraft);
    const gate = def.nodes.find((n) => n.id === "gate");
    expect(gate?.kind).toBe("condition");
    if (gate?.kind === "condition") {
      expect(gate.condition?.path).toBe("review.passed");
    }
  });

  test("draftLoopSchema rejects an empty graph", () => {
    expect(
      draftLoopSchema.safeParse({ name: "x", nodes: [], edges: [] }).success,
    ).toBe(false);
  });

  test("extractJsonObject pulls JSON out of fenced/prose output", () => {
    expect(extractJsonObject('here you go ```{"a":1}``` done')).toBe('{"a":1}');
    expect(extractJsonObject("no json here")).toBeNull();
  });
});
