import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const createBackgroundAgent = mock(async () => ({
  id: "agent-1",
  name: "Smoke runner",
  status: "disabled",
}));
const listBackgroundAgents = mock(async () => []);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  createBackgroundAgent,
  listBackgroundAgents,
}));

const routeModulePromise = import("./route");

function validCronPayload(scheduleOverride?: string) {
  return {
    name: "Smoke runner",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Run smoke checks after deployments.",
    triggers: [
      {
        name: "Daily cron",
        kind: "schedule.cron",
        schedule: scheduleOverride ?? "@hourly",
      },
    ],
  };
}

describe("POST /api/background-agents", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createBackgroundAgent.mockClear();
    createBackgroundAgent.mockImplementation(async () => ({
      id: "agent-1",
      name: "Smoke runner",
      status: "disabled",
    }));
    listBackgroundAgents.mockClear();
    listBackgroundAgents.mockImplementation(async () => []);
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        body: JSON.stringify(validCronPayload()),
      }),
    );

    expect(response.status).toBe(401);
    expect(createBackgroundAgent).not.toHaveBeenCalled();
  });

  test("returns 201 for a valid @hourly schedule.cron agent", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCronPayload("@hourly")),
      }),
    );

    expect(response.status).toBe(201);
    expect(createBackgroundAgent).toHaveBeenCalledTimes(1);
  });

  test("returns 201 for a valid 5-field cron expression", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCronPayload("0 9 * * 1")),
      }),
    );

    expect(response.status).toBe(201);
  });

  test("returns 400 with field-level details for an invalid cron expression", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCronPayload("not-a-valid-cron")),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    // Must include field-level details — not just a generic message
    expect(body.details).toBeDefined();
    expect(createBackgroundAgent).not.toHaveBeenCalled();
  });

  test("returns 400 with details naming 'name' for an empty name", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCronPayload(), name: "" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details).toBeDefined();
    // fieldErrors should have an entry for 'name'
    const fieldErrors = body.details?.fieldErrors ?? {};
    expect(Object.keys(fieldErrors)).toContain("name");
    expect(createBackgroundAgent).not.toHaveBeenCalled();
  });

  test("returns 201 for a github.pull_request trigger without a schedule", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "PR reviewer",
          repoOwner: "acme",
          repoName: "widgets",
          instructions: "Review PRs.",
          triggers: [
            {
              name: "Pull request",
              kind: "github.pull_request",
              conditions: { actions: ["opened"] },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
  });

  test("GET returns agents list", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agents).toEqual([]);
  });
});
