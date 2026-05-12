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

let fetchCalls: Request[] = [];

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
    status: "blocked",
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "user-1",
    idempotencyKey: "idem-1",
    intentSummary: "Fix the bug",
    selectionReason: "mutating_software_work",
    lastEventId: null,
    lastEventName: null,
    lastEventAt: null,
    planApprovalState: "pending" as const,
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
  updateVerifiedBuildRunFromHarnessStatus: async () => {},
  toVerifiedBuildRunSnapshot: (run: unknown) => run,
  toVerifiedBuildEventSnapshot: (event: unknown) => event,
}));

const routeModulePromise = import("./route");

describe("/api/harness/runs/[runId]/approve", () => {
  beforeEach(() => {
    restoreHarnessEnv();
    enableHarnessEnv();
    fetchCalls = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      fetchCalls.push(request.clone());

      if (request.method === "GET") {
        return Response.json({
          run_id: "harness-run-1",
          status: "blocked",
          pending_approvals: ["integration"],
        });
      }

      return Response.json({
        run_id: "harness-run-1",
        approval_kind: "integration",
        status: "recorded",
      });
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    restoreHarnessEnv();
    globalThis.fetch = originalFetch;
  });

  test("translates approved kind into the harness approval contract", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/harness/runs/vbrun-1/approve", {
        method: "POST",
        body: JSON.stringify({ kind: "integration", approved: true }),
      }),
      { params: Promise.resolve({ runId: "vbrun-1" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchCalls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(await fetchCalls[1]?.json()).toEqual({
      approval_kind: "integration",
      approved: true,
    });
  });

  test("rejects approval kinds that are not pending on the harness run", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/harness/runs/vbrun-1/approve", {
        method: "POST",
        body: JSON.stringify({ kind: "repair", approved: true }),
      }),
      { params: Promise.resolve({ runId: "vbrun-1" }) },
    );

    expect(response.status).toBe(400);
    expect(fetchCalls.map((call) => call.method)).toEqual(["GET"]);
  });
});
