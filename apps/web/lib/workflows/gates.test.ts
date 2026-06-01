import { describe, expect, test } from "bun:test";
import {
  GATE_REGISTRY,
  evaluateGate,
  parseReviewGate,
  type GateContext,
  type ReviewGate,
} from "./gates";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PLAN_APPROVAL_DEF = {
  id: "plan-approval-gate",
  label: "Plan Approval",
  kind: "plan_approval",
  trigger: "pre_run",
  policy: { requiresHuman: true },
  blocking: true,
};

const GO_NO_GO_DEF = {
  id: "go-no-go-gate",
  label: "Go / No-Go",
  kind: "verification",
  trigger: "post_run",
  policy: { requiresHuman: true },
  blocking: true,
};

const SCOPE_CHANGE_DEF = {
  id: "scope-change-gate",
  label: "Scope Change",
  kind: "scope_change",
  trigger: "mid_run",
  policy: { requiresHuman: true },
  blocking: true,
};

const CUSTOM_GATE_DEF = {
  id: "my-operator-gate",
  label: "Operator Custom",
  kind: "custom",
  trigger: "pre_merge",
  policy: { autoApprove: true },
  blocking: false,
};

// ---------------------------------------------------------------------------
// parseReviewGate — structural parsing + error taxonomy
// ---------------------------------------------------------------------------

describe("parseReviewGate", () => {
  test("parseReviewGate — valid plan_approval gate returns ok:true with typed ReviewGate", () => {
    const result = parseReviewGate(PLAN_APPROVAL_DEF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("plan_approval");
      expect(result.data.id).toBe("plan-approval-gate");
      expect(result.data.trigger).toBe("pre_run");
      expect(result.data.blocking).toBe(true);
    }
  });

  test("parseReviewGate — id absent from GATE_REGISTRY and kind is not custom returns unknown_gate", () => {
    const result = parseReviewGate({
      id: "not-in-registry-gate",
      label: "Some Gate",
      kind: "verification",
      trigger: "post_run",
      policy: { requiresHuman: true },
      blocking: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown_gate");
      expect(result.error.id).toBe("not-in-registry-gate");
    }
  });

  test("parseReviewGate — policy.autoApprove:true and policy.requiresHuman:true returns gate_policy_invalid", () => {
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

  test("parseReviewGate — missing required top-level field (no id) returns gate_contract_invalid", () => {
    const result = parseReviewGate({
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiresHuman: true },
      blocking: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("gate_contract_invalid");
    }
  });

  test("parseReviewGate — kind:custom with arbitrary id returns ok:true (custom gates bypass registry check)", () => {
    const result = parseReviewGate(CUSTOM_GATE_DEF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("custom");
      expect(result.data.id).toBe("my-operator-gate");
    }
  });

  test("parseReviewGate — garbage input (null) returns gate_contract_invalid without throwing", () => {
    const result = parseReviewGate(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("gate_contract_invalid");
    }
  });

  test("parseReviewGate — garbage input (string) returns gate_contract_invalid without throwing", () => {
    const result = parseReviewGate("not an object");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("gate_contract_invalid");
    }
  });

  test("parseReviewGate — go-no-go-gate parses correctly as verification/post_run", () => {
    const result = parseReviewGate(GO_NO_GO_DEF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("verification");
      expect(result.data.trigger).toBe("post_run");
    }
  });

  test("parseReviewGate — scope-change-gate parses correctly as scope_change/mid_run", () => {
    const result = parseReviewGate(SCOPE_CHANGE_DEF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("scope_change");
      expect(result.data.trigger).toBe("mid_run");
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateGate — pure policy engine
// ---------------------------------------------------------------------------

describe("evaluateGate", () => {
  // Helper: build a parsed ReviewGate directly for evaluateGate tests
  function makeGate(overrides: Partial<ReviewGate> = {}): ReviewGate {
    return {
      id: "plan-approval-gate",
      label: "Plan Approval",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiresHuman: true },
      blocking: true,
      ...overrides,
    };
  }

  test("evaluateGate — autoApprove:true returns passed regardless of evidence or humanDecision", () => {
    const gate = makeGate({ policy: { autoApprove: true } });
    const ctx: GateContext = {};
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("passed");
  });

  test("evaluateGate — autoApprove:true returns passed even when humanDecision is undefined", () => {
    const gate = makeGate({ policy: { autoApprove: true } });
    const ctx: GateContext = { evidenceSatisfied: false };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("passed");
  });

  test("evaluateGate — requiresHuman:true with no humanDecision returns awaiting_human", () => {
    const gate = makeGate({ policy: { requiresHuman: true } });
    const ctx: GateContext = {};
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("awaiting_human");
    expect(decision.requiredAction).toBe("Await human approval");
  });

  test("evaluateGate — requiresHuman:true with humanDecision:approved returns passed", () => {
    const gate = makeGate({ policy: { requiresHuman: true } });
    const ctx: GateContext = { humanDecision: "approved" };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("passed");
  });

  test("evaluateGate — requiresHuman:true with humanDecision:rejected returns failed", () => {
    const gate = makeGate({ policy: { requiresHuman: true } });
    const ctx: GateContext = { humanDecision: "rejected" };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("failed");
    expect(decision.reason).toBe("Human reviewer rejected the gate");
  });

  test("evaluateGate — requiredEvidence present and evidenceSatisfied:true returns passed", () => {
    const gate = makeGate({
      policy: { requiredEvidence: ["test-run-id"] },
    });
    const ctx: GateContext = { evidenceSatisfied: true };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("passed");
  });

  test("evaluateGate — requiredEvidence present and evidenceSatisfied:false returns failed with requiredAction", () => {
    const gate = makeGate({
      policy: { requiredEvidence: ["test-run-id"] },
    });
    const ctx: GateContext = { evidenceSatisfied: false };
    const decision = evaluateGate(gate, ctx);
    expect(decision.state).toBe("failed");
    expect(decision.reason).toBe("Required evidence not satisfied");
    expect(decision.requiredAction).toBeTruthy();
  });

  test("evaluateGate — blocking:false gate that evaluates to failed still returns state:failed (blocking is caller concern)", () => {
    const gate = makeGate({
      blocking: false,
      policy: { requiresHuman: true },
    });
    const ctx: GateContext = { humanDecision: "rejected" };
    const decision = evaluateGate(gate, ctx);
    // The evaluator NEVER suppresses a failure based on blocking flag
    expect(decision.state).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// GATE_REGISTRY — seed entries and immutability
// ---------------------------------------------------------------------------

describe("GATE_REGISTRY", () => {
  test("GATE_REGISTRY contains all three seed entries", () => {
    expect(GATE_REGISTRY["plan-approval-gate"]).toBeDefined();
    expect(GATE_REGISTRY["go-no-go-gate"]).toBeDefined();
    expect(GATE_REGISTRY["scope-change-gate"]).toBeDefined();
  });

  test("GATE_REGISTRY plan-approval-gate has kind plan_approval and trigger pre_run", () => {
    expect(GATE_REGISTRY["plan-approval-gate"].kind).toBe("plan_approval");
    expect(GATE_REGISTRY["plan-approval-gate"].trigger).toBe("pre_run");
  });

  test("GATE_REGISTRY go-no-go-gate has kind verification and trigger post_run", () => {
    expect(GATE_REGISTRY["go-no-go-gate"].kind).toBe("verification");
    expect(GATE_REGISTRY["go-no-go-gate"].trigger).toBe("post_run");
  });

  test("GATE_REGISTRY scope-change-gate has kind scope_change and trigger mid_run", () => {
    expect(GATE_REGISTRY["scope-change-gate"].kind).toBe("scope_change");
    expect(GATE_REGISTRY["scope-change-gate"].trigger).toBe("mid_run");
  });

  test("GATE_REGISTRY is frozen (immutable — adding a key throws or is silently ignored)", () => {
    // Cast through unknown to bypass readonly — simulates a runtime caller that
    // ignores TypeScript types. Object.freeze() enforces immutability at runtime.
    const registry = GATE_REGISTRY as unknown as Record<string, ReviewGate>;
    try {
      registry["injected-gate"] = GATE_REGISTRY["plan-approval-gate"];
    } catch {
      // Expected: TypeError from Object.freeze in strict mode
    }
    expect(registry["injected-gate"]).toBeUndefined();
  });
});
