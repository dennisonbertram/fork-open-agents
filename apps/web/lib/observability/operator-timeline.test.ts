import { describe, expect, mock, spyOn, test } from "bun:test";

// TC-008 route-level spy type defs (used in describe block below)
type BuildTimelineFn = (
  events: unknown[],
  workflowRuns: unknown[],
  workflowRunSteps: unknown[],
  workers: unknown[],
  options?: { limit?: number; windowMs?: number },
) => unknown[];

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<{
    id: string;
    sessionId: string;
    chatId: string | null;
    userId: string;
    source: string;
    actorType: string;
    actorId: string | null;
    eventName: string;
    status: string;
    summary: string | null;
    requestId: string | null;
    workflowRunId: string | null;
    harnessRunId: string | null;
    sandboxName: string | null;
    managedRuntimeProfileRunId: string | null;
    serviceId: string | null;
    browserRunId: string | null;
    payload: Record<string, unknown>;
    redactionStatus: string;
    createdAt: string;
  }> = {},
) {
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

const { buildOperatorTimeline, OperatorTimelineError } = await import(
  "./operator-timeline"
);

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

    const timestamps = result.map(
      (e: { timestamp: string }) => e.timestamp,
    );
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);

    // The four source timestamps must all appear in ascending order
    const entryTimestamps = result.map((e: { timestamp: string }) => e.timestamp);
    const idxT1 = entryTimestamps.findIndex((t: string) => t === t1);
    const idxT2 = entryTimestamps.findIndex((t: string) => t === t2);
    const idxT3 = entryTimestamps.findIndex((t: string) => t === t3);
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
    const events: ReturnType<typeof makeEvent>[] = [];
    for (let i = 0; i < 300; i++) {
      const ts = new Date(
        Date.UTC(2026, 4, 1, 10, 0, i),
      ).toISOString();
      events.push(
        makeEvent({ id: `evt-${i}`, createdAt: ts, eventName: `event-${i}` }),
      );
    }

    const result = buildOperatorTimeline(events, [], [], [], { limit: 200 });
    expect(result.length).toBeLessThanOrEqual(200);

    // Result should be the 200 most-recent (highest timestamps)
    const lastTs = events[events.length - 1].createdAt;
    const firstTs = events[events.length - 200].createdAt;
    const resultTimestamps = result.map((e: { timestamp: string }) => e.timestamp);
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
    const malformed = { ...makeEvent({ id: "bad-evt" }), createdAt: null };

    const result = buildOperatorTimeline(
      [goodEvent, malformed as unknown as ReturnType<typeof makeEvent>],
      [],
      [],
      [],
    );

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
});
