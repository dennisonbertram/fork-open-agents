import { z } from "zod";
import { delegatedWorkspacePolicySchema } from "./delegated-workspace";

export const delegatedWorkerLifecycleStatusSchema = z.enum([
  "launching",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);

export type DelegatedWorkerLifecycleStatus = z.infer<
  typeof delegatedWorkerLifecycleStatusSchema
>;

export const delegatedWorkerLifecycleEventSchema = z.object({
  eventId: z.string(),
  workerId: z.string(),
  workerType: z.string(),
  workerLabel: z.string(),
  parentToolCallId: z.string().optional(),
  status: delegatedWorkerLifecycleStatusSchema,
  reasonCode: z.string(),
  workspaceMode: z.enum(["shared", "isolated"]).optional(),
  requestedWorkspacePolicy: delegatedWorkspacePolicySchema.optional(),
  effectiveWorkspacePolicy: delegatedWorkspacePolicySchema.optional(),
  workspaceId: z.string().optional(),
  modelId: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type DelegatedWorkerLifecycleEvent = z.infer<
  typeof delegatedWorkerLifecycleEventSchema
>;

export function buildDelegatedWorkerLifecycleEvent(params: {
  workerId: string;
  workerType: string;
  workerLabel?: string;
  parentToolCallId?: string;
  status: DelegatedWorkerLifecycleStatus;
  reasonCode: string;
  workspaceMode?: "shared" | "isolated";
  requestedWorkspacePolicy?: "auto" | "shared" | "isolated";
  effectiveWorkspacePolicy?: "auto" | "shared" | "isolated";
  workspaceId?: string;
  modelId?: string;
  startedAt: number;
  updatedAt?: number;
}): DelegatedWorkerLifecycleEvent {
  const updatedAt = params.updatedAt ?? Date.now();
  return {
    eventId: `${params.workerId}:${params.status}:${params.reasonCode}:${updatedAt}`,
    workerId: params.workerId,
    workerType: params.workerType,
    workerLabel: params.workerLabel ?? params.workerType,
    parentToolCallId: params.parentToolCallId,
    status: params.status,
    reasonCode: params.reasonCode,
    workspaceMode: params.workspaceMode,
    requestedWorkspacePolicy: params.requestedWorkspacePolicy,
    effectiveWorkspacePolicy: params.effectiveWorkspacePolicy,
    workspaceId: params.workspaceId,
    modelId: params.modelId,
    startedAt: params.startedAt,
    updatedAt,
  };
}
