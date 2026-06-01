import { describe, expect, mock, spyOn, test } from "bun:test";
import type { SessionEventSnapshot } from "./events";

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

type EventStatus =
  | "started"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped"
  | "info";

type EventSource =
  | "chat"
  | "workflow"
  | "managed_runtime"
  | "sandbox"
  | "harness"
  | "service"
  | "browser"
  | "github"
  | "system";

type EventActorType =
  | "user"
  | "coordinator"
  | "worker"
  | "sandbox"
  | "harness"
  | "browser"
  | "github"
  | "workflow"
  | "system";

type RedactionStatus = "not_required" | "passed" | "failed" | "blocked";

function makeEvent(
  overrides: Partial<{
    id: string;
    sessionId: string;
    chatId: string | null;
    userId: string;
    source: EventSource;
    actorType: EventActorType;
    actorId: string | null;
    eventName: string;
    status: EventStatus;
    summary: string | null;
    requestId: string | null;
    workflowRunId: string | null;
    harnessRunId: string | null;
    sandboxName: string | null;
    managedRuntimeProfileRunId: string | null;
    serviceId: string | null;
    browserRunId: string | null;
    payload: Record<string, unknown>;
    redactionStatus: RedactionStatus;
    createdAt: string;
  }> = {},
): SessionEventSnapshot {
  return {
    id: overrides.id ?? "evt-1",
    sessionId: overrides.sessionId ?? "session-1",
    chatId: overrides.chatId ?? "chat-1",
    userId: overrides.userId ?? "user-1",
    source: overrides.source ?? "system",
    actorType: overrides.actorType ?? "system",
    actorId: overrides.actorId ?? null,
    eventName: overrides.eventName ?? "test-event",
    status: overrides.status ?? "info",
    summary: overrides.summary ?? null,
    requestId: overrides.requestId ?? null,
    workflowRunId: overrides.workflowRunId ?? null,
    harnessRunId: overrides.harnessRunId ?? null,
    sandboxName: overrides.sandboxName ?? null,
    managedRuntimeProfileRunId: overrides.managedRuntimeProfileRunId ?? null,
    serviceId: overrides.serviceId ?? null,
    browserRunId: overrides.browserRunId ?? null,
    payload: overrides.payload ?? {},
    redactionStatus: overrides.redactionStatus ?? "passed",
    createdAt: overrides.createdAt ?? "2026-05-01T10:00:00.000Z",
  };
}

function makeWorkflowRun(
  overrides: Partial<{
    id: string;
    chatId: string;
    sessionId: string;
    userId: string;
    status: string;
    startedAt: string;
    finishedAt: string;
    createdAt: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "run-1",
    chatId: overrides.chatId ?? "chat-1",
    sessionId: overrides.sessionId ?? "session-1",
    userId: overrides.userId ?? "user-1",
    modelId: null,
    requestId: null,
    runtimeMode: "managed_runtime" as const,
    sandboxName: null,
    managedRuntimeProfileId: null,
    managedRuntimeProfileVersion: null,
    managedRuntimeProfileRunId: null,
    errorMessage: null,
    status: overrides.status ?? "completed",
    startedAt: overrides.startedAt ?? "2026-05-01T09:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-05-01T09:30:00.000Z",
    totalDurationMs: 1800000,
    createdAt: overrides.createdAt ?? "2026-05-01T09:00:00.000Z",
  };
}

function makeWorkflowRunStep(
  overrides: Partial<{
    id: string;
    workflowRunId: string;
    stepNumber: number;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    finishReason: string | null;
    rawFinishReason: string | null;
    createdAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? "step-1",
    workflowRunId: overrides.workflowRunId ?? "run-1",
    stepNumber: overrides.stepNumber ?? 1,
    startedAt: overrides.startedAt ?? new Date("2026-05-01T09:05:00.000Z"),
    finishedAt: overrides.finishedAt ?? new Date("2026-05-01T09:10:00.000Z"),
    durationMs: overrides.durationMs ?? 300000,
    finishReason: overrides.finishReason ?? "stop",
    rawFinishReason: overrides.rawFinishReason ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-05-01T09:05:00.000Z"),
  };
}

function makeWorker(
  overrides: Partial<{
    id: string;
    source: "message";
    taskToolCallId: string;
    workerType: string;
    status: string;
    sandboxName: string | null;
    profileId: string | null;
    profileVersion: string | null;
    profileDisplayName: string | null;
    profileRunId: string | null;
    currentToolName: string | null;
    currentToolSummary: string | null;
    toolCallCount: number;
    summary: string | null;
    updatedAt: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? "worker-1",
    source: "message" as const,
    taskToolCallId: overrides.taskToolCallId ?? "task-1",
    workerType: overrides.workerType ?? "executor",
    status: overrides.status ?? "completed",
    sandboxName: overrides.sandboxName ?? null,
    profileId: overrides.profileId ?? null,
    profileVersion: overrides.profileVersion ?? null,
    profileDisplayName: overrides.profileDisplayName ?? null,
    profileRunId: overrides.profileRunId ?? null,
    currentToolName: overrides.currentToolName ?? null,
    currentToolSummary: overrides.currentToolSummary ?? null,
    toolCallCount: overrides.toolCallCount ?? 0,
    summary: overrides.summary ?? null,
    updatedAt: overrides.updatedAt ?? "2026-05-01T10:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Import the module under test — fails before operator-timeline.ts exists
// ---------------------------------------------------------------------------

const { buildOperatorTimeline, OperatorTimelineError } =
  await import("./operator-timeline");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildOperatorTimeline", () => {
  // TC-001 — Chronological ordering
  test("TC-001: returns entries sorted chronologically ascending by timestamp", () => {
    const t1 = "2026-05-01T10:01:00.000Z";
    const t2 = "2026-05-01T10:02:00.000Z";
    const t3 = "2026-05-01T10:03:00.000Z";
    const t4 = "2026-05-01T10:04:00.000Z";

    const events = [
      makeEvent({ id: "evt-a", createdAt: t3, eventName: "event-a" }),
      makeEvent({ id: "evt-b", createdAt: t1, eventName: "event-b" }),
      makeEvent({ id: "evt-c", createdAt: t2, eventName: "event-c" }),
    ];

    const step = makeWorkflowRunStep({
      id: "step-4",
      startedAt: new Date(t4),
      finishedAt: new Date("2026-05-01T10:05:00.000Z"),
    });

    const result = buildOperatorTimeline(events, [], [step], []);
    expect(result.length).toBeGreaterThanOrEqual(4);

    const timestamps = result.map((e: { timestamp: string }) => e.timestamp);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);

    // The four source timestamps must all appear in ascending order
    const entryTimestamps = result.map(
      (e: { timestamp: string }) => e.timestamp,
    );
    const idxT1 = entryTimestamps.indexOf(t1);
    const idxT2 = entryTimestamps.indexOf(t2);
    const idxT3 = entryTimestamps.indexOf(t3);
    const idxT4 = entryTimestamps.findIndex((t: string) => t >= t4);
    expect(idxT1).toBeLessThan(idxT2);
    expect(idxT2).toBeLessThan(idxT3);
    expect(idxT3).toBeLessThan(idxT4);
  });

  // TC-002 — Consecutive duplicate collapse
  test("TC-002: collapses consecutive identical entries by kind:actor:label:workflowRunId", () => {
    // Three consecutive session events that are identical in kind/actor/eventName/workflowRunId
    const events = [
      makeEvent({
        id: "dup-1",
        createdAt: "2026-05-01T10:01:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-abc",
        summary: "worker starting",
      }),
      makeEvent({
        id: "dup-2",
        createdAt: "2026-05-01T10:02:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-abc",
        summary: "worker starting",
      }),
      makeEvent({
        id: "dup-3",
        createdAt: "2026-05-01T10:03:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-abc",
        summary: "worker starting",
      }),
      // non-duplicate interleaved
      makeEvent({
        id: "other-1",
        createdAt: "2026-05-01T10:04:00.000Z",
        eventName: "different-event",
        actorType: "system",
        workflowRunId: null,
      }),
      // duplicate again but not consecutive (non-consecutive should NOT be collapsed)
      makeEvent({
        id: "dup-4",
        createdAt: "2026-05-01T10:05:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-abc",
        summary: "worker starting",
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);

    // The three consecutive duplicates should collapse to 1; total = 1 + 1 + 1 = 3
    expect(result.length).toBe(3);

    // First entry is the collapsed dup
    expect(result[0].correlationIds.workflowRunId).toBe("run-abc");
    // Fourth (non-consecutive dup) should be present
    expect(result[2].correlationIds.workflowRunId).toBe("run-abc");
  });

  // TC-003 — Sensitive field redaction
  test("TC-003: redacts bearer tokens and env secrets from label and summary", () => {
    const events = [
      makeEvent({
        id: "secret-evt",
        createdAt: "2026-05-01T10:00:00.000Z",
        eventName: "Bearer sk-test-secret-1234567890123",
        summary: "MY_SECRET=supersecretvalue",
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);

    expect(result.length).toBe(1);
    const entry = result[0] as { label: string; summary: string | null };

    // Bearer token must be redacted
    expect(entry.label).not.toContain("sk-test-secret-1234567890123");
    expect(entry.label).not.toContain("Bearer sk-test-secret");

    // Env assignment must be redacted
    expect(entry.summary).not.toContain("supersecretvalue");
    expect(entry.summary).not.toContain("MY_SECRET=supersecretvalue");
  });

  // TC-004 — Window/limit cap
  test("TC-004: caps result to most-recent N entries when limit option is provided", () => {
    const events: SessionEventSnapshot[] = [];
    for (let i = 0; i < 300; i++) {
      const ts = new Date(Date.UTC(2026, 4, 1, 10, 0, i)).toISOString();
      events.push(
        makeEvent({ id: `evt-${i}`, createdAt: ts, eventName: `event-${i}` }),
      );
    }

    const result = buildOperatorTimeline(events, [], [], [], { limit: 200 });
    expect(result.length).toBeLessThanOrEqual(200);

    // Result should be the 200 most-recent (highest timestamps)
    const lastTs = events[events.length - 1].createdAt;
    const firstTs = events[events.length - 200].createdAt;
    const resultTimestamps = result.map(
      (e: { timestamp: string }) => e.timestamp,
    );
    expect(resultTimestamps[resultTimestamps.length - 1]).toBe(lastTs);
    expect(resultTimestamps[0]).toBe(firstTs);
  });

  // TC-005 — Correlation IDs attached
  test("TC-005: carries correlation IDs from source event fields", () => {
    const events = [
      makeEvent({
        id: "corr-evt",
        createdAt: "2026-05-01T10:00:00.000Z",
        workflowRunId: "run-abc",
        chatId: "chat-xyz",
        sandboxName: "sb-1",
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);
    expect(result.length).toBe(1);
    const entry = result[0] as {
      correlationIds: {
        workflowRunId: string | null;
        chatId: string | null;
        sandboxName: string | null;
      };
    };

    expect(entry.correlationIds.workflowRunId).toBe("run-abc");
    expect(entry.correlationIds.chatId).toBe("chat-xyz");
    expect(entry.correlationIds.sandboxName).toBe("sb-1");
  });

  // TC-006 — Empty input returns empty array
  test("TC-006: returns empty array for all-empty input without throwing", () => {
    expect(() => {
      const result = buildOperatorTimeline([], [], [], []);
      expect(result).toEqual([]);
    }).not.toThrow();
  });

  // TC-007 — Malformed event skipped with warn (not crash)
  test("TC-007: skips malformed events (null createdAt), warns, does not throw", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const goodEvent = makeEvent({
      id: "good-evt",
      createdAt: "2026-05-01T10:01:00.000Z",
      eventName: "good-event",
    });

    // Malformed: createdAt is null (invalid)
    const malformed = {
      ...makeEvent({ id: "bad-evt" }),
      createdAt: null as unknown as string,
    };

    const result = buildOperatorTimeline([goodEvent, malformed], [], [], []);

    expect(result.length).toBe(1);
    expect(result[0].id).toBeDefined();

    // console.warn must have been called mentioning operator_timeline_invalid_event
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(warnArgs).toContain("operator_timeline_invalid_event");

    warnSpy.mockRestore();
  });

  // TC-008 — Route response includes operatorTimeline field
  // (unit test: verifies buildOperatorTimeline is called correctly and returns an array)
  test("TC-008: buildOperatorTimeline returns an array suitable for the operatorTimeline route field", () => {
    const run = makeWorkflowRun({ id: "run-1" });
    const step = makeWorkflowRunStep({
      id: "step-1",
      workflowRunId: "run-1",
      stepNumber: 1,
      startedAt: new Date("2026-05-01T09:05:00.000Z"),
      finishedAt: new Date("2026-05-01T09:10:00.000Z"),
    });
    const worker = makeWorker({ id: "worker-1" });

    const result = buildOperatorTimeline(
      [
        makeEvent({
          id: "evt-route",
          createdAt: "2026-05-01T09:00:00.000Z",
          eventName: "session-started",
          workflowRunId: "run-1",
        }),
      ],
      [run],
      [step],
      [worker],
    );

    // Must be an array — can be empty for no events session
    expect(Array.isArray(result)).toBe(true);

    // Each entry must have the required OperatorTimelineEntry shape
    for (const entry of result as Array<{
      id: string;
      timestamp: string;
      kind: string;
      actor: string;
      label: string;
      summary: string | null;
      correlationIds: Record<string, unknown>;
      severity: string;
    }>) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.kind).toBe("string");
      expect(typeof entry.actor).toBe("string");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.correlationIds).toBe("object");
      expect(typeof entry.severity).toBe("string");
    }
  });

  // OperatorTimelineError class
  test("OperatorTimelineError has correct kind property", () => {
    const err = new OperatorTimelineError(
      "test error",
      "operator_timeline_build_failed",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("operator_timeline_build_failed");
    expect(err.message).toBe("test error");
  });

  // ---------------------------------------------------------------------------
  // REGRESSION TESTS — these guards catch future breakage
  // ---------------------------------------------------------------------------

  // REGRESSION-001: Secret never appears in ANY timeline entry (payload-level)
  // If redaction is bypassed, a secret token would appear verbatim in entry.label or entry.summary.
  test("REGRESSION-001: no secret token appears in any entry label or summary", () => {
    const SECRET = "ghp_AAABBBCCC12345678901234567890";
    const events = [
      makeEvent({
        id: "reg-sec-1",
        createdAt: "2026-05-01T10:00:00.000Z",
        eventName: `Deploying with ${SECRET}`,
        summary: `Token=${SECRET}`,
      }),
      makeEvent({
        id: "reg-sec-2",
        createdAt: "2026-05-01T10:01:00.000Z",
        eventName: "normal event",
        summary: null,
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);
    for (const entry of result as Array<{
      label: string;
      summary: string | null;
    }>) {
      expect(entry.label).not.toContain(SECRET);
      if (entry.summary !== null) {
        expect(entry.summary).not.toContain(SECRET);
      }
    }
  });

  // REGRESSION-002: Chronological order is stable even with tie-breaking by id
  // If sort stability is lost, equal-timestamp entries could swap.
  test("REGRESSION-002: tie-breaking by id preserves stable sort for same-timestamp entries", () => {
    const ts = "2026-05-01T10:00:00.000Z";
    const events = [
      makeEvent({ id: "zzz-last", createdAt: ts, eventName: "event-z" }),
      makeEvent({ id: "aaa-first", createdAt: ts, eventName: "event-a" }),
      makeEvent({ id: "mmm-mid", createdAt: ts, eventName: "event-m" }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);
    const ids = result.map((e: { id: string }) => e.id);

    // All same timestamp — id tie-break must produce ascending order
    expect(ids.indexOf("aaa-first")).toBeLessThan(ids.indexOf("mmm-mid"));
    expect(ids.indexOf("mmm-mid")).toBeLessThan(ids.indexOf("zzz-last"));
  });

  // REGRESSION-003: Dedup does NOT collapse non-consecutive identical entries
  // If dedup collapses globally (not just consecutive), this test fails.
  test("REGRESSION-003: non-consecutive identical entries are preserved, not collapsed", () => {
    const events = [
      makeEvent({
        id: "a",
        createdAt: "2026-05-01T10:01:00.000Z",
        eventName: "dup-event",
        actorType: "system",
        workflowRunId: null,
      }),
      makeEvent({
        id: "b",
        createdAt: "2026-05-01T10:02:00.000Z",
        eventName: "different-event",
        actorType: "system",
        workflowRunId: null,
      }),
      makeEvent({
        id: "c",
        createdAt: "2026-05-01T10:03:00.000Z",
        eventName: "dup-event",
        actorType: "system",
        workflowRunId: null,
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], []);
    // Non-consecutive duplicates must NOT be collapsed → 3 entries
    expect(result.length).toBe(3);
  });

  // REGRESSION-004: malformed event does NOT cause a throw — must remain best-effort
  // If malformed-event handling is removed and a throw is introduced, this test fails.
  test("REGRESSION-004: multiple malformed events are all skipped without throwing", () => {
    const goodEvent = makeEvent({
      id: "good-reg",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    const malformed1 = { ...makeEvent(), createdAt: null as unknown as string };
    const malformed2 = { ...makeEvent(), createdAt: "" as unknown as string };

    let threw = false;
    let result: Array<{ id: string }> = [];
    try {
      result = buildOperatorTimeline(
        [malformed1, goodEvent, malformed2],
        [],
        [],
        [],
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    // Only the good event should appear
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("good-reg");
  });

  // REGRESSION-005: existing SessionObservabilityResponse fields are additive
  // (type-level: operatorTimeline is optional and does not break callers that
  //  do not destructure it — validated by the fact that all adjacent tests pass
  //  without referencing the new field, and the type allows undefined)
  test("REGRESSION-005: OperatorTimelineEntry has all required shape fields", () => {
    const result = buildOperatorTimeline(
      [
        makeEvent({
          id: "shape-check",
          createdAt: "2026-05-01T10:00:00.000Z",
        }),
      ],
      [],
      [],
      [],
    );

    expect(result.length).toBe(1);
    const entry = result[0] as Record<string, unknown>;

    // Every required field from the issue spec must be present
    const requiredFields = [
      "id",
      "timestamp",
      "kind",
      "actor",
      "label",
      "summary",
      "correlationIds",
      "severity",
    ];
    for (const field of requiredFields) {
      expect(Object.hasOwn(entry, field)).toBe(true);
    }

    // correlationIds must have sessionId
    const correlationIds = entry.correlationIds as Record<string, unknown>;
    expect(Object.hasOwn(correlationIds, "sessionId")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // FIX 1 — windowMs is honored (no unfiltered fallback) + explicit now
  // ---------------------------------------------------------------------------

  // FIX1-A: entries older than the window are excluded
  test("FIX1-A: entries older than windowMs are excluded from result", () => {
    // All events are 2 hours old relative to explicit now
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0); // 2026-05-01T12:00:00Z
    const oneHourAgo = "2026-05-01T11:00:00.000Z"; // 1h before now — within 2h window
    const threeHoursAgo = "2026-05-01T09:00:00.000Z"; // 3h before now — outside 2h window

    const events = [
      makeEvent({ id: "in-window", createdAt: oneHourAgo, eventName: "recent" }),
      makeEvent({
        id: "out-of-window",
        createdAt: threeHoursAgo,
        eventName: "old",
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], [], {
      windowMs: 2 * 60 * 60 * 1000,
      now: nowMs,
    });

    // Only the in-window event should appear
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("in-window");
  });

  // FIX1-B: all entries outside window returns [] (NOT the unfiltered set)
  test("FIX1-B: all entries outside windowMs returns empty array, not unfiltered fallback", () => {
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0); // 2026-05-01T12:00:00Z
    // All events are 2 days old — outside a 1h window
    const events = [
      makeEvent({
        id: "stale-1",
        createdAt: "2026-04-29T10:00:00.000Z",
        eventName: "old-event-1",
      }),
      makeEvent({
        id: "stale-2",
        createdAt: "2026-04-29T11:00:00.000Z",
        eventName: "old-event-2",
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], [], {
      windowMs: 60 * 60 * 1000, // 1 hour
      now: nowMs,
    });

    // Must return [] — NOT fall back to the 2 stale entries
    expect(result).toEqual([]);
  });

  // FIX1-C: without windowMs, all entries pass regardless of age
  test("FIX1-C: when windowMs is omitted, all entries pass regardless of timestamp age", () => {
    // Entries from years ago — should all pass with no windowing
    const events = [
      makeEvent({
        id: "ancient-1",
        createdAt: "2020-01-01T00:00:00.000Z",
        eventName: "old-event",
      }),
      makeEvent({
        id: "ancient-2",
        createdAt: "2019-06-15T00:00:00.000Z",
        eventName: "older-event",
      }),
    ];

    // No windowMs passed → windowing disabled
    const result = buildOperatorTimeline(events, [], [], []);

    expect(result.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // FIX 2 — dedup key must not collapse distinct consecutive entries
  // ---------------------------------------------------------------------------

  // FIX2-A: consecutive entries with same kind/actor/label/workflowRunId but DIFFERENT summary → both kept
  test("FIX2-A: consecutive entries with different summary are NOT collapsed", () => {
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
    const events = [
      makeEvent({
        id: "same-kind-1",
        createdAt: "2026-05-01T11:00:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-xyz",
        summary: "summary-A", // distinct summary
      }),
      makeEvent({
        id: "same-kind-2",
        createdAt: "2026-05-01T11:01:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-xyz",
        summary: "summary-B", // different summary — must NOT be deduped
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], [], {
      windowMs: 2 * 60 * 60 * 1000,
      now: nowMs,
    });

    // Both entries must be preserved because summaries differ
    expect(result.length).toBe(2);
    const summaries = result.map(
      (e: { summary: string | null }) => e.summary,
    );
    // Both summaries present (they pass through redaction unchanged for plain text)
    expect(summaries).toContain("summary-A");
    expect(summaries).toContain("summary-B");
  });

  // FIX2-B: true consecutive duplicates (identical in all meaningful fields) still collapse
  test("FIX2-B: consecutive entries identical in ALL meaningful fields are still collapsed to one", () => {
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
    const events = [
      makeEvent({
        id: "true-dup-1",
        createdAt: "2026-05-01T11:00:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-xyz",
        summary: "same-summary",
      }),
      makeEvent({
        id: "true-dup-2",
        createdAt: "2026-05-01T11:01:00.000Z",
        eventName: "worker-launched",
        actorType: "workflow",
        workflowRunId: "run-xyz",
        summary: "same-summary", // identical summary → collapse
      }),
    ];

    const result = buildOperatorTimeline(events, [], [], [], {
      windowMs: 2 * 60 * 60 * 1000,
      now: nowMs,
    });

    // Same kind + actor + label + workflowRunId + summary → collapsed
    expect(result.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // FIX 3 — recorder is actually invoked (not a no-op)
  // ---------------------------------------------------------------------------

  // FIX3-A: recorder receives operator-timeline-built on success
  test("FIX3-A: injected recorder is called with operator-timeline-built on successful build", () => {
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
    const calls: Array<[string, Record<string, unknown>]> = [];
    const spyRecorder = mock(
      (eventName: string, fields: Record<string, unknown>) => {
        calls.push([eventName, fields]);
      },
    );

    buildOperatorTimeline(
      [
        makeEvent({
          id: "rec-evt",
          createdAt: "2026-05-01T11:00:00.000Z",
          sessionId: "sess-rec",
        }),
      ],
      [],
      [],
      [],
      { windowMs: 2 * 60 * 60 * 1000, now: nowMs },
      spyRecorder,
    );

    const builtCall = calls.find(([name]) => name === "operator-timeline-built");
    expect(builtCall).toBeDefined();
    // Must include sessionId and entryCount
    const fields = builtCall?.[1] ?? {};
    expect(fields.sessionId).toBe("sess-rec");
    expect(typeof fields.entryCount).toBe("number");
  });

  // FIX3-B: recorder receives operator-timeline-build-failed when build throws
  test("FIX3-B: injected recorder is called with operator-timeline-build-failed when build fails", () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const spyRecorder = mock(
      (eventName: string, fields: Record<string, unknown>) => {
        calls.push([eventName, fields]);
      },
    );

    // Trigger a build failure by forcing an OperatorTimelineError inside
    // Pass a corrupt events array that will cause processing to throw
    const corruptEvents = null as unknown as Parameters<
      typeof buildOperatorTimeline
    >[0];

    let threw = false;
    try {
      buildOperatorTimeline(corruptEvents, [], [], [], undefined, spyRecorder);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    const failedCall = calls.find(
      ([name]) => name === "operator-timeline-build-failed",
    );
    expect(failedCall).toBeDefined();
  });

  // FIX3-C: recorder emission never throws even when recorder itself throws
  test("FIX3-C: recorder that throws internally does not break the timeline build", () => {
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
    const throwingRecorder = mock(
      (_eventName: string, _fields: Record<string, unknown>) => {
        throw new Error("recorder failed");
      },
    );

    let result: ReturnType<typeof buildOperatorTimeline> = [];
    let threw = false;
    try {
      result = buildOperatorTimeline(
        [
          makeEvent({
            id: "safe-evt",
            createdAt: "2026-05-01T11:00:00.000Z",
          }),
        ],
        [],
        [],
        [],
        { windowMs: 2 * 60 * 60 * 1000, now: nowMs },
        throwingRecorder,
      );
    } catch {
      threw = true;
    }

    // The timeline build must succeed despite recorder throwing
    expect(threw).toBe(false);
    expect(result.length).toBe(1);
  });
});
