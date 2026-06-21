import { z } from "zod";
import {
  delegatedWorkspacePolicySchema,
  type DelegatedWorkspacePolicy,
} from "./delegated-workspace";

const resolverRuntimeModeSchema = z.enum(["classic", "managed_runtime"]);

export const delegatedWorkspaceRejectionCodeSchema = z.enum([
  "missing_parent_run_id",
  "missing_parent_workspace",
]);

export type DelegatedWorkspaceRejectionCode = z.infer<
  typeof delegatedWorkspaceRejectionCodeSchema
>;

export const delegatedWorkspaceResolverInputSchema = z.object({
  parentRunId: z.string().min(1).optional(),
  runtimeMode: resolverRuntimeModeSchema,
  requestedPolicy: delegatedWorkspacePolicySchema.optional(),
  parentWorkspaceId: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
});

export type DelegatedWorkspaceResolverInput = z.infer<
  typeof delegatedWorkspaceResolverInputSchema
>;

export const delegatedWorkspaceResolverDecisionSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("accepted"),
      decision: z.enum(["shared", "isolated"]),
      requestedPolicy: delegatedWorkspacePolicySchema,
      effectivePolicy: delegatedWorkspacePolicySchema,
      reasonCode: z.string(),
      reason: z.string(),
      parentWorkspaceId: z.string(),
      requiredCapabilities: z.array(z.string()),
      provisioningPlan: z
        .object({
          planOnly: z.literal(true),
          kind: z.literal("isolated_worker_workspace"),
          parentWorkspaceId: z.string(),
          repositoryId: z.string().optional(),
        })
        .optional(),
      createdResourceIds: z.array(z.string()),
    }),
    z.object({
      status: z.literal("rejected"),
      requestedPolicy: delegatedWorkspacePolicySchema,
      effectivePolicy: delegatedWorkspacePolicySchema,
      reasonCode: delegatedWorkspaceRejectionCodeSchema,
      reason: z.string(),
      createdResourceIds: z.array(z.string()),
    }),
  ],
);

export type DelegatedWorkspaceResolverDecision = z.infer<
  typeof delegatedWorkspaceResolverDecisionSchema
>;

function reject(params: {
  requestedPolicy: DelegatedWorkspacePolicy;
  reasonCode: DelegatedWorkspaceRejectionCode;
  reason: string;
}): DelegatedWorkspaceResolverDecision {
  return {
    status: "rejected",
    requestedPolicy: params.requestedPolicy,
    effectivePolicy: params.requestedPolicy,
    reasonCode: params.reasonCode,
    reason: params.reason,
    createdResourceIds: [],
  };
}

export function resolveDelegatedWorkspacePolicy(
  input: DelegatedWorkspaceResolverInput,
): DelegatedWorkspaceResolverDecision {
  const requestedPolicy = input.requestedPolicy ?? "auto";

  if (!input.parentRunId) {
    return reject({
      requestedPolicy,
      reasonCode: "missing_parent_run_id",
      reason: "A parent run id is required before resolving workspace policy.",
    });
  }

  if (!input.parentWorkspaceId) {
    return reject({
      requestedPolicy,
      reasonCode: "missing_parent_workspace",
      reason:
        "A parent workspace id is required before resolving workspace policy.",
    });
  }

  if (requestedPolicy === "isolated") {
    return {
      status: "accepted",
      decision: "isolated",
      requestedPolicy,
      effectivePolicy: "isolated",
      reasonCode: "explicit_isolated_policy",
      reason:
        "The worker requested an isolated workspace; dry-run produced a plan without creating resources.",
      parentWorkspaceId: input.parentWorkspaceId,
      requiredCapabilities: ["workspace:create_isolated"],
      provisioningPlan: {
        planOnly: true,
        kind: "isolated_worker_workspace",
        parentWorkspaceId: input.parentWorkspaceId,
        repositoryId: input.repositoryId,
      },
      createdResourceIds: [],
    };
  }

  const reasonCode =
    requestedPolicy === "shared"
      ? "explicit_shared_policy"
      : `auto_${input.runtimeMode}_preserves_shared_workspace`;

  return {
    status: "accepted",
    decision: "shared",
    requestedPolicy,
    effectivePolicy: requestedPolicy,
    reasonCode,
    reason:
      requestedPolicy === "shared"
        ? "The worker requested the shared parent workspace."
        : "Auto mode preserves the current shared workspace behavior until isolated provisioning is enabled.",
    parentWorkspaceId: input.parentWorkspaceId,
    requiredCapabilities: ["workspace:use_shared"],
    createdResourceIds: [],
  };
}
