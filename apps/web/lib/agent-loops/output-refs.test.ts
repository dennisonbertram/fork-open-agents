import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "./types";
import { availableOutputRefs, outputFieldNames } from "./output-refs";

describe("outputFieldNames", () => {
  it("returns top-level keys, skipping $-meta and undefined", () => {
    expect(outputFieldNames(undefined)).toEqual([]);
    expect(
      outputFieldNames({ passed: "boolean", issues: "array", $schema: "x" }),
    ).toEqual(["passed", "issues"]);
  });

  it("returns declared property names for a JSON-Schema-Lite shape (not type/required/properties)", () => {
    const fields = outputFieldNames({
      type: "object",
      required: ["passed"],
      properties: {
        passed: { type: "boolean" },
        notes: { type: "string" },
      },
    });
    expect(fields).toEqual(["passed", "notes"]);
    expect(fields).not.toContain("type");
    expect(fields).not.toContain("required");
    expect(fields).not.toContain("properties");
  });

  it("returns [] for a JSON-Schema-Lite shape with no properties object", () => {
    expect(outputFieldNames({ type: "object" })).toEqual([]);
  });

  it("edge case: a flat-map field literally named 'type' with a string type-name value stays a flat map", () => {
    // Every value is a string type-name → flat map, per the detection rule.
    // "type" here is a declared field name, not the JSON-Schema-Lite marker key.
    expect(outputFieldNames({ type: "string", passed: "boolean" })).toEqual([
      "type",
      "passed",
    ]);
  });
});

const DEF: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "review",
      kind: "agent_step",
      label: "Review",
      position: { x: 200, y: 0 },
      outputSchema: { passed: "boolean", notes: "string" },
    },
    {
      id: "gate",
      kind: "condition",
      label: "Passed?",
      position: { x: 400, y: 0 },
      condition: { path: "review.passed", op: "eq", value: true },
    },
    {
      id: "fix",
      kind: "agent_step",
      label: "Fix",
      position: { x: 300, y: 160 },
      outputSchema: { fixed: "boolean" },
    },
    { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "review", when: "always" },
    { id: "e2", source: "review", target: "gate", when: "success" },
    { id: "e3", source: "gate", target: "end", when: "true" },
    { id: "e4", source: "gate", target: "fix", when: "false" },
    { id: "e5", source: "fix", target: "review", when: "success" }, // cycle
  ],
};

describe("availableOutputRefs", () => {
  it("offers upstream agent_step outputs as <id>.<field>", () => {
    const refs = availableOutputRefs(DEF, "gate");
    expect(refs).toContain("review.passed");
    expect(refs).toContain("review.notes");
    // fix is an ancestor of gate through the cycle (fix→review→gate)
    expect(refs).toContain("fix.fixed");
  });

  it("excludes the node itself and non-ancestors", () => {
    // From 'review', only its ancestors' outputs (fix via cycle); not review's own
    const refs = availableOutputRefs(DEF, "review");
    expect(refs).not.toContain("review.passed");
  });

  it("returns [] when there are no upstream agent steps", () => {
    expect(availableOutputRefs(DEF, "start")).toEqual([]);
  });
});
