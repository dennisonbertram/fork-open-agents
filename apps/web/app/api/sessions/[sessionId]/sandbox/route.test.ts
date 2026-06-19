/**
 * Tests for POST /api/sessions/[sessionId]/sandbox
 * On-demand sandbox provisioning for sandbox-free (no-repo) sessions.
 *
 * BT-001: Sandbox-free session transitions to provisioning state.
 * BT-002: Already-sandboxed session is a safe no-op.
 * BT-003: Unauthenticated request returns 401.
 * BT-004: Non-owner request returns 403.
 * BT-005: Session not found returns 404.
 * BT-006: session.sandbox.attached event is emitted for new attach.
 * BT-007: Event is NOT emitted on a no-op (sandbox already present).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ─── Module-level mock state ─────────────────────────────────────────────────
type AuthUser = { user: { id: string } } | null;
type SessionRecord = {
  id: string;
  userId: string;
  sandboxState: { type: string } | null;
  lifecycleState: string | null;
  lifecycleVersion: number;
};

let authSession: AuthUser = { user: { id: "user-1" } };

let sessionRecord: SessionRecord | null = {
  id: "session-1",
  userId: "user-1",
  sandboxState: null,
  lifecycleState: null,
  lifecycleVersion: 0,
};

const updateSessionCalls: Array<{
  sessionId: string;
  update: Record<string, unknown>;
}> = [];

const emittedEvents: Array<Record<string, unknown>> = [];

// ─── Mocks ────────────────────────────────────────────────────────────────────
mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async (id: string) =>
    sessionRecord?.id === id ? sessionRecord : null,
  updateSession: async (sessionId: string, update: Record<string, unknown>) => {
    updateSessionCalls.push({ sessionId, update });
    if (!sessionRecord) return null;
    const next = { ...sessionRecord, ...update };
    return next;
  },
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async (input: Record<string, unknown>) => {
    emittedEvents.push(input);
    return { id: "evt-1", ...input };
  },
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (...args: unknown[]) => String(args),
}));

// ─── Import the route ─────────────────────────────────────────────────────────
const routeModulePromise = import("./route");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function postRequest(sessionId: string): Request {
  return new Request(`http://localhost/api/sessions/${sessionId}/sandbox`, {
    method: "POST",
  });
}

function routeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe("POST /api/sessions/[sessionId]/sandbox", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      sandboxState: null,
      lifecycleState: null,
      lifecycleVersion: 0,
    };
    updateSessionCalls.length = 0;
    emittedEvents.length = 0;
  });

  // BT-003: Auth check
  test("returns 401 when not authenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  // BT-005: Session not found
  test("returns 404 when session does not exist", async () => {
    sessionRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    expect(response.status).toBe(404);
  });

  // BT-004: Ownership check
  test("returns 403 when session belongs to a different user", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "other-user",
      sandboxState: null,
      lifecycleState: null,
      lifecycleVersion: 0,
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    expect(response.status).toBe(403);
  });

  // BT-001: Sandbox-free session transitions to provisioning
  test("sets sandboxState and lifecycleState to provisioning on a sandbox-free session", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    expect(response.status).toBe(200);

    // DB must have been updated with provisioning state
    expect(updateSessionCalls.length).toBe(1);
    expect(updateSessionCalls[0]).toMatchObject({
      sessionId: "session-1",
      update: {
        sandboxState: { type: "vercel" },
        lifecycleState: "provisioning",
      },
    });

    // Response body should reflect new state
    const body = (await response.json()) as {
      session: {
        sandboxState: { type: string } | null;
        lifecycleState: string | null;
      };
    };
    expect(body.session.sandboxState).toMatchObject({ type: "vercel" });
    expect(body.session.lifecycleState).toBe("provisioning");
  });

  // BT-006: Event emitted on new attach
  test("emits a session.sandbox.attached event with actor user", async () => {
    const { POST } = await routeModulePromise;

    await POST(postRequest("session-1"), routeParams("session-1"));

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      sessionId: "session-1",
      userId: "user-1",
      eventName: "session.sandbox.attached",
      source: "sandbox",
      actorType: "user",
      status: "info",
    });
  });

  // BT-002: Already-sandboxed session is a no-op
  test("no-ops and returns current state when sandbox is already present", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      sandboxState: { type: "vercel" },
      lifecycleState: "active",
      lifecycleVersion: 1,
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    expect(response.status).toBe(200);

    // DB must NOT have been updated
    expect(updateSessionCalls.length).toBe(0);

    // Response must reflect the existing (already-sandboxed) state
    const body = (await response.json()) as {
      session: {
        sandboxState: { type: string } | null;
        lifecycleState: string | null;
      };
    };
    expect(body.session.sandboxState).toMatchObject({ type: "vercel" });
    expect(body.session.lifecycleState).toBe("active");
  });

  // BT-007: No event emitted for no-op
  test("does NOT emit an event when sandbox is already present (no-op)", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      sandboxState: { type: "vercel" },
      lifecycleState: "active",
      lifecycleVersion: 1,
    };
    const { POST } = await routeModulePromise;

    await POST(postRequest("session-1"), routeParams("session-1"));

    expect(emittedEvents.length).toBe(0);
  });

  // ─── Regression tests ─────────────────────────────────────────────────────
  // REGRESSION-001: lifecycleVersion must be incremented on attach (not left at 0).
  // If this regresses, the lifecycle worker may not detect the new provisioning state.
  test("lifecycleVersion is incremented when sandbox is attached", async () => {
    const { POST } = await routeModulePromise;

    await POST(postRequest("session-1"), routeParams("session-1"));

    expect(updateSessionCalls[0]?.update).toMatchObject({
      lifecycleVersion: 1,
    });
  });

  // REGRESSION-002: Sandbox-free sessions must not silently skip the DB write.
  // If updateSession is never called, provisioning state is never set.
  test("updateSession is called exactly once for a sandbox-free session attach", async () => {
    const { POST } = await routeModulePromise;

    await POST(postRequest("session-1"), routeParams("session-1"));

    expect(updateSessionCalls.length).toBe(1);
    expect(updateSessionCalls[0]?.sessionId).toBe("session-1");
  });

  // REGRESSION-003: The response body must contain the updated session for the
  // client to optimistically reflect provisioning state without a reload.
  test("response body contains session with updated sandboxState after attach", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      postRequest("session-1"),
      routeParams("session-1"),
    );

    const body = (await response.json()) as {
      session?: Record<string, unknown>;
      error?: string;
    };

    // Must not be an error response
    expect(body.error).toBeUndefined();
    // Must include the session object with provisioning state
    expect(body.session).toBeDefined();
    expect(body.session?.sandboxState).toMatchObject({ type: "vercel" });
    expect(body.session?.lifecycleState).toBe("provisioning");
  });
});
