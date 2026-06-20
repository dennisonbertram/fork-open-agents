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

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/db/agents", () => ({
  listAgentsForUser: async () => [],
  deleteUserDefaultAgent: async () => undefined,
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
});
