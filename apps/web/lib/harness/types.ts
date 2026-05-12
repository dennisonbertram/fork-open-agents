export type HarnessMode = "investigation" | "verified_build";

export type VerifiedBuildPlanApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";

export type VerifiedBuildGoNoGo = "unknown" | "go" | "no_go";

export type HarnessJsonObject = Record<string, unknown>;

export type HarnessErrorCode =
  | "harness_disabled"
  | "harness_config_invalid"
  | "harness_unavailable"
  | "harness_unauthorized"
  | "harness_forbidden"
  | "harness_invalid_request"
  | "harness_payload_too_large"
  | "harness_internal_error"
  | "harness_bad_response"
  | "harness_timeout"
  | "not_authenticated"
  | "not_found"
  | "forbidden"
  | "invalid_request";

export type HarnessErrorEnvelope = {
  error: {
    code: HarnessErrorCode;
    message: string;
    request_id: string;
  };
};

export type HarnessScope = {
  tenantId: string;
  projectId?: string | null;
  actorId: string;
};

export type HarnessRequestContext = HarnessScope & {
  requestId: string;
};

export type HarnessRunResponse = {
  id?: string;
  run_id?: string;
  status?: string;
  mode?: HarnessMode;
  tenant_id?: string;
  project_id?: string | null;
  actor_id?: string;
  final_report_artifact_id?: string | null;
  go_no_go?: VerifiedBuildGoNoGo;
  plan_approval_state?: VerifiedBuildPlanApprovalState;
  pending_approval_kind?: string | null;
  [key: string]: unknown;
};

export type HarnessUiManifest = {
  version?: string;
  surfaces?: unknown[];
  [key: string]: unknown;
};

export type HarnessReadiness = {
  enabled: true;
  requestId: string;
  health: HarnessJsonObject;
  ready: HarnessJsonObject;
  openapi: HarnessJsonObject;
  uiManifest: HarnessUiManifest;
};

export type HarnessDisabledReadiness = {
  enabled: false;
  requestId: string;
};

export type VerifiedBuildRunSnapshot = {
  id: string;
  sessionId: string;
  chatId: string;
  harnessRunId: string;
  mode: HarnessMode;
  status: string;
  tenantId: string;
  projectId: string | null;
  actorId: string;
  intentSummary: string | null;
  selectionReason: string | null;
  lastEventId: string | null;
  lastEventName: string | null;
  lastEventAt: Date | null;
  planApprovalState: VerifiedBuildPlanApprovalState;
  pendingApprovalKind: string | null;
  finalReportArtifactId: string | null;
  goNoGo: VerifiedBuildGoNoGo;
  createdAt: Date;
  updatedAt: Date;
};

export type VerifiedBuildEventSnapshot = {
  id: string;
  verifiedBuildRunId: string;
  harnessEventId: string;
  eventName: string;
  eventPayload: unknown;
  eventAt: Date | null;
  receivedAt: Date;
  requestId: string | null;
};

export type StartVerifiedBuildInput = {
  sessionId: string;
  chatId: string;
  userId: string;
  latestUserMessageId: string;
  intentSummary?: string;
  selectionReason?: string;
  mode: HarnessMode;
  requestId: string;
};
