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
type UpdatedAgent = {
  id: string;
  name: string;
  status: "enabled" | "disabled";
};
const updateBackgroundAgent = mock(
  async (): Promise<UpdatedAgent | null> => ({
    id: "agent-1",
    name: "Deploy smoke",
    status: "disabled",
  }),
);
const deleteBackgroundAgent = mock(async () => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  updateBackgroundAgent,
  deleteBackgroundAgent,
  getOwnedBackgroundAgentWithTriggers: mock(async () => null),
  listBackgroundAgentRuns: mock(async () => []),
}));

const routeModulePromise = import("./route");

function context(agentId = "agent-1") {
  return {
    params: Promise.resolve({ agentId }),
  };
}

describe("/api/background-agents/[agentId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    updateBackgroundAgent.mockClear();
    deleteBackgroundAgent.mockClear();
    updateBackgroundAgent.mockImplementation(async () => ({
      id: "agent-1",
      name: "Deploy smoke",
      status: "disabled",
    }));
    deleteBackgroundAgent.mockImplementation(async () => true);
  });

  test("PATCH requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/background-agents/agent-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "disabled" }),
      }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(updateBackgroundAgent).not.toHaveBeenCalled();
  });

  test("PATCH validates and scopes agent updates to the authenticated user", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/background-agents/agent-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Deploy smoke",
          status: "disabled",
          repoOwner: "acme",
          repoName: "widgets",
          instructions: "Run smoke checks after deployments.",
          outputMode: "ready_pr",
          checkCommand: "bun --bun run ci",
          permissions: {
            github: {
              contents: "write",
              pullRequests: "write",
              checks: "read",
            },
          },
          triggers: [
            {
              name: "Deployment status",
              kind: "github.deployment_status",
              status: "enabled",
              conditions: {
                environments: ["production"],
              },
              schedule: null,
            },
          ],
        }),
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent).toMatchObject({
      id: "agent-1",
      status: "disabled",
    });
    expect(updateBackgroundAgent).toHaveBeenCalledWith(
      "user-1",
      "agent-1",
      expect.objectContaining({
        status: "disabled",
        outputMode: "ready_pr",
        triggers: [
          expect.objectContaining({
            kind: "github.deployment_status",
            conditions: {
              environments: ["production"],
            },
          }),
        ],
      }),
    );
  });

  test("PATCH returns not found for agents outside the user scope", async () => {
    updateBackgroundAgent.mockImplementationOnce(async () => null);
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/background-agents/agent-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "disabled" }),
      }),
      context(),
    );

    expect(response.status).toBe(404);
  });

  test("DELETE scopes removal to the authenticated user", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/background-agents/agent-1", {
        method: "DELETE",
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(deleteBackgroundAgent).toHaveBeenCalledWith("user-1", "agent-1");
  });

  test("DELETE returns not found for agents outside the user scope", async () => {
    deleteBackgroundAgent.mockImplementationOnce(async () => false);
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/background-agents/agent-1", {
        method: "DELETE",
      }),
      context(),
    );

    expect(response.status).toBe(404);
  });
});
