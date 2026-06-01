// STUB — implementation pending (red phase)
import { z } from "zod";

export const gateKindSchema = z.enum([
  "plan_approval",
  "scope_change",
  "verification",
  "budget",
  "custom",
]);
export type GateKind = z.infer<typeof gateKindSchema>;

export const gateTriggerSchema = z.enum([
  "pre_run",
  "mid_run",
  "pre_merge",
  "post_run",
]);
export type GateTrigger = z.infer<typeof gateTriggerSchema>;

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

export const gatePolicySchema = z
  .object({
    autoApprove: z.boolean().optional(),
    requiresHuman: z.boolean().optional(),
    requiredEvidence: z.array(z.string().min(1)).optional(),
  })
  .refine((p) => !(p.autoApprove === true && p.requiresHuman === true), {
    message: "autoApprove and requiresHuman are mutually exclusive",
  });
export type GatePolicy = z.infer<typeof gatePolicySchema>;

export const reviewGateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: gateKindSchema,
  trigger: gateTriggerSchema,
  policy: gatePolicySchema,
  blocking: z.boolean(),
});
export type ReviewGate = z.infer<typeof reviewGateSchema>;

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

export type GateContext = {
  evidenceSatisfied?: boolean;
  humanDecision?: "approved" | "rejected";
  skipRationale?: string;
};

export type GateDecision = {
  state: GateState;
  reason?: string;
  requiredAction?: string;
};

export const GATE_REGISTRY: Readonly<Record<string, ReviewGate>> =
  Object.freeze({} as Record<string, ReviewGate>);

export function parseReviewGate(
  _def: unknown,
): { ok: true; data: ReviewGate } | { ok: false; error: GateContractError } {
  throw new Error("Not implemented");
}

export function evaluateGate(
  _gate: ReviewGate,
  _context: GateContext,
): GateDecision {
  throw new Error("Not implemented");
}
