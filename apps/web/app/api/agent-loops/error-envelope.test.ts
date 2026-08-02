/**
 * Issue #1054 step 3 — the agent-loop error bodies that used to return only
 * `message` must also return `error` with the same human-readable string.
 * `message` stays populated so the migration is non-breaking on its own.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const isAgentLoopsEnabled = mock(() => true);
const getOwnedAgentLoop = mock(async () => ({ id: "loop-1" }));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
}));

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoop: mock(async () => ({ ok: false, errors: [] })),
  listAgentLoops: mock(async () => []),
  getOwnedAgentLoop,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  isAgentLoopRepoAllowed: mock(() => true),
}));

mock.module("@/lib/background-agents/store", () => ({
  createLoopTrigger: mock(async () => ({ id: "trigger-1" })),
  listTriggersForLoop: mock(async () => []),
}));

const loopsRoute = import("./route");
const triggersRoute = import("./[loopId]/triggers/route");

type ErrorBody = { error?: unknown; message?: unknown; errorKind?: unknown };

beforeEach(() => {
  isAgentLoopsEnabled.mockImplementation(() => true);
});

describe("agent-loop error bodies carry `error`", () => {
  test("POST /api/agent-loops feature-disabled 403 sets error === message", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { POST } = await loopsRoute;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: "{}",
      }),
    );
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(403);
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe(body.message);
    expect(body.errorKind).toBe("feature_disabled");
  });

  test("POST /api/agent-loops invalid body 400 sets error === message", async () => {
    const { POST } = await loopsRoute;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      }),
    );
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_request");
    expect(body.error).toBe(body.message);
    expect(String(body.error)).toContain("Invalid request body");
  });

  test("POST triggers invalid body 400 sets error === message and fields", async () => {
    const { POST } = await triggersRoute;

    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/triggers", {
        method: "POST",
        body: JSON.stringify({ kind: "not-a-kind" }),
      }),
      { params: Promise.resolve({ loopId: "loop-1" }) },
    );
    const body = (await response.json()) as ErrorBody & { fields?: unknown };

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("trigger_invalid");
    expect(body.error).toBe(body.message);
    expect(typeof body.fields).toBe("object");
  });
});
