import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock for insert/update writer-signature tests ────────────────────────
const insertedValues: Array<Record<string, unknown>> = [];
const updateSetCalls: Array<Record<string, unknown>> = [];

const returningInsertMock = mock(() => {
  const last = insertedValues.at(-1);
  return last ? [{ id: "run-1", ...last }] : [];
});
const valuesMock = mock((vals: Record<string, unknown>) => {
  insertedValues.push(vals);
  return { returning: returningInsertMock };
});
const insertMock = mock((_table: unknown) => ({ values: valuesMock }));

const updateSetMock = mock((setVals: Record<string, unknown>) => {
  updateSetCalls.push(setVals);
  return {
    where: mock(() => ({
      returning: mock(() => [{ id: "run-1", ...setVals }]),
    })),
  };
});
const updateMock = mock((_table: unknown) => ({ set: updateSetMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    query: {
      managedRuntimeProfileRuns: { findFirst: mock(async () => undefined) },
    },
  },
}));

const {
  buildManagedRuntimeCommandObservation,
  summarizeManagedRuntimeCommandOutput,
  startManagedRuntimeProfileRun,
  finishManagedRuntimeProfileRun,
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

describe("startManagedRuntimeProfileRun — requested/resolved profile ids", () => {
  // RED: today the writer only persists profile.id (the resolved profile) and
  // has no requestedProfileId field, so a caller cannot distinguish a
  // requested id from the id that was actually resolved.
  test("persists requestedProfileId and resolvedProfileId on the run", async () => {
    insertedValues.length = 0;

    await startManagedRuntimeProfileRun({
      sessionId: "session-1",
      userId: "user-1",
      requestedProfileId: "session-profile-missing",
      resolvedProfileId: "web-bun-agent-browser",
      profile: {
        id: "web-bun-agent-browser",
        version: "2026-05-23.2",
        displayName: "Web app with Bun and browser checks",
        description: "desc",
        setupCommands: [],
        verificationCommands: [],
        expectedTools: [],
        optionalTools: [],
        defaultPorts: [],
      },
    });

    expect(insertedValues[0]).toMatchObject({
      requestedProfileId: "session-profile-missing",
      resolvedProfileId: "web-bun-agent-browser",
    });
  });
});

describe("finishManagedRuntimeProfileRun — errorKind/nextAction", () => {
  // RED: today finishManagedRuntimeProfileRun has no errorKind/nextAction
  // params, so a fail-closed run cannot persist a typed error surface.
  test("persists errorKind and nextAction when the run fails closed", async () => {
    updateSetCalls.length = 0;

    await finishManagedRuntimeProfileRun({
      profileRunId: "run-1",
      status: "failed",
      failureMessage: "Verification command failed.",
      errorKind: "verification_failed",
      nextAction: "Re-run verification after fixing the failing command.",
    });

    expect(updateSetCalls[0]).toMatchObject({
      status: "failed",
      errorKind: "verification_failed",
      nextAction: "Re-run verification after fixing the failing command.",
    });
  });
});
