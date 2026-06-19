/**
 * P2 review-fixes tests — TDD RED phase
 *
 * FINDING 1 (guardrail bypass): createAgentLoopBodySchema and
 *   updateAgentLoopBodySchema accepted any JSON object for the guardrails field.
 *   String values like "never" pass the `?? GUARDRAIL_DEFAULTS` coalescing in
 *   chain.ts (non-null/undefined) and then Math.min("never", 200) → NaN, making
 *   the ceiling check always false. Fix: validate guardrails fields as strict
 *   numeric values at the API boundary.
 *
 * FINDING 2 (retry TOCTOU race): see store.test.ts BT-P2-12/13 — those tests
 *   live in store.test.ts which has the full DB mock setup they need.
 *
 * BT-P2-01: createAgentLoopBodySchema rejects string maxStepsPerRun
 * BT-P2-02: createAgentLoopBodySchema rejects string maxIterations
 * BT-P2-03: createAgentLoopBodySchema rejects unknown guardrail keys (.strict())
 * BT-P2-04: createAgentLoopBodySchema accepts valid numeric guardrails
 * BT-P2-05: createAgentLoopBodySchema accepts null guardrails
 * BT-P2-06: createAgentLoopBodySchema accepts omitted guardrails
 * BT-P2-07: updateAgentLoopBodySchema rejects string maxStepsPerRun
 * BT-P2-08: updateAgentLoopBodySchema rejects string maxIterations
 * BT-P2-09: updateAgentLoopBodySchema accepts valid numeric guardrails
 * BT-P2-10: updateAgentLoopBodySchema accepts null guardrails
 * BT-P2-11: updateAgentLoopBodySchema rejects unknown guardrail keys (.strict())
 * BT-P2-04b: createAgentLoopBodySchema accepts all four numeric fields
 * BT-P2-09b: updateAgentLoopBodySchema accepts all four numeric fields
 * BT-P2-R1: loopGuardrailsSchema from types.ts rejects string values
 * BT-P2-R2: loopGuardrailsSchema rejects unknown keys
 * BT-P2-R3: loopGuardrailsSchema accepts valid complete guardrail object
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── FINDING 1: request-schema guardrail validation ───────────────────────────

describe("BT-P2-01–11: guardrails schema validation in request schemas", () => {
  test("BT-P2-01: createAgentLoopBodySchema rejects string maxStepsPerRun", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: { maxStepsPerRun: "never" },
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-02: createAgentLoopBodySchema rejects string maxIterations", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: { maxIterations: "never" },
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-03: createAgentLoopBodySchema rejects unknown guardrail keys (.strict())", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: { maxStepsPerRun: 10, unknownKey: "bad" },
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-04: createAgentLoopBodySchema accepts valid numeric guardrails", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-04b: createAgentLoopBodySchema accepts all four numeric guardrail fields", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: {
        maxStepsPerRun: 100,
        maxIterations: 20,
        maxRunDurationMs: 7200000,
        stepTimeoutMs: 600000,
      },
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-05: createAgentLoopBodySchema accepts null guardrails", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      guardrails: null,
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-06: createAgentLoopBodySchema accepts omitted guardrails", async () => {
    const { createAgentLoopBodySchema } = await import("./request-schemas");
    const result = createAgentLoopBodySchema.safeParse({
      name: "Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-07: updateAgentLoopBodySchema rejects string maxStepsPerRun", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: { maxStepsPerRun: "never" },
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-08: updateAgentLoopBodySchema rejects string maxIterations", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: { maxIterations: "never" },
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-09: updateAgentLoopBodySchema accepts valid numeric guardrails", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: { maxStepsPerRun: 100, maxIterations: 20 },
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-09b: updateAgentLoopBodySchema accepts all four numeric guardrail fields", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: {
        maxStepsPerRun: 50,
        maxIterations: 10,
        maxRunDurationMs: 3600000,
        stepTimeoutMs: 300000,
      },
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-10: updateAgentLoopBodySchema accepts null guardrails", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: null,
    });
    expect(result.success).toBe(true);
  });

  test("BT-P2-11: updateAgentLoopBodySchema rejects unknown guardrail keys (.strict())", async () => {
    const { updateAgentLoopBodySchema } = await import("./request-schemas");
    const result = updateAgentLoopBodySchema.safeParse({
      guardrails: { maxStepsPerRun: 10, unknownKey: true },
    });
    expect(result.success).toBe(false);
  });
});

// ── loopGuardrailsSchema from types.ts ────────────────────────────────────────

describe("BT-P2-R1–R3: loopGuardrailsSchema in types.ts is strict and numeric", () => {
  test("BT-P2-R1: loopGuardrailsSchema rejects string values for numeric fields", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    const result = loopGuardrailsSchema.safeParse({
      maxStepsPerRun: "never",
    });
    expect(result.success).toBe(false);
  });

  test("BT-P2-R2: loopGuardrailsSchema rejects unknown keys (strict mode)", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    const result = loopGuardrailsSchema.safeParse({
      maxStepsPerRun: 50,
      injected: "payload",
    });
    // types.ts loopGuardrailsSchema does NOT currently use .strict() — this
    // test may pass or fail depending on the fix. After fix it must reject.
    expect(result.success).toBe(false);
  });

  test("BT-P2-R3: loopGuardrailsSchema accepts a valid complete guardrail object", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    const result = loopGuardrailsSchema.safeParse({
      maxStepsPerRun: 100,
      maxIterations: 25,
      maxRunDurationMs: 7200000,
      stepTimeoutMs: 600000,
    });
    expect(result.success).toBe(true);
  });

  // Negative-value, zero, and float inputs — all must be rejected by .int().positive()
  test("BT-P2-R4: loopGuardrailsSchema rejects negative maxStepsPerRun", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    expect(loopGuardrailsSchema.safeParse({ maxStepsPerRun: -1 }).success).toBe(
      false,
    );
  });

  test("BT-P2-R5: loopGuardrailsSchema rejects zero maxStepsPerRun", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    expect(loopGuardrailsSchema.safeParse({ maxStepsPerRun: 0 }).success).toBe(
      false,
    );
  });

  test("BT-P2-R6: loopGuardrailsSchema rejects float maxStepsPerRun", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    expect(
      loopGuardrailsSchema.safeParse({ maxStepsPerRun: 2.5 }).success,
    ).toBe(false);
  });
});
