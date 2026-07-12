import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectCalls: Array<Record<string, unknown>> = [];
let probeCalls = 0;
let ownedSessionAllowed = true;
const consoleErrors: string[] = [];
const consoleWarnings: string[] = [];
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

let probeResult: {
  success: boolean;
  stdout: string;
  stderr: string;
};

let sessionRecord: {
  id: string;
  userId: string;
  snapshotUrl: string | null;
  lifecycleState: "failed" | "active" | "hibernated";
  lifecycleError: string | null;
  sandboxState: {
    type: "vercel";
    sandboxName?: string;
    expiresAt?: number;
  };
  lastActivityAt: Date | null;
  hibernateAfter: Date | null;
  sandboxExpiresAt: Date | null;
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
  requireOwnedSession: async () =>
    ownedSessionAllowed
      ? { ok: true, sessionRecord }
      : {
          ok: false,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        },
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    sessionRecord = {
      ...sessionRecord,
      ...patch,
    } as typeof sessionRecord;
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildHibernatedLifecycleUpdate: () => ({
    lifecycleState: "hibernated",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  }),
  getSandboxExpiresAtDate: (
    state: { expiresAt?: unknown } | null | undefined,
  ) =>
    typeof state?.expiresAt === "number" ? new Date(state.expiresAt) : null,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (state: {
    type: "vercel";
    sandboxName?: string;
    expiresAt?: number;
  }) => {
    connectCalls.push(state);
    if (state.sandboxName && !probeResult.success) {
      throw new Error(
        probeResult.stderr || probeResult.stdout || "sandbox reconnect failed",
      );
    }
    const expiresAt = Date.now() + 2 * 60_000;
    return {
      workingDirectory: "/vercel/sandbox",
      expiresAt,
      exec: async () => {
        probeCalls += 1;
        return probeResult;
      },
      getState: () => ({
        ...state,
        ...(state.sandboxName ? { sandboxName: state.sandboxName } : {}),
        expiresAt,
      }),
    };
  },
}));

const routeModulePromise = import("./route");

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

describe("/api/sandbox/reconnect", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    connectCalls.length = 0;
    probeCalls = 0;
    ownedSessionAllowed = true;
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      consoleWarnings.push(args.map(String).join(" "));
    };
    probeResult = {
      success: true,
      stdout: "ok",
      stderr: "",
    };

    const now = Date.now();
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      snapshotUrl: "snap-1",
      lifecycleState: "failed",
      lifecycleError: "snapshot failed",
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
        expiresAt: now + 5 * 60_000,
      },
      lastActivityAt: new Date(now - 5_000),
      hibernateAfter: new Date(now + 10_000),
      sandboxExpiresAt: new Date(now + 5 * 60_000),
    };
  });

  test("returns active future sandbox state without a live reconnect probe", async () => {
    const { GET } = await routeModulePromise;

    sessionRecord.lifecycleState = "active";
    sessionRecord.lifecycleError = null;

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      hasSnapshot: boolean;
      expiresAt?: number;
      lifecycle: { state: string | null; sandboxExpiresAt: number | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("connected");
    expect(payload.hasSnapshot).toBe(false);
    expect(payload.lifecycle.state).toBe("active");
    expect(payload.lifecycle.sandboxExpiresAt).toBe(
      sessionRecord.sandboxExpiresAt?.getTime() ?? null,
    );
    expect(payload.expiresAt).toBe(sessionRecord.sandboxState.expiresAt);
    expect(connectCalls).toHaveLength(0);
    expect(probeCalls).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("does not reveal sandbox identity or probe the provider across ownership boundaries", async () => {
    const { GET } = await routeModulePromise;
    ownedSessionAllowed = false;

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );

    expect(response.status).toBe(403);
    expect(connectCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("recovers failed lifecycle state when reconnect succeeds", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      hasSnapshot: boolean;
      expiresAt?: number;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("connected");
    expect(payload.hasSnapshot).toBe(false);
    expect(payload.lifecycle.state).toBe("active");
    expect(typeof payload.expiresAt).toBe("number");
    expect(connectCalls).toHaveLength(1);
    expect(probeCalls).toBe(0);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("active");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
  });

  test("marks sandbox expired when the reconnect flow hits a 410", async () => {
    const { GET } = await routeModulePromise;

    probeResult = {
      success: false,
      stdout: "",
      stderr: "Status code 410 is not ok",
    };

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("expired");
    expect(payload.lifecycle.state).toBe("hibernated");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("hibernated");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
    expect(updateCalls[0]?.patch.sandboxState).toEqual({
      type: "vercel",
      sandboxName: "session_session-1",
    });
  });

  test("returns typed redacted evidence when the persisted sandbox is unavailable", async () => {
    const { GET } = await routeModulePromise;

    probeResult = {
      success: false,
      stdout: "",
      stderr: "Status code 410 is not ok provider_token=super-secret",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sandbox/reconnect?sessionId=session-1",
        { headers: { "x-request-id": "request-950" } },
      ),
    );
    const payload = (await response.json()) as {
      status: string;
      errorKind?: string;
      requestId?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("expired");
    expect(payload.errorKind).toBe("sandbox_unavailable");
    expect(payload.requestId).toBe("request-950");
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(consoleErrors.join("\n")).not.toContain("super-secret");
  });

  test("preserves runtime state with typed redacted evidence after a transient reconnect failure", async () => {
    const { GET } = await routeModulePromise;
    probeResult = {
      success: false,
      stdout: "",
      stderr: "temporary provider failure provider_token=super-secret",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sandbox/reconnect?sessionId=session-1",
        { headers: { "x-request-id": "request-950" } },
      ),
    );
    const payload = (await response.json()) as {
      status: string;
      requestId?: string;
      warningKind?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("connected");
    expect(payload.warningKind).toBe("sandbox_reconnect_transient");
    expect(payload.requestId).toBe("request-950");
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(consoleWarnings.join("\n")).not.toContain("super-secret");
    expect(updateCalls).toHaveLength(0);
  });

  test("drops a missing sandbox resume handle when the reconnect flow hits a 404", async () => {
    const { GET } = await routeModulePromise;

    sessionRecord.snapshotUrl = null;
    probeResult = {
      success: false,
      stdout: "",
      stderr: "Status code 404 is not ok",
    };

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      hasSnapshot: boolean;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("expired");
    expect(payload.hasSnapshot).toBe(false);
    expect(payload.lifecycle.state).toBe("hibernated");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("hibernated");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
    expect(updateCalls[0]?.patch.sandboxState).toEqual({
      type: "vercel",
    });
  });
});
