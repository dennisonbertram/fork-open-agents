import { nanoid } from "nanoid";
import { redactHarnessPayload } from "@/lib/harness/redaction";
import type { SessionEventSnapshot } from "@/lib/observability/events";
import type { WorkflowRunStep } from "@/lib/db/schema";
import type {
  ManagedRuntimeWorkerJson,
  WorkflowRunJson,
} from "@/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-observability";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OperatorTimelineEntryKind =
  | "workflow_started"
  | "workflow_completed"
  | "workflow_step"
  | "worker_launched"
  | "worker_completed"
  | "gate_evaluated"
  | "approval_requested"
  | "session_event"
  | "error";

export type OperatorTimelineEntrySeverity = "info" | "warn" | "error";

export type OperatorTimelineCorrelationIds = {
  sessionId: string;
  chatId?: string | null;
  workflowRunId?: string | null;
  workflowRunStepId?: string | null;
  workerId?: string | null;
  requestId?: string | null;
  profileRunId?: string | null;
  sandboxName?: string | null;
};

export type OperatorTimelineEntry = {
  id: string;
  timestamp: string;
  kind: OperatorTimelineEntryKind;
  actor: string;
  label: string;
  summary: string | null;
  correlationIds: OperatorTimelineCorrelationIds;
  severity: OperatorTimelineEntrySeverity;
  evidenceRef?: string | null;
};

export type OperatorTimelineErrorKind =
  | "operator_timeline_invalid_event"
  | "operator_timeline_build_failed";

export class OperatorTimelineError extends Error {
  readonly kind: OperatorTimelineErrorKind;

  constructor(message: string, kind: OperatorTimelineErrorKind) {
    super(message);
    this.name = "OperatorTimelineError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Injectable recorder seam — best-effort, never throws
// ---------------------------------------------------------------------------

export type TimelineEventRecorder = (
  eventName: string,
  fields: Record<string, unknown>,
) => void;

const DEFAULT_RECORDER: TimelineEventRecorder = () => {
  // no-op default — callers can inject a real recorder
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 200;

// NOTE: There is intentionally NO default for windowMs.
// When windowMs is absent/undefined, windowing is disabled and all entries pass.
// Only an explicit windowMs value activates time-based filtering.

function toTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

function redactString(value: string): string {
  const result = redactHarnessPayload({ __str: value }) as {
    __str: string;
  };
  return result.__str;
}

function safeRedactLabel(value: string): string {
  try {
    return redactString(value);
  } catch {
    return "[REDACTED]";
  }
}

function safeRedactSummary(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return redactString(value);
  } catch {
    return "[REDACTED]";
  }
}

function dedupeKey(entry: OperatorTimelineEntry): string {
  // Include summary and identity-distinguishing fields so that consecutive entries
  // that share kind/actor/label/workflowRunId but differ in any meaningful field
  // (e.g. summary, workerId, requestId, workflowRunStepId) are NOT collapsed.
  return [
    entry.kind,
    entry.actor,
    entry.label,
    entry.correlationIds.workflowRunId ?? "",
    entry.summary ?? "",
    entry.correlationIds.workerId ?? "",
    entry.correlationIds.requestId ?? "",
    entry.correlationIds.workflowRunStepId ?? "",
  ].join(":");
}

function collapseConsecutiveDuplicates(
  entries: OperatorTimelineEntry[],
): OperatorTimelineEntry[] {
  const result: OperatorTimelineEntry[] = [];
  let lastKey: string | null = null;
  for (const entry of entries) {
    const key = dedupeKey(entry);
    if (key !== lastKey) {
      result.push(entry);
      lastKey = key;
    }
  }
  return result;
}

function inferKind(
  eventName: string,
  actorType: string,
): OperatorTimelineEntryKind {
  const name = eventName.toLowerCase();
  if (name.includes("workflow") && name.includes("start")) {
    return "workflow_started";
  }
  if (name.includes("workflow") && name.includes("complet")) {
    return "workflow_completed";
  }
  if (name.includes("worker") && name.includes("launch")) {
    return "worker_launched";
  }
  if (name.includes("worker") && name.includes("complet")) {
    return "worker_completed";
  }
  if (name.includes("gate")) {
    return "gate_evaluated";
  }
  if (name.includes("approval")) {
    return "approval_requested";
  }
  if (actorType === "system" && name.includes("error")) {
    return "error";
  }
  return "session_event";
}

function inferSeverity(status: string): OperatorTimelineEntrySeverity {
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (status === "blocked" || status === "skipped") {
    return "warn";
  }
  return "info";
}

// ---------------------------------------------------------------------------
// Source-record → OperatorTimelineEntry converters
// ---------------------------------------------------------------------------

function sessionEventToEntry(
  event: SessionEventSnapshot,
  sessionId: string,
): OperatorTimelineEntry {
  return {
    id: event.id,
    timestamp: event.createdAt,
    kind: inferKind(event.eventName, event.actorType),
    actor: event.actorType,
    label: safeRedactLabel(event.eventName),
    summary: safeRedactSummary(event.summary),
    correlationIds: {
      sessionId,
      chatId: event.chatId,
      workflowRunId: event.workflowRunId,
      workflowRunStepId: null,
      workerId: null,
      requestId: event.requestId,
      profileRunId: event.managedRuntimeProfileRunId,
      sandboxName: event.sandboxName,
    },
    severity: inferSeverity(event.status),
    evidenceRef: `sessionEvent:${event.id}`,
  };
}

function workflowRunToEntries(run: WorkflowRunJson): OperatorTimelineEntry[] {
  const entries: OperatorTimelineEntry[] = [];

  const startTs = toTimestamp(run.startedAt);
  if (startTs) {
    entries.push({
      id: `${run.id}:start`,
      timestamp: startTs,
      kind: "workflow_started",
      actor: "workflow",
      label: safeRedactLabel(`Workflow started`),
      summary: null,
      correlationIds: {
        sessionId: run.sessionId,
        chatId: run.chatId,
        workflowRunId: run.id,
        workflowRunStepId: null,
        workerId: null,
        requestId: run.requestId,
        profileRunId: run.managedRuntimeProfileRunId,
        sandboxName: run.sandboxName,
      },
      severity: "info",
      evidenceRef: `workflowRun:${run.id}`,
    });
  }

  const endTs = toTimestamp(run.finishedAt);
  if (endTs) {
    const isError = run.status === "failed" || run.status === "aborted";
    entries.push({
      id: `${run.id}:end`,
      timestamp: endTs,
      kind: "workflow_completed",
      actor: "workflow",
      label: safeRedactLabel(`Workflow ${run.status}`),
      summary: run.errorMessage ? safeRedactSummary(run.errorMessage) : null,
      correlationIds: {
        sessionId: run.sessionId,
        chatId: run.chatId,
        workflowRunId: run.id,
        workflowRunStepId: null,
        workerId: null,
        requestId: run.requestId,
        profileRunId: run.managedRuntimeProfileRunId,
        sandboxName: run.sandboxName,
      },
      severity: isError ? "error" : "info",
      evidenceRef: `workflowRun:${run.id}`,
    });
  }

  return entries;
}

function workflowStepToEntry(
  step: WorkflowRunStep,
  sessionId: string,
  chatId: string | null,
): OperatorTimelineEntry {
  // Prefer startedAt; fall back to createdAt if startedAt is missing.
  // The build guard allows steps with valid createdAt even if startedAt is absent.
  const timestamp =
    toTimestamp(step.startedAt) ?? step.createdAt.toISOString();
  return {
    id: step.id,
    timestamp,
    kind: "workflow_step",
    actor: "workflow",
    label: safeRedactLabel(`Step ${step.stepNumber}`),
    summary: step.finishReason ? safeRedactSummary(step.finishReason) : null,
    correlationIds: {
      sessionId,
      chatId,
      workflowRunId: step.workflowRunId,
      workflowRunStepId: step.id,
      workerId: null,
      requestId: null,
      profileRunId: null,
      sandboxName: null,
    },
    severity: "info",
    evidenceRef: `workflowRunStep:${step.id}`,
  };
}

function workerToEntries(
  worker: ManagedRuntimeWorkerJson,
  sessionId: string,
  chatId: string | null,
): OperatorTimelineEntry[] {
  const ts = toTimestamp(worker.updatedAt);
  if (!ts) {
    return [];
  }

  const isCompleted =
    worker.status === "completed" || worker.status === "failed";
  const kind: OperatorTimelineEntryKind = isCompleted
    ? "worker_completed"
    : "worker_launched";

  return [
    {
      id: `${worker.id}:${kind}`,
      timestamp: ts,
      kind,
      actor: "worker",
      label: safeRedactLabel(`Worker ${worker.workerType} ${worker.status}`),
      summary: worker.summary ? safeRedactSummary(worker.summary) : null,
      correlationIds: {
        sessionId,
        chatId,
        workflowRunId: null,
        workflowRunStepId: null,
        workerId: worker.id,
        requestId: null,
        profileRunId: worker.profileRunId,
        sandboxName: worker.sandboxName,
      },
      severity: worker.status === "failed" ? "error" : "info",
      evidenceRef: `worker:${worker.id}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildOperatorTimeline(
  events: SessionEventSnapshot[],
  workflowRuns: WorkflowRunJson[],
  workflowRunSteps: WorkflowRunStep[],
  workers: ManagedRuntimeWorkerJson[],
  options?: {
    limit?: number;
    /**
     * Time window in milliseconds. When provided, entries older than
     * `now - windowMs` are excluded. When absent/undefined, windowing is
     * disabled and all entries pass through regardless of age.
     */
    windowMs?: number;
    /**
     * Explicit current timestamp (ms since epoch) used to compute the window
     * cutoff. Defaults to Date.now(). Inject this in tests for determinism.
     */
    now?: number;
  },
  recorder: TimelineEventRecorder = DEFAULT_RECORDER,
): OperatorTimelineEntry[] {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const windowMs = options?.windowMs; // undefined = windowing disabled
  const nowMs = options?.now ?? Date.now();

  const allEntries: OperatorTimelineEntry[] = [];
  const startMs = Date.now();

  // Capture sessionId defensively before the try block so the catch can reference
  // it safely even when events/workflowRuns are malformed or null.
  let capturedSessionId = "";
  try {
    capturedSessionId =
      (Array.isArray(events) ? events[0]?.sessionId : undefined) ??
      (Array.isArray(workflowRuns) ? workflowRuns[0]?.sessionId : undefined) ??
      "";
  } catch {
    // best-effort — capturedSessionId stays ""
  }

  try {
    // Determine sessionId from first available source
    const sessionId = events[0]?.sessionId ?? workflowRuns[0]?.sessionId ?? "";

    const chatId = events[0]?.chatId ?? workflowRuns[0]?.chatId ?? null;

    // --- session events ---
    for (const event of events) {
      // Validate required fields
      const ts = toTimestamp(event.createdAt);
      if (!ts || !event.id) {
        console.warn(
          `[operator-timeline] Skipping malformed event — errorKind: operator_timeline_invalid_event`,
          { eventId: event.id ?? "(unknown)", reason: "invalid createdAt" },
        );
        try {
          recorder("operator-timeline-event-skipped", {
            sessionId,
            eventId: event.id ?? null,
            errorKind: "operator_timeline_invalid_event",
          });
        } catch {
          // best-effort only
        }
        continue;
      }

      allEntries.push(sessionEventToEntry(event, sessionId));
    }

    // --- workflow runs ---
    for (const run of workflowRuns) {
      const runEntries = workflowRunToEntries(run);
      allEntries.push(...runEntries);
    }

    // --- workflow run steps ---
    for (const step of workflowRunSteps) {
      // Accept either startedAt or createdAt as the timestamp source.
      // A step with an invalid startedAt but a valid createdAt is recoverable.
      const stepTs =
        toTimestamp(step.startedAt) ?? toTimestamp(step.createdAt);
      if (!stepTs || !step.id) {
        console.warn(
          `[operator-timeline] Skipping malformed workflow step — errorKind: operator_timeline_invalid_event`,
          {
            stepId: step.id ?? "(unknown)",
            reason: "invalid startedAt and createdAt",
          },
        );
        try {
          recorder("operator-timeline-event-skipped", {
            sessionId,
            eventId: step.id ?? null,
            errorKind: "operator_timeline_invalid_event",
          });
        } catch {
          // best-effort only
        }
        continue;
      }
      allEntries.push(workflowStepToEntry(step, sessionId, chatId));
    }

    // --- workers ---
    for (const worker of workers) {
      const workerEntries = workerToEntries(worker, sessionId, chatId);
      allEntries.push(...workerEntries);
    }

    // --- sort ascending by timestamp, tie-break by id ---
    allEntries.sort((a, b) => {
      const cmp = a.timestamp.localeCompare(b.timestamp);
      if (cmp !== 0) {
        return cmp;
      }
      return a.id.localeCompare(b.id);
    });

    // --- apply windowMs filter (only when windowMs is explicitly provided) ---
    // When windowMs is undefined, all entries pass through regardless of age.
    const afterWindow =
      windowMs !== undefined
        ? allEntries.filter(
            (e) =>
              e.timestamp >= new Date(nowMs - windowMs).toISOString(),
          )
        : allEntries;

    // --- collapse consecutive duplicates ---
    const deduped = collapseConsecutiveDuplicates(afterWindow);

    // --- apply limit (most-recent N) ---
    const capped =
      deduped.length > limit ? deduped.slice(deduped.length - limit) : deduped;

    const durationMs = Date.now() - startMs;
    try {
      recorder("operator-timeline-built", {
        sessionId,
        chatId,
        entryCount: capped.length,
        windowMs,
        durationMs,
      });
    } catch {
      // best-effort only
    }

    return capped;
  } catch (err) {
    if (err instanceof OperatorTimelineError) {
      // Already a typed error — re-throw it
      try {
        recorder("operator-timeline-build-failed", {
          sessionId: capturedSessionId,
          errorKind: "operator_timeline_build_failed",
        });
      } catch {
        // best-effort only
      }
      throw err;
    }

    const buildError = new OperatorTimelineError(
      err instanceof Error ? err.message : "Unknown aggregation error",
      "operator_timeline_build_failed",
    );

    try {
      recorder("operator-timeline-build-failed", {
        sessionId: capturedSessionId,
        errorKind: "operator_timeline_build_failed",
      });
    } catch {
      // best-effort only
    }

    throw buildError;
  }
}

// Re-export a stable unique ID helper for callers that need one
export { nanoid as operatorTimelineId };
