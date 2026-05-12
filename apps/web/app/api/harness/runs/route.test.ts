import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

type OwnedResult =
  | { ok: true; sessionRecord: { id: string }; chat: { id: string } }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedResult: OwnedResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
  chat: { id: "chat-1" },
};
let latestRun: ReturnType<typeof createRun> | null = null;
let startCalls: unknown[] = [];

const previousEnv = {
  HARNESS_ENABLED: process.env.HARNESS_ENABLED,
  HARNESS_BASE_URL: process.env.HARNESS_BASE_URL,
  HARNESS_SERVICE_TOKEN: process.env.HARNESS_SERVICE_TOKEN,
  HARNESS_TENANT_ID: process.env.HARNESS_TENANT_ID,
  HARNESS_DEFAULT_PROJECT_ID: process.env.HARNESS_DEFAULT_PROJECT_ID,
};

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
    status: "accepted",
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
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ownedResult,
}));

mock.module("@/lib/harness/run-mapping", () => ({
  getVerifiedBuildRunByIdForUser: async () => latestRun,
  getLatestVerifiedBuildRunForChat: async () => latestRun,
  getVerifiedBuildEventsForRun: async () => [],
  startVerifiedBuildRun: async (input: unknown) => {
    startCalls.push(input);
    return createRun();
  },
  updateVerifiedBuildRunFromHarnessStatus: async () => {},
  toVerifiedBuildRunSnapshot: (run: unknown) => run,
  toVerifiedBuildEventSnapshot: (event: unknown) => event,
}));

const routeModulePromise = import("./route");

describe("/api/harness/runs", () => {
  beforeEach(() => {
    restoreHarnessEnv();
    authResult = { ok: true, userId: "user-1" };
    ownedResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: { id: "chat-1" },
    };
    latestRun = null;
    startCalls = [];
  });

  afterAll(() => {
    restoreHarnessEnv();
  });

  test("GET returns latest owned run", async () => {
    latestRun = createRun();
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/harness/runs?sessionId=session-1&chatId=chat-1",
      ),
    );
    const body = (await response.json()) as { run: { id: string } | null };

    expect(response.status).toBe(200);
    expect(body.run?.id).toBe("vbrun-1");
  });

  test("POST fails closed when harness is disabled", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/harness/runs", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "session-1",
          chatId: "chat-1",
          latestUserMessageId: "message-1",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(startCalls).toHaveLength(0);
  });

  test("POST starts a run when enabled", async () => {
    enableHarnessEnv();
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/harness/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          chatId: "chat-1",
          latestUserMessageId: "message-1",
          intentSummary: "Fix the bug",
        }),
      }),
    );
    const body = (await response.json()) as { run: { id: string } };

    expect(response.status).toBe(202);
    expect(body.run.id).toBe("vbrun-1");
    expect(startCalls).toHaveLength(1);
  });
});
