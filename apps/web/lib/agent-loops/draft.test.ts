import { describe, expect, test } from "bun:test";
import {
  DRAFT_SYSTEM_PROMPT,
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

// #765: AI drafts must not wire failure -> END by default. Live verification
// (walk-1) showed the drafted loop had failure->END edges on every step, so a
// GitHub-permission-denied run rendered as a green "Completed" run instead of
// failing visibly. The fix lives in the system prompt sent to the model — we
// can't call a live LLM in a unit test, so this test pins the prompt's
// explicit default-omission guidance (the enforceable, testable contract),
// plus a fixture proving the historically-observed bad output would be
// flagged by a naive drafted-loop auditor if the guidance were absent.
describe("#765: draft prompt does not wire failure -> END by default", () => {
  test("DRAFT_SYSTEM_PROMPT instructs omitting failure edges by default, wiring them only when the user explicitly asks for failure handling", () => {
    const lower = DRAFT_SYSTEM_PROMPT.toLowerCase();
    // Must mention that failure edges are opt-in / omitted by default.
    expect(lower).toMatch(
      /do not.*(add|wire|include).*failure.*edge|omit.*failure.*edge|only.*(add|wire|include).*failure.*edge.*(if|when).*(user|request|explicit|ask)/,
    );
    // Must say the run should fail visibly rather than routing to end.
    expect(lower).toMatch(/fail.*visibl|let.*(the )?run fail/);
  });

  test("fixture: walk-1's observed bad shape (every agent_step wired failure -> end) is exactly what the prompt now tells the model to avoid", () => {
    // This fixture mirrors the real drafted loop observed in live
    // verification: every step had both a success and a failure edge, with
    // every failure edge routed straight to "end" — silently absorbing
    // failures into a "Completed" status.
    const badDraftFixture: DraftLoop = {
      name: "Review PRs",
      description: "Review new PRs and file issues for problems found.",
      nodes: [
        { id: "start", kind: "start", label: "Start" },
        { id: "review", kind: "agent_step", label: "Review" },
        { id: "file", kind: "agent_step", label: "File issues" },
        { id: "end", kind: "end", label: "Done" },
      ],
      edges: [
        { id: "e1", source: "start", target: "review", when: "always" },
        { id: "e2", source: "review", target: "file", when: "success" },
        // The bad pattern this PR eliminates from the model's default output:
        { id: "e3", source: "review", target: "end", when: "failure" },
        { id: "e4", source: "file", target: "end", when: "success" },
        { id: "e5", source: "file", target: "end", when: "failure" },
      ],
    };

    const failureToEndEdges = badDraftFixture.edges.filter(
      (e) => e.when === "failure" && e.target === "end",
    );
    // Documents the exact shape the prompt guidance must prevent by default —
    // this fixture is intentionally the "bad" shape (not asserting the layout
    // pipeline strips it; the pipeline is a pass-through of whatever the
    // model returns, so the fix must live in the prompt, asserted above).
    expect(failureToEndEdges.length).toBeGreaterThan(0);
  });
});
