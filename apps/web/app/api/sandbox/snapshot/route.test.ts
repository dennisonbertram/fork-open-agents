import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type TestSandboxState = {
  type: "vercel";
  sandboxName?: string;
  expiresAt?: number;
};

type TestSessionRecord = {
  id: string;
  userId: string;
  sandboxState: TestSandboxState | null;
  snapshotUrl: string | null;
  snapshotCreatedAt: Date | null;
  lifecycleVersion: number;
  lifecycleState: string | null;
  sandboxExpiresAt: Date | null;
  hibernateAfter: Date | null;
  lastActivityAt: Date | null;
};

const connectCalls: Array<{
  state: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}> = [];
const updateCalls: Array<Record<string, unknown>> = [];
const kickCalls: Array<{ sessionId: string; reason: string }> = [];

let stopCallCount = 0;
let stopError: Error | null = null;
let connectSandboxResumeError: Error | null = null;
let sessionRecord: TestSessionRecord;
let ownedSessionAllowed = true;
const consoleErrors: string[] = [];
const originalConsoleError = console.error;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true as const,
    userId: "user-1",
  }),
  requireOwnedSession: async () =>
    ownedSessionAllowed
      ? ({ ok: true as const, sessionRecord } as const)
      : ({
          ok: false as const,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        } as const),
  requireOwnedSessionWithSandboxGuard: async ({
    sandboxGuard,
  }: {
    sandboxGuard: (state: TestSandboxState | null) => boolean;
  }) =>
    sandboxGuard(sessionRecord.sandboxState)
      ? ({ ok: true as const, sessionRecord } as const)
      : ({
          ok: false as const,
          response: Response.json(
            { error: "Sandbox not initialized" },
            { status: 400 },
          ),
        } as const),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  updateSession: async (_sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    sessionRecord = {
      ...sessionRecord,
      ...(patch as Partial<TestSessionRecord>),
    };
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: {
    sessionId: string;
    reason: string;
  }) => {
    kickCalls.push(input);
  },
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (
    state: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    connectCalls.push({ state, options });

    if (
      connectSandboxResumeError &&
      options?.resume === true &&
      typeof state.sandboxName === "string" &&
      state.snapshotId === undefined
    ) {
      throw connectSandboxResumeError;
    }

    const sandboxName =
      typeof state.sandboxName === "string"
        ? state.sandboxName
        : "session_session-1";
    return {
      id: "runtime-1",
      expiresAt: Date.now() + 120_000,
      workingDirectory: "/vercel/sandbox",
      stop: async () => {
        stopCallCount += 1;
        if (stopError) {
          throw stopError;
        }
      },
      getState: () => ({
        type: "vercel" as const,
        sandboxName,
        expiresAt: Date.now() + 120_000,
      }),
    };
  },
}));

const routeModulePromise = import("./route");

afterAll(() => {
  console.error = originalConsoleError;
});

function makeSessionRecord(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    sandboxState: {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: Date.now() + 60_000,
    },
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleVersion: 2,
    lifecycleState: "active",
    sandboxExpiresAt: new Date(Date.now() + 60_000),
    hibernateAfter: new Date(Date.now() + 30_000),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

describe("/api/sandbox/snapshot", () => {
  beforeEach(() => {
    connectCalls.length = 0;
    updateCalls.length = 0;
    kickCalls.length = 0;
    stopCallCount = 0;
    stopError = null;
    connectSandboxResumeError = null;
    ownedSessionAllowed = true;
    consoleErrors.length = 0;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    };
    sessionRecord = makeSessionRecord();
  });

  test("POST pauses a named persistent sandbox without writing a legacy snapshot", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      snapshotId: string | null;
    };

    expect(response.ok).toBe(true);
    expect(stopCallCount).toBe(1);
    expect(payload.snapshotId).toBe("session_session-1");
    expect(connectCalls[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
    });
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        snapshotUrl: null,
        snapshotCreatedAt: null,
        sandboxState: {
          type: "vercel",
          sandboxName: "session_session-1",
        },
        lifecycleVersion: 3,
        lifecycleState: "hibernated",
      }),
    );
  });

  test("POST redacts provider failure details and returns typed pause evidence", async () => {
    const { POST } = await routeModulePromise;
    stopError = new Error("provider_token=super-secret failed to stop");

    const response = await POST(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "request-950",
        },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      error: string;
      errorKind?: string;
      requestId?: string;
      retryable?: boolean;
    };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Sandbox pause failed. Try again.");
    expect(payload.errorKind).toBe("sandbox_pause_failed");
    expect(payload.requestId).toBe("request-950");
    expect(payload.retryable).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret");
  });

  test("PUT resumes an existing named persistent sandbox", async () => {
    const { PUT } = await routeModulePromise;

    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      sandboxName?: string;
      restoredFrom?: string;
    };

    expect(response.ok).toBe(true);
    expect(payload.sandboxName).toBe("session_session-1");
    expect(payload.restoredFrom).toBe("session_session-1");
    expect(connectCalls[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      options: {
        resume: true,
      },
    });
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        sandboxState: expect.objectContaining({
          type: "vercel",
          sandboxName: "session_session-1",
        }),
        snapshotUrl: null,
        snapshotCreatedAt: null,
        lifecycleVersion: 3,
      }),
    );
    expect(kickCalls).toEqual([
      { sessionId: "session-1", reason: "snapshot-restored" },
    ]);
  });

  test("repeated resume is idempotent and does not reconnect a second sandbox", async () => {
    const { PUT } = await routeModulePromise;
    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });
    const request = () =>
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      });

    const firstResponse = await PUT(request());
    const secondResponse = await PUT(request());
    const secondPayload = (await secondResponse.json()) as {
      alreadyRunning?: boolean;
      restoredFrom?: string;
    };

    expect(firstResponse.ok).toBe(true);
    expect(secondResponse.ok).toBe(true);
    expect(secondPayload.alreadyRunning).toBe(true);
    expect(secondPayload.restoredFrom).toBe("session_session-1");
    expect(connectCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
  });

  test("PUT treats a provider already-running race as safe idempotent recovery", async () => {
    const { PUT } = await routeModulePromise;
    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });
    connectSandboxResumeError = new Error(
      "Sandbox is still running provider_token=super-secret",
    );

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "request-already-running",
        },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      success?: boolean;
      alreadyRunning?: boolean;
      sandboxName?: string;
      restoredFrom?: string;
      requestId?: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      alreadyRunning: true,
      sandboxName: "session_session-1",
      restoredFrom: "session_session-1",
      requestId: "request-already-running",
    });
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(consoleErrors.join("\n")).not.toContain("super-secret");
    expect(updateCalls).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
  });

  test("PUT does not reveal or reconnect a sandbox outside session ownership", async () => {
    const { PUT } = await routeModulePromise;
    ownedSessionAllowed = false;

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(connectCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("PUT clears a broken persistent sandbox handle after a 404", async () => {
    const { PUT } = await routeModulePromise;

    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      snapshotUrl: null,
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });
    connectSandboxResumeError = new Error("Status code 404 is not ok");

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      error: string;
      errorKind?: string;
    };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Saved sandbox is no longer available");
    expect(payload.errorKind).toBe("sandbox_resume_unavailable");
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        sandboxState: {
          type: "vercel",
        },
        lifecycleState: "hibernated",
      }),
    );
  });

  test("PUT redacts provider failure details and returns typed retry evidence", async () => {
    const { PUT } = await routeModulePromise;
    sessionRecord = makeSessionRecord({
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });
    connectSandboxResumeError = new Error(
      "provider timeout provider_token=super-secret",
    );

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "request-950",
        },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );
    const payload = (await response.json()) as {
      error: string;
      errorKind?: string;
      requestId?: string;
      retryable?: boolean;
    };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Sandbox resume failed. Try again.");
    expect(payload.errorKind).toBe("sandbox_resume_failed");
    expect(payload.requestId).toBe("request-950");
    expect(payload.retryable).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(consoleErrors.join("\n")).not.toContain("super-secret");
  });

  test("PUT lazily migrates a legacy snapshot-backed session on first resume", async () => {
    const { PUT } = await routeModulePromise;

    sessionRecord = makeSessionRecord({
      sandboxState: { type: "vercel" },
      snapshotUrl: "snap-legacy-1",
      lifecycleState: "hibernated",
      sandboxExpiresAt: null,
      hibernateAfter: null,
    });

    const response = await PUT(
      new Request("http://localhost/api/sandbox/snapshot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectCalls[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
        snapshotId: "snap-legacy-1",
      },
      options: {
        resume: true,
        createIfMissing: true,
        persistent: true,
      },
    });
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        sandboxState: expect.objectContaining({
          type: "vercel",
          sandboxName: "session_session-1",
        }),
        snapshotUrl: null,
        snapshotCreatedAt: null,
        lifecycleVersion: 3,
      }),
    );
    expect(kickCalls).toEqual([
      { sessionId: "session-1", reason: "snapshot-restored" },
    ]);
  });
});
