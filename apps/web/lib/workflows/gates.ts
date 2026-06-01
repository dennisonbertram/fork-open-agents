import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum schemas + derived types
// ---------------------------------------------------------------------------

/**
 * The category/kind of review gate.
 *
 * - plan_approval  — generalizes verifiedBuildRuns.planApprovalState
 * - scope_change   — generalizes #51-style plan-change approval
 * - verification   — generalizes verifiedBuildRuns.goNoGo / runtime proof
 * - budget         — cost/resource threshold gate
 * - custom         — operator-defined gate; arbitrary id allowed
 */
export const gateKindSchema = z.enum([
  "plan_approval",
  "scope_change",
  "verification",
  "budget",
  "custom",
]);
export type GateKind = z.infer<typeof gateKindSchema>;

/**
 * When the gate fires relative to the workflow lifecycle.
 */
export const gateTriggerSchema = z.enum([
  "pre_run",
  "mid_run",
  "pre_merge",
  "post_run",
]);
export type GateTrigger = z.infer<typeof gateTriggerSchema>;

/**
 * The lifecycle state of a gate instance.
 *
 * - not_required   — gate policy determined this gate does not apply
 * - pending        — gate is registered but not yet evaluated
 * - running        — gate is actively being evaluated
 * - passed         — all policy conditions satisfied
 * - failed         — policy conditions not satisfied
 * - awaiting_human — policy requires human decision; none received yet
 * - skipped        — gate explicitly skipped with rationale
 * - superseded     — a newer gate instance replaced this one
 */
export const gateStateSchema = z.enum([
  "not_required",
  "pending",
  "running",
  "passed",
  "failed",
  "awaiting_human",
  "skipped",
  "superseded",
]);
export type GateState = z.infer<typeof gateStateSchema>;

// ---------------------------------------------------------------------------
// GatePolicy schema
// ---------------------------------------------------------------------------

/**
 * Policy that governs how a gate is evaluated.
 *
 * Constraint: autoApprove and requiresHuman are mutually exclusive.
 * If both are true the gate definition is invalid.
 */
export const gatePolicySchema = z
  .object({
    /** If true → evaluateGate always returns "passed" regardless of context. */
    autoApprove: z.boolean().optional(),
    /** If true → a humanDecision must be present before the gate can pass. */
    requiresHuman: z.boolean().optional(),
    /**
     * Evidence keys that must be satisfied (evidenceSatisfied === true in
     * GateContext) before the gate can pass.
     */
    requiredEvidence: z.array(z.string().min(1)).optional(),
  })
  .refine((p) => !(p.autoApprove === true && p.requiresHuman === true), {
    message: "autoApprove and requiresHuman are mutually exclusive",
  });
export type GatePolicy = z.infer<typeof gatePolicySchema>;

// ---------------------------------------------------------------------------
// ReviewGate schema
// ---------------------------------------------------------------------------

/**
 * A typed product object representing a single review gate.
 *
 * The `blocking` field is a CALLER responsibility signal. evaluateGate()
 * always reports the true computed state. Callers (#61, #63) must check
 * gate.blocking before halting the workflow.
 */
export const reviewGateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: gateKindSchema,
  trigger: gateTriggerSchema,
  policy: gatePolicySchema,
  /**
   * If true, a "failed" or "awaiting_human" state halts the workflow.
   * The evaluator does NOT check this field — it always reports the true state.
   */
  blocking: z.boolean(),
});
export type ReviewGate = z.infer<typeof reviewGateSchema>;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export type GateContractErrorKind =
  | "gate_contract_invalid"
  | "unknown_gate"
  | "gate_policy_invalid"
  | "missing_required_evidence";

export type GateContractError = {
  kind: GateContractErrorKind;
  id?: string;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Context + Decision types
// ---------------------------------------------------------------------------

export type GateContext = {
  evidenceSatisfied?: boolean;
  humanDecision?: "approved" | "rejected";
  skipRationale?: string;
};

export type GateDecision = {
  state: GateState;
  /** Human-readable explanation — informational only, not the authoritative signal. */
  reason?: string;
  /** e.g. "Await human approval via harness approve endpoint" */
  requiredAction?: string;
};

// ---------------------------------------------------------------------------
// GATE_REGISTRY — seed entries
// ---------------------------------------------------------------------------

/**
 * The canonical registry of named ReviewGate definitions.
 *
 * Seed entries generalize the existing ad-hoc gate patterns.
 * Concrete workflow-specific gate instances are added by #61.
 *
 * This object is frozen — mutating it at runtime will throw in strict mode
 * or silently fail; either way the mutation does not take effect.
 */
export const GATE_REGISTRY: Readonly<Record<string, ReviewGate>> =
  Object.freeze({
    "plan-approval-gate": {
      id: "plan-approval-gate",
      label: "Plan Approval",
      description:
        "Generalizes verifiedBuildRuns.planApprovalState. Requires human approval before the workflow run begins.",
      kind: "plan_approval",
      trigger: "pre_run",
      policy: { requiresHuman: true },
      blocking: true,
    },
    "go-no-go-gate": {
      id: "go-no-go-gate",
      label: "Go / No-Go",
      description:
        "Generalizes verifiedBuildRuns.goNoGo. Final harness decision after run completion.",
      kind: "verification",
      trigger: "post_run",
      policy: { requiresHuman: true },
      blocking: true,
    },
    "scope-change-gate": {
      id: "scope-change-gate",
      label: "Scope Change",
      description:
        "Forward-compatible with #51-style plan-change approval. Fires at a mid-run checkpoint when scope changes are detected.",
      kind: "scope_change",
      trigger: "mid_run",
      policy: { requiresHuman: true },
      blocking: true,
    },
  });

// ---------------------------------------------------------------------------
// parseReviewGate
// ---------------------------------------------------------------------------

/**
 * Validates and parses an unknown gate definition against the ReviewGate
 * Zod schema. NEVER throws — any error is returned as a GateContractError.
 *
 * Error taxonomy:
 * - gate_contract_invalid  — top-level shape is invalid (Zod parse failure)
 * - unknown_gate           — id not in GATE_REGISTRY and kind !== "custom"
 * - gate_policy_invalid    — contradictory policy (autoApprove + requiresHuman)
 * - missing_required_evidence — requiredEvidence declared but empty/blank
 *
 * @param def - Unknown input to validate.
 */
export function parseReviewGate(
  def: unknown,
): { ok: true; data: ReviewGate } | { ok: false; error: GateContractError } {
  const parsed = reviewGateSchema.safeParse(def);

  if (!parsed.success) {
    // Dig into Zod issues to surface the most specific error kind.
    const issues = parsed.error.issues;

    // Check if the policy refinement failed (autoApprove + requiresHuman clash).
    const policyIssue = issues.find(
      (issue) =>
        issue.code === "custom" &&
        issue.message === "autoApprove and requiresHuman are mutually exclusive",
    );
    if (policyIssue) {
      return {
        ok: false,
        error: {
          kind: "gate_policy_invalid",
          reason: "autoApprove and requiresHuman are mutually exclusive",
        },
      };
    }

    // Everything else is a structural contract failure.
    return {
      ok: false,
      error: {
        kind: "gate_contract_invalid",
        reason: parsed.error.message,
      },
    };
  }

  const gate = parsed.data;

  // Check for missing_required_evidence: declared but empty or all-blank.
  if (gate.policy.requiredEvidence !== undefined) {
    const nonBlank = gate.policy.requiredEvidence.filter(
      (e) => e.trim().length > 0,
    );
    if (nonBlank.length === 0) {
      return {
        ok: false,
        error: {
          kind: "missing_required_evidence",
          id: gate.id,
          reason:
            "policy.requiredEvidence is declared but contains no non-blank entries",
        },
      };
    }
  }

  // Check for unknown_gate: id not in registry and kind is not "custom".
  if (gate.kind !== "custom" && !(gate.id in GATE_REGISTRY)) {
    return {
      ok: false,
      error: {
        kind: "unknown_gate",
        id: gate.id,
        reason: `Gate id "${gate.id}" is not present in GATE_REGISTRY and kind is not "custom"`,
      },
    };
  }

  return { ok: true, data: gate };
}

// ---------------------------------------------------------------------------
// evaluateGate
// ---------------------------------------------------------------------------

/**
 * Pure policy evaluator — no side effects, no DB access, no SDK calls.
 *
 * Conservative-default semantics (mirrors #96 approval-policy posture):
 * - If requiresHuman is true and no humanDecision is present →
 *   awaiting_human (does NOT assume approved).
 * - If requiredEvidence is declared and evidenceSatisfied is false →
 *   failed (does NOT assume satisfied).
 * - The `gate.blocking` field is a CALLER responsibility signal.
 *   This function always reports the true computed state; it never
 *   suppresses a failure because blocking is false.
 *
 * Evaluation priority:
 * 1. autoApprove → immediate "passed"
 * 2. humanDecision: rejected → "failed"
 * 3. requiresHuman + no humanDecision → "awaiting_human"
 * 4. requiredEvidence + evidenceSatisfied: false → "failed"
 * 5. humanDecision: approved (with any remaining checks passing) → "passed"
 * 6. requiredEvidence + evidenceSatisfied: true → "passed"
 * 7. No policy constraints → "passed"
 *
 * @param gate    - A valid ReviewGate (already parsed by parseReviewGate).
 * @param context - Runtime context providing evidence and human decision.
 */
export function evaluateGate(
  gate: ReviewGate,
  context: GateContext,
): GateDecision {
  const { policy } = gate;

  // Priority 1: autoApprove overrides everything.
  if (policy.autoApprove === true) {
    return { state: "passed" };
  }

  // Priority 2: explicit human rejection.
  if (context.humanDecision === "rejected") {
    return {
      state: "failed",
      reason: "Human reviewer rejected the gate",
    };
  }

  // Priority 3: requires human but no decision yet (conservative default).
  if (policy.requiresHuman === true && context.humanDecision === undefined) {
    return {
      state: "awaiting_human",
      requiredAction: "Await human approval",
    };
  }

  // Priority 4: required evidence not satisfied (conservative default).
  if (
    policy.requiredEvidence !== undefined &&
    policy.requiredEvidence.length > 0 &&
    context.evidenceSatisfied === false
  ) {
    return {
      state: "failed",
      reason: "Required evidence not satisfied",
      requiredAction: "Provide test-run evidence before continuing",
    };
  }

  // Priority 5: human approved (requiresHuman path; evidence check passed or not required).
  if (policy.requiresHuman === true && context.humanDecision === "approved") {
    return { state: "passed" };
  }

  // Priority 6: evidence satisfied.
  if (
    policy.requiredEvidence !== undefined &&
    policy.requiredEvidence.length > 0 &&
    context.evidenceSatisfied === true
  ) {
    return { state: "passed" };
  }

  // Priority 7: no policy constraints active → passed.
  return { state: "passed" };
}
