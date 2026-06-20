import { redactJsonValue, redactMetadata, redactText } from "./redaction";
import type {
  AccountDiagnosisResponse,
  AccountDiagnosisSource,
  AccountDiagnosticCorrelations,
  AccountDiagnosticEvidence,
  AccountDiagnosticEvidenceKind,
  AccountDiagnosticSourceStatus,
  AccountDiagnosticSourceGap,
  AccountWorkItem,
} from "./types";

export const ACCOUNT_DIAGNOSIS_SOURCES = [
  "session",
  "chat_workflow",
  "background_agent",
  "agent_loop",
] as const satisfies readonly AccountDiagnosisSource[];

const EVIDENCE_KINDS = [
  "target",
  "timeline_event",
  "workflow_run",
  "workflow_input_snapshot",
  "workflow_step",
  "session_event",
  "background_agent_event",
  "background_agent_output",
  "background_agent_tool_session",
  "agent_loop_step",
  "agent_loop_event",
  "agent_loop_watchdog",
  "managed_runtime_profile_run",
  "sandbox_service",
  "browser_run",
  "workflow_goal",
  "workflow_goal_event",
  "verified_build_run",
  "verified_build_event",
] as const satisfies readonly AccountDiagnosticEvidenceKind[];

export function isAccountDiagnosisSource(
  value: string | null,
): value is AccountDiagnosisSource {
  return ACCOUNT_DIAGNOSIS_SOURCES.includes(value as AccountDiagnosisSource);
}

function emptyCorrelations(): AccountDiagnosticCorrelations {
  return {
    sessionIds: [],
    chatIds: [],
    workflowRunIds: [],
    requestIds: [],
    harnessRunIds: [],
    sandboxNames: [],
    serviceIds: [],
    browserRunIds: [],
    prNumbers: [],
    issueNumbers: [],
  };
}

function addString(target: string[], value: unknown): void {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    !target.includes(value)
  ) {
    target.push(value);
  }
}

function addNumber(target: number[], value: unknown): void {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !target.includes(value)
  ) {
    target.push(value);
  }
}

function addCorrelation(
  correlations: AccountDiagnosticCorrelations,
  key: string,
  value: unknown,
): void {
  switch (key) {
    case "sessionId":
      addString(correlations.sessionIds, value);
      break;
    case "chatId":
      addString(correlations.chatIds, value);
      break;
    case "workflowRunId":
      addString(correlations.workflowRunIds, value);
      break;
    case "requestId":
      addString(correlations.requestIds, value);
      break;
    case "harnessRunId":
      addString(correlations.harnessRunIds, value);
      break;
    case "sandboxName":
      addString(correlations.sandboxNames, value);
      break;
    case "serviceId":
      addString(correlations.serviceIds, value);
      break;
    case "browserRunId":
      addString(correlations.browserRunIds, value);
      break;
    case "prNumber":
      addNumber(correlations.prNumbers, value);
      break;
    case "issueNumber":
      addNumber(correlations.issueNumbers, value);
      break;
  }
}

function buildCorrelations(
  target: AccountWorkItem,
  evidence: AccountDiagnosticEvidence[],
): AccountDiagnosticCorrelations {
  const correlations = emptyCorrelations();
  addCorrelation(correlations, "prNumber", target.metadata?.prNumber);
  addCorrelation(correlations, "issueNumber", target.metadata?.issueNumber);

  for (const item of evidence) {
    for (const [key, value] of Object.entries(item.correlations ?? {})) {
      addCorrelation(correlations, key, value);
    }
  }

  return correlations;
}

function buildEvidenceCounts(
  evidence: AccountDiagnosticEvidence[],
): Record<AccountDiagnosticEvidenceKind, number> {
  const counts = Object.fromEntries(
    EVIDENCE_KINDS.map((kind) => [kind, 0]),
  ) as Record<AccountDiagnosticEvidenceKind, number>;

  for (const item of evidence) {
    counts[item.kind] += 1;
  }

  return counts;
}

function buildDiagnosisSummary(params: {
  target: AccountWorkItem;
  evidence: AccountDiagnosticEvidence[];
  sourceGaps: AccountDiagnosticSourceGap[];
}): string {
  const { target, evidence, sourceGaps } = params;
  const failedEvidence = evidence.filter(
    (item) => item.status === "failed" || item.level === "error",
  ).length;

  if (target.status === "failed") {
    return failedEvidence > 0
      ? `Failed ${target.source} with ${failedEvidence} failed/error evidence item${failedEvidence === 1 ? "" : "s"}.`
      : `Failed ${target.source}; no failed/error evidence item was recorded.`;
  }

  if (target.status === "stale") {
    return `Stale ${target.source}; latest update was ${target.updatedAt}.`;
  }

  if (target.status === "waiting_on_user") {
    return `Waiting on user input for ${target.source}.`;
  }

  if (sourceGaps.length > 0) {
    return `Diagnosis is partial; ${sourceGaps.length} related source${sourceGaps.length === 1 ? "" : "s"} could not be loaded.`;
  }

  return `${target.source} diagnosis assembled from ${evidence.length} evidence item${evidence.length === 1 ? "" : "s"}.`;
}

export function makeDiagnosticEvidence(input: {
  id: string;
  kind: AccountDiagnosticEvidenceKind;
  title: string;
  status?: string | null;
  level?: "info" | "warn" | "error" | null;
  summary?: string | null;
  occurredAt?: Date | string | null;
  redactionStatus?: string | null;
  correlations?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): AccountDiagnosticEvidence {
  return {
    id: input.id,
    kind: input.kind,
    title: redactText(input.title, 160) ?? input.kind,
    ...(input.status ? { status: input.status } : {}),
    ...(input.level ? { level: input.level } : {}),
    ...(input.summary
      ? { summary: redactText(input.summary, 300) ?? undefined }
      : {}),
    ...(input.occurredAt
      ? {
          occurredAt:
            input.occurredAt instanceof Date
              ? input.occurredAt.toISOString()
              : input.occurredAt,
        }
      : {}),
    ...(input.redactionStatus
      ? { redactionStatus: input.redactionStatus }
      : {}),
    ...(input.correlations
      ? { correlations: redactMetadata(input.correlations, 16) }
      : {}),
    ...(input.metadata
      ? {
          metadata: redactJsonValue(input.metadata, {
            maxDepth: 5,
            maxObjectKeys: 20,
            maxArrayItems: 25,
            maxStringLength: 300,
          }) as Record<string, unknown>,
        }
      : {}),
  };
}

export function buildAccountDiagnosis(params: {
  source: AccountDiagnosisSource;
  id: string;
  target: AccountWorkItem;
  sourceStatus: AccountDiagnosticSourceStatus[];
  evidence: AccountDiagnosticEvidence[];
  sourceGaps?: AccountDiagnosticSourceGap[];
  now?: Date;
}): AccountDiagnosisResponse {
  const now = params.now ?? new Date();
  const sourceGaps = params.sourceGaps ?? [];
  const timeline = [...params.evidence]
    .filter((item) => item.occurredAt)
    .sort(
      (a, b) =>
        new Date(a.occurredAt ?? 0).getTime() -
        new Date(b.occurredAt ?? 0).getTime(),
    );

  return {
    generatedAt: now.toISOString(),
    source: params.source,
    id: params.id,
    target: params.target,
    sourceStatus: params.sourceStatus,
    project: params.target.repo
      ? {
          repo: params.target.repo,
          ...(typeof params.target.metadata?.prNumber === "number"
            ? { prNumber: params.target.metadata.prNumber }
            : {}),
          ...(typeof params.target.metadata?.issueNumber === "number"
            ? { issueNumber: params.target.metadata.issueNumber }
            : {}),
        }
      : undefined,
    diagnosis: {
      status: params.target.status,
      needsAttention: params.target.needsAttention,
      attentionReasons: params.target.attentionReasons,
      summary: buildDiagnosisSummary({
        target: params.target,
        evidence: params.evidence,
        sourceGaps,
      }),
      evidenceCounts: buildEvidenceCounts(params.evidence),
      sourceGaps,
    },
    correlations: buildCorrelations(params.target, params.evidence),
    timeline,
    evidence: params.evidence,
  };
}
