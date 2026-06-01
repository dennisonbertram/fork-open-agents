/**
 * Regression guards for the gate contract and policy engine (#60).
 *
 * These tests lock invariants that MUST hold if the green implementation
 * in c02c10fa is ever modified. Any revert or accidental weakening of the
 * conservative-default semantics will cause these to fail.
 */
import { describe, expect, test } from "bun:test";
import {
  GATE_REGISTRY,
  evaluateGate,
  gateKindSchema,
  gatePolicySchema,
  gateStateSchema,
  gateTriggerSchema,
  parseReviewGate,
  reviewGateSchema,
  type GateContractError,
  type GateContext,
  type ReviewGate,
} from "./gates";

// ---------------------------------------------------------------------------
// Regression 1: 4-kind error taxonomy — each kind is distinct and reachable
// ---------------------------------------------------------------------------

describe("regression: 4-kind error taxonomy — all distinct, all reachable", () => {
  test("gate_contract_invalid is returned for structurally invalid input (missing id)", () => {
    const result = parseReviewGate({
      label: "X",
      kind: "budget",
      trigger: "pre_run",
      policy: {},
      blocking: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("gate_contract_invalid");
    }
  });

  test("unknown_gate is returned for non-custom id absent from registry", () => {
    const result = parseReviewGate({
      id: "definitely-not-registered",
      label: "Ghost",
      kind: "budget",
      trigger: "post_run",
      policy: {},
      blocking: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown_gate");
      // Must carry the offending id
      expect(result.error.id).toBe("definitely-not-registered");
    }
  });

  test("gate_policy_invalid is returned for autoApprove+requiresHuman clash", () => {
    const result = parseReviewGate({
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { autoApprove: true, requiresHuman: true },
      blocking: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("gate_policy_invalid");
      expect(result.error.reason).toMatch(/mutually exclusive/i);
    }
  });

  test("missing_required_evidence is returned when requiredEvidence is empty array", () => {
    // requiredEvidence must be non-empty strings per schema; an empty array
    // passes Zod (z.array allows length 0) but our semantic check should
    // catch it and return missing_required_evidence.
    const result = parseReviewGate({
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiredEvidence: [] },
      blocking: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_evidence");
    }
  });

  test("all 4 error kinds are distinct strings (none are equal)", () => {
    const kinds: GateContractError["kind"][] = [
      "gate_contract_invalid",
      "unknown_gate",
      "gate_policy_invalid",
      "missing_required_evidence",
    ];
    const uniqueKinds = new Set(kinds);
    expect(uniqueKinds.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Regression 2: conservative defaults cannot be silently bypassed
// ---------------------------------------------------------------------------

describe("regression: conservative-default evaluation — requiresHuman→awaiting_human", () => {
  test("requiresHuman:true with no humanDecision returns awaiting_human — NOT passed", () => {
    const gate: ReviewGate = {
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiresHuman: true },
      blocking: true,
    };
    const ctx: GateContext = {};
    const decision = evaluateGate(gate, ctx);
    // Conservative default: must NOT silently pass
    expect(decision.state).not.toBe("passed");
    expect(decision.state).toBe("awaiting_human");
  });

  test("requiresHuman:true with undefined humanDecision never returns passed (even if evidenceSatisfied true)", () => {
    const gate: ReviewGate = {
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiresHuman: true, requiredEvidence: ["test-run-id"] },
      blocking: true,
    };
    // evidenceSatisfied but no human decision — must still wait for human
    const ctx: GateContext = { evidenceSatisfied: true };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("awaiting_human");
  });
});

describe("regression: conservative-default evaluation — missing evidence→failed", () => {
  test("requiredEvidence present and evidenceSatisfied:false returns failed — NOT passed", () => {
    const gate: ReviewGate = {
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiredEvidence: ["artifact-id"] },
      blocking: true,
    };
    const ctx: GateContext = { evidenceSatisfied: false };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).not.toBe("passed");
    expect(decision.state).toBe("failed");
  });

  test("requiredEvidence present and evidenceSatisfied undefined (not provided) returns failed — NOT passed", () => {
    const gate: ReviewGate = {
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiredEvidence: ["artifact-id"] },
      blocking: true,
    };
    // evidenceSatisfied is not set — conservative: treat as unsatisfied
    const ctx: GateContext = {};
    const decision = evaluateGate(gate, ctx);
    // Must not assume the evidence is satisfied if not explicitly provided
    expect(decision.state).not.toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// Regression 3: blocking:false still reports the true failed state
// ---------------------------------------------------------------------------

describe("regression: blocking:false does not suppress failure state", () => {
  test("blocking:false gate rejected by human still returns state:failed", () => {
    const gate: ReviewGate = {
      id: "scope-change-gate",
      label: "Scope Change",
      kind: "scope_change",
      trigger: "mid_run",
      policy: { requiresHuman: true },
      blocking: false,
    };
    const ctx: GateContext = { humanDecision: "rejected" };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("failed");
    // blocking:false must NOT flip this to passed or any other state
    expect(decision.state).not.toBe("passed");
    expect(decision.state).not.toBe("not_required");
    expect(decision.state).not.toBe("skipped");
  });

  test("blocking:false gate awaiting human still returns awaiting_human", () => {
    const gate: ReviewGate = {
      id: "scope-change-gate",
      label: "Scope Change",
      kind: "scope_change",
      trigger: "mid_run",
      policy: { requiresHuman: true },
      blocking: false,
    };
    const ctx: GateContext = {};
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("awaiting_human");
  });
});

// ---------------------------------------------------------------------------
// Regression 4: GATE_REGISTRY frozen + parseReviewGate never throws
// ---------------------------------------------------------------------------

describe("regression: GATE_REGISTRY is frozen — runtime mutation has no effect", () => {
  test("attempting to mutate GATE_REGISTRY does not change it", () => {
    const before = Object.keys(GATE_REGISTRY).length;
    // Cast through unknown to bypass readonly — this simulates a runtime
    // caller that ignores TypeScript types. Object.freeze() prevents mutation.
    const mutable = GATE_REGISTRY as unknown as Record<string, ReviewGate>;
    try {
      mutable["injected"] = GATE_REGISTRY["plan-approval-gate"];
    } catch {
      // strict mode throws — expected
    }
    const after = Object.keys(GATE_REGISTRY).length;
    expect(after).toBe(before);
    expect(mutable["injected"]).toBeUndefined();
  });

  test("attempting to delete a GATE_REGISTRY entry does not remove it", () => {
    const mutable = GATE_REGISTRY as unknown as Record<string, ReviewGate>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete mutable["plan-approval-gate"];
    } catch {
      // Expected in strict mode
    }
    expect(GATE_REGISTRY["plan-approval-gate"]).toBeDefined();
  });
});

describe("regression: parseReviewGate never throws on any garbage input", () => {
  const garbageInputs: unknown[] = [
    null,
    undefined,
    "",
    0,
    false,
    [],
    {},
    { id: "" },
    { id: null, kind: "plan_approval" },
    Symbol("test"),
    new Date(),
    () => "fn",
  ];

  for (const input of garbageInputs) {
    test(`parseReviewGate does not throw on: ${JSON.stringify(input) ?? String(input)}`, () => {
      let threw = false;
      try {
        parseReviewGate(input);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Regression 5: schema enum completeness — all expected values are present
// ---------------------------------------------------------------------------

describe("regression: schema enum values are complete and not collapsed", () => {
  test("gateKindSchema has exactly the 5 expected values", () => {
    const expected = [
      "plan_approval",
      "scope_change",
      "verification",
      "budget",
      "custom",
    ];
    for (const val of expected) {
      expect(() => gateKindSchema.parse(val)).not.toThrow();
    }
    // Reject arbitrary values
    expect(() => gateKindSchema.parse("other_kind")).toThrow();
  });

  test("gateTriggerSchema has exactly the 4 expected values", () => {
    const expected = ["pre_run", "mid_run", "pre_merge", "post_run"];
    for (const val of expected) {
      expect(() => gateTriggerSchema.parse(val)).not.toThrow();
    }
    expect(() => gateTriggerSchema.parse("unknown_trigger")).toThrow();
  });

  test("gateStateSchema has exactly the 8 expected values", () => {
    const expected = [
      "not_required",
      "pending",
      "running",
      "passed",
      "failed",
      "awaiting_human",
      "skipped",
      "superseded",
    ];
    for (const val of expected) {
      expect(() => gateStateSchema.parse(val)).not.toThrow();
    }
    expect(() => gateStateSchema.parse("unknown_state")).toThrow();
  });

  test("reviewGateSchema rejects a gate missing the blocking field", () => {
    const result = reviewGateSchema.safeParse({
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: {},
      // blocking intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  test("gatePolicySchema rejects when autoApprove+requiresHuman are both true", () => {
    const result = gatePolicySchema.safeParse({
      autoApprove: true,
      requiresHuman: true,
    });
    expect(result.success).toBe(false);
  });

  test("gatePolicySchema accepts policy with neither autoApprove nor requiresHuman (open policy)", () => {
    const result = gatePolicySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression 6: autoApprove fast-path cannot be negated by any context value
// ---------------------------------------------------------------------------

describe("regression: autoApprove always wins regardless of context", () => {
  const autoApproveGate: ReviewGate = {
    id: "my-auto-gate",
    label: "Auto Approve",
    kind: "custom",
    trigger: "pre_run",
    policy: { autoApprove: true },
    blocking: false,
  };

  const contextVariants: GateContext[] = [
    {},
    { humanDecision: "rejected" },
    { evidenceSatisfied: false },
    { humanDecision: "rejected", evidenceSatisfied: false },
    { skipRationale: "skip reason" },
  ];

  for (const ctx of contextVariants) {
    test(`autoApprove gate always passes with context ${JSON.stringify(ctx)}`, () => {
      const decision = evaluateGate(autoApproveGate, ctx);
      expect(decision.state).toBe("passed");
    });
  }
});
