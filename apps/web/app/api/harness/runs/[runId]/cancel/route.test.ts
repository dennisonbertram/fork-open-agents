import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;
const previousEnv = {
  HARNESS_ENABLED: process.env.HARNESS_ENABLED,
  HARNESS_BASE_URL: process.env.HARNESS_BASE_URL,
  HARNESS_SERVICE_TOKEN: process.env.HARNESS_SERVICE_TOKEN,
  HARNESS_TENANT_ID: process.env.HARNESS_TENANT_ID,
  HARNESS_DEFAULT_PROJECT_ID: process.env.HARNESS_DEFAULT_PROJECT_ID,
};

type StatusUpdate = {
  runId: string;
  status: string;
};

let statusUpdates: StatusUpdate[] = [];

function restoreHarnessEnv() {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function enableHarnessEnv() {
  Object.assign(process.env, {
    HARNESS_ENABLED: "true",
    HARNESS_BASE_URL: "http://localhost:4318",
    HARNESS_SERVICE_TOKEN: "service-token",
    HARNESS_TENANT_ID: "tenant-1",
    HARNESS_DEFAULT_PROJECT_ID: "project-1",
  });
}

function createRun() {
  return {
    id: "vbrun-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    harnessRunId: "harness-run-1",
    mode: "verified_build" as const,
    status: "running",
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "user-1",
    idempotencyKey: "idem-1",
    intentSummary: "Fix the bug",
    selectionReason: "mutating_software_work",
    lastEventId: null,
    lastEventName: null,
    lastEventAt: null,
    planApprovalState: "not_required" as const,
    pendingApprovalKind: null,
    finalReportArtifactId: null,
    goNoGo: "unknown" as const,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
  requireOwnedSessionChat: async () => ({
    ok: true,
    sessionRecord: { id: "session-1" },
    chat: { id: "chat-1" },
  }),
}));

mock.module("@/lib/harness/run-mapping", () => ({
  getVerifiedBuildRunByIdForUser: async () => createRun(),
  getVerifiedBuildEventsForRun: async () => [],
  updateVerifiedBuildRunFromHarnessStatus: async (update: StatusUpdate) => {
    statusUpdates.push(update);
  },
  toVerifiedBuildRunSnapshot: (run: unknown) => run,
  toVerifiedBuildEventSnapshot: (event: unknown) => event,
}));

const routeModulePromise = import("./route");

describe("/api/harness/runs/[runId]/cancel", () => {
  beforeEach(() => {
    restoreHarnessEnv();
    enableHarnessEnv();
    statusUpdates = [];
    globalThis.fetch = (async () =>
      Response.json(
        { error: { code: "harness_unavailable" } },
        { status: 503 },
      )) as unknown as typeof fetch;
  });

  afterAll(() => {
    restoreHarnessEnv();
    globalThis.fetch = originalFetch;
  });

  test("does not mark cancellation requested when the harness cancel call fails", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/harness/runs/vbrun-1/cancel", {
        method: "POST",
        body: JSON.stringify({ reason: "Stop this run" }),
      }),
      { params: Promise.resolve({ runId: "vbrun-1" }) },
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(statusUpdates).not.toContainEqual({
      runId: "vbrun-1",
      status: "cancellation_requested",
    });
  });
});
