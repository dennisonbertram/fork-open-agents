import { z } from "zod";

export const DELEGATED_WORKSPACE_POLICIES = [
  "auto",
  "shared",
  "isolated",
] as const;

export const delegatedWorkspacePolicySchema = z.enum(
  DELEGATED_WORKSPACE_POLICIES,
);

export type DelegatedWorkspacePolicy = z.infer<
  typeof delegatedWorkspacePolicySchema
>;

export const delegatedWorkspaceLaunchPolicySchema = z.object({
  requestedPolicy: delegatedWorkspacePolicySchema,
  effectivePolicy: delegatedWorkspacePolicySchema,
  executionMode: z.enum(["shared", "isolated"]),
  label: z.enum(["shared workspace", "isolated workspace"]),
  status: z.literal("policy_recorded"),
});

export type DelegatedWorkspaceLaunchPolicy = z.infer<
  typeof delegatedWorkspaceLaunchPolicySchema
>;

export function buildDelegatedWorkspaceLaunchPolicy(
  requestedPolicy: DelegatedWorkspacePolicy,
): DelegatedWorkspaceLaunchPolicy {
  const executionMode = requestedPolicy === "isolated" ? "isolated" : "shared";

  return {
    requestedPolicy,
    effectivePolicy: requestedPolicy,
    executionMode,
    label:
      executionMode === "isolated" ? "isolated workspace" : "shared workspace",
    status: "policy_recorded",
  };
}
