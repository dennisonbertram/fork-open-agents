import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedAgent: Record<string, unknown> | null = {
  id: "agent-1",
  userId: "user-1",
  name: "Manual test agent",
  repoOwner: "acme",
  repoName: "widgets",
  triggers: [{ id: "trigger-1", kind: "github.pull_request" }],
};
const getOwnedBackgroundAgentWithTriggers = mock(async () => ownedAgent);
const dispatchManualBackgroundAgentTest = mock(async () => ({
  enabled: true,
  matched: 1,
  created: 1,
  duplicates: 0,
  runIds: ["run-1"],
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentWithTriggers,
}));

mock.module("@/lib/background-agents/dispatcher", () => ({
  dispatchManualBackgroundAgentTest,
}));

const routeModulePromise = import("./route");

function context(agentId = "agent-1") {
  return {
    params: Promise.resolve({ agentId }),
  };
}

describe("POST /api/background-agents/[agentId]/test", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedAgent = {
      id: "agent-1",
      userId: "user-1",
      name: "Manual test agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggers: [{ id: "trigger-1", kind: "github.pull_request" }],
    };
    getOwnedBackgroundAgentWithTriggers.mockClear();
    dispatchManualBackgroundAgentTest.mockClear();
    dispatchManualBackgroundAgentTest.mockImplementation(async () => ({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    }));
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
      }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(dispatchManualBackgroundAgentTest).not.toHaveBeenCalled();
  });

  test("returns not found for agents outside the user scope", async () => {
    ownedAgent = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
      }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(getOwnedBackgroundAgentWithTriggers).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "agent-1",
    });
    expect(dispatchManualBackgroundAgentTest).not.toHaveBeenCalled();
  });

  test("dispatches a manual test run for the owned agent", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
        headers: { "x-request-id": "req-1" },
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runIds).toEqual(["run-1"]);
    expect(dispatchManualBackgroundAgentTest).toHaveBeenCalledWith({
      agent: ownedAgent,
      requestId: "req-1",
    });
  });

  test("reports disabled background agents without creating a run", async () => {
    dispatchManualBackgroundAgentTest.mockImplementationOnce(async () => ({
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Background agents are disabled");
  });

  // #743: manual-test guard — the API must surface WHY nothing ran when the
  // agent itself is disabled (not just when the rollout flag is off).
  test("surfaces the skip reason when the agent is disabled", async () => {
    dispatchManualBackgroundAgentTest.mockImplementationOnce(async () => ({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "agent_disabled",
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipReason).toBe("agent_disabled");
  });

  // #861: pins the pass-through for the repo-allowlist skip reason so the
  // bare Response.json(result) in the success branch can never regress.
  test("surfaces the skip reason when the repo is not allowlisted", async () => {
    dispatchManualBackgroundAgentTest.mockImplementationOnce(async () => ({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "repo_not_allowlisted",
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/agent-1/test", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.skipReason).toBe("repo_not_allowlisted");
  });
});
