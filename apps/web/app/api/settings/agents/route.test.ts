import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentRole } from "@/lib/agents/resolve-agent";

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const upsertCalls: Array<{
  userId: string;
  role: AgentRole;
  patch: Record<string, unknown>;
}> = [];

let storedAgent: {
  role: AgentRole;
  modelId: string | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  instructions: string | null;
  managedRuntimeProfileId: string | null;
  githubToolsEnabled: boolean;
  toolAuthoringEnabled: boolean;
} | null = null;
const deleteCalls: Array<{ userId: string; role: AgentRole }> = [];

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/db/agents", () => ({
  listAgentsForUser: async () => [],
  deleteUserDefaultAgent: async (userId: string, role: AgentRole) => {
    deleteCalls.push({ userId, role });
  },
  upsertUserDefaultAgent: async (
    userId: string,
    role: AgentRole,
    patch: Record<string, unknown>,
  ) => {
    upsertCalls.push({ userId, role, patch });
    storedAgent = {
      role,
      modelId: null,
      composioToolkitSlugs: [],
      composioProfileId: null,
      instructions: null,
      managedRuntimeProfileId: null,
      githubToolsEnabled: false,
      toolAuthoringEnabled: patch.toolAuthoringEnabled === true,
    };
  },
  getUserDefaultAgent: async () => storedAgent,
}));

const routeModulePromise = import("./route");

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/agents", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/settings/agents", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    upsertCalls.length = 0;
    storedAgent = null;
    deleteCalls.length = 0;
  });

  test("GET preserves the agents root and canonical legacy role/field shape", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["agents"]);
    const agents = body.agents as Array<Record<string, unknown>>;
    expect(agents.map((agent) => agent.role)).toEqual([
      "main",
      "explorer",
      "executor",
      "design",
    ]);
    expect(Object.keys(agents[0])).toEqual([
      "role",
      "modelId",
      "inferenceProfileId",
      "composioToolkitSlugs",
      "composioProfileId",
      "instructions",
      "managedRuntimeProfileId",
      "githubToolsEnabled",
      "toolAuthoringEnabled",
    ]);
  });

  test("PATCH toggles toolAuthoringEnabled for an agent", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest({ role: "main", toolAuthoringEnabled: true }),
    );
    const body = (await response.json()) as {
      agent: { role: AgentRole; toolAuthoringEnabled: boolean };
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toEqual([
      {
        userId: "user-1",
        role: "main",
        patch: { toolAuthoringEnabled: true },
      },
    ]);
    expect(body.agent.role).toBe("main");
    expect(body.agent.toolAuthoringEnabled).toBe(true);
  });

  test("DELETE preserves the role request and exact ok response", async () => {
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      new Request("http://localhost/api/settings/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "design" }),
      }),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteCalls).toEqual([{ userId: "user-1", role: "design" }]);
  });
});
