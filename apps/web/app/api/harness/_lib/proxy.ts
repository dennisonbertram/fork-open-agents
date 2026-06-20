import { logHarnessEvent } from "@/lib/harness/logger";
import { updateVerifiedBuildRunFromHarnessStatus } from "@/lib/harness/run-mapping";
import type { HarnessJsonObject } from "@/lib/harness/types";
import {
  errorToHarnessResponse,
  harnessErrorResponse,
  jsonWithRequestId,
} from "./responses";
import { requireHarnessRunAccess } from "./run-access";

function collectPendingApprovalKinds(
  status: HarnessJsonObject,
  localPendingKind: string | null,
): Set<string> {
  const kinds = new Set<string>();
  if (localPendingKind) {
    kinds.add(localPendingKind);
  }

  const pendingApprovals = status.pending_approvals;
  if (Array.isArray(pendingApprovals)) {
    for (const approvalKind of pendingApprovals) {
      if (typeof approvalKind === "string") {
        kinds.add(approvalKind);
      }
    }
  }

  const pendingApprovalDetails = status.pending_approval_details;
  if (Array.isArray(pendingApprovalDetails)) {
    for (const detail of pendingApprovalDetails) {
      if (typeof detail === "object" && detail !== null) {
        const approvalKind = (detail as { approval_kind?: unknown })
          .approval_kind;
        if (typeof approvalKind === "string") {
          kinds.add(approvalKind);
        }
      }
    }
  }

  return kinds;
}

export async function proxyRunAction(params: {
  runId: string;
  requestId: string;
  action: "approve" | "cancel" | "repair";
  body: HarnessJsonObject;
  approvalKind?: string;
}): Promise<Response> {
  const access = await requireHarnessRunAccess({
    runId: params.runId,
    requestId: params.requestId,
  });
  if (!access.ok) {
    return access.response;
  }

  const startedAt = Date.now();
  try {
    if (params.action === "approve" && params.approvalKind) {
      const harnessRun = await access.client.getRun({
        context: access.context,
        harnessRunId: access.run.harnessRunId,
      });
      const pendingApprovalKinds = collectPendingApprovalKinds(
        harnessRun,
        access.run.pendingApprovalKind,
      );
      if (!pendingApprovalKinds.has(params.approvalKind)) {
        return harnessErrorResponse({
          code: "invalid_request",
          message: "Approval kind is not pending for this run",
          status: 400,
          requestId: params.requestId,
        });
      }
    }

    const result = await access.client.runAction({
      context: access.context,
      harnessRunId: access.run.harnessRunId,
      action: params.action,
      body: params.body,
    });

    // DB write happens AFTER the external API call succeeds so a failed
    // call (network timeout, 5xx) does not leave the local row stuck at
    // "cancellation_requested" with no compensating rollback.
    if (params.action === "cancel") {
      await updateVerifiedBuildRunFromHarnessStatus({
        runId: access.run.id,
        status: "cancellation_requested",
      });
    }

    logHarnessEvent("info", {
      event: `verified_build.${params.action}.requested`,
      request_id: params.requestId,
      verified_build_run_id: access.run.id,
      harness_run_id: access.run.harnessRunId,
      method: "POST",
      path: `/api/harness/runs/${params.runId}/${params.action}`,
      status: 200,
      duration_ms: Date.now() - startedAt,
      tenant_id: access.run.tenantId,
      project_id: access.run.projectId,
      actor_id: access.run.actorId,
    });

    return jsonWithRequestId(result, 200, params.requestId);
  } catch (error) {
    return errorToHarnessResponse(error, params.requestId);
  }
}

export async function proxyRunResource(params: {
  runId: string;
  requestId: string;
  resource: "artifacts" | "capsules" | "audit" | "trace";
}): Promise<Response> {
  const access = await requireHarnessRunAccess({
    runId: params.runId,
    requestId: params.requestId,
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const result = await access.client.getRunResource({
      context: access.context,
      harnessRunId: access.run.harnessRunId,
      resource: params.resource,
    });
    return jsonWithRequestId(result, 200, params.requestId);
  } catch (error) {
    return errorToHarnessResponse(error, params.requestId);
  }
}

export async function proxyTraceExportPlan(params: {
  runId: string;
  requestId: string;
}): Promise<Response> {
  const access = await requireHarnessRunAccess({
    runId: params.runId,
    requestId: params.requestId,
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const result = await access.client.getTraceExportPlan({
      context: access.context,
      harnessRunId: access.run.harnessRunId,
    });
    return jsonWithRequestId(result, 200, params.requestId);
  } catch (error) {
    return errorToHarnessResponse(error, params.requestId);
  }
}

export async function proxyArtifact(params: {
  runId: string;
  artifactId: string;
  requestId: string;
}): Promise<Response> {
  const access = await requireHarnessRunAccess({
    runId: params.runId,
    requestId: params.requestId,
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const result = await access.client.getArtifact({
      context: access.context,
      artifactId: params.artifactId,
    });
    return jsonWithRequestId(result, 200, params.requestId);
  } catch (error) {
    return errorToHarnessResponse(error, params.requestId);
  }
}
