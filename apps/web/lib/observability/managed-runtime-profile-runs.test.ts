import { afterAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Decision A1: snapshotId is persisted on the run record
// Capture DB insert values for assertions
const insertedValues: Array<Record<string, unknown>> = [];
const updatedValues: Array<Record<string, unknown>> = [];

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues.push(vals);
        return {
          returning: async () => [{ ...vals, id: vals["id"] ?? "run-1" }],
        };
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updatedValues.push(vals);
        return {
          where: () => ({
            returning: async () => [{ id: "run-1", ...vals }],
          }),
        };
      },
    }),
    query: {
      managedRuntimeProfileRuns: {
        findFirst: async () => ({
          id: "run-1",
          setupResults: [],
          verificationResults: [],
        }),
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const {
  buildManagedRuntimeCommandObservation,
  startManagedRuntimeProfileRun,
  summarizeManagedRuntimeCommandOutput,
} = await import("./managed-runtime-profile-runs");

describe("managed runtime profile run observability", () => {
  test("summarizes command output without leaking obvious secrets", () => {
    expect(
      summarizeManagedRuntimeCommandOutput({
        success: false,
        exitCode: 1,
        stdout: "OPENAI_API_KEY=sk-12345678901234567890",
        stderr: "Bearer secret-token",
      }),
    ).toBe("[REDACTED]\nOPENAI_API_KEY=[REDACTED]");
  });

  // Decision A1: snapshotId is persisted on the run record
  test("persists snapshotId on the run record when provided", async () => {
    insertedValues.length = 0;

    await startManagedRuntimeProfileRun({
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      workflowRunId: null,
      sandboxName: "sandbox-abc",
      profile: {
        id: "web-bun-agent-browser",
        version: "1.0.0",
        displayName: "Test Profile",
        description: "Test",
        setupCommands: [],
        verificationCommands: [],
        expectedTools: [],
        optionalTools: [],
        defaultPorts: [3000],
      },
      snapshotId: "snap_abc123",
    });

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ snapshotId: "snap_abc123" });
  });

  test("persists null snapshotId when no snapshot is provided", async () => {
    insertedValues.length = 0;

    await startManagedRuntimeProfileRun({
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      workflowRunId: null,
      sandboxName: null,
      profile: {
        id: "web-bun-agent-browser",
        version: "1.0.0",
        displayName: "Test Profile",
        description: "Test",
        setupCommands: [],
        verificationCommands: [],
        expectedTools: [],
        optionalTools: [],
        defaultPorts: [3000],
      },
    });

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ snapshotId: null });
  });

  test("builds bounded command observations", () => {
    const startedAt = new Date("2026-05-23T12:00:00.000Z");
    const finishedAt = new Date("2026-05-23T12:00:03.250Z");

    expect(
      buildManagedRuntimeCommandObservation({
        command: {
          id: "verify-tool",
          label: "Verify tool",
          description: "Checks whether the tool is available.",
          command: "tool --version",
          required: false,
        },
        status: "skipped",
        startedAt,
        finishedAt,
        result: {
          success: false,
          exitCode: 127,
          stdout: "",
          stderr: "tool unavailable",
        },
      }),
    ).toEqual({
      commandId: "verify-tool",
      label: "Verify tool",
      status: "skipped",
      required: false,
      exitCode: 127,
      durationMs: 3250,
      summary: "tool unavailable",
      startedAt: "2026-05-23T12:00:00.000Z",
      finishedAt: "2026-05-23T12:00:03.250Z",
    });
  });
});
