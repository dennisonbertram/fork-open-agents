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
let runs: Record<string, unknown>[] = [
  {
    id: "run-1",
    status: "running",
    source: "github",
    triggerKind: "github.pull_request",
    repoOwner: "acme",
    repoName: "widgets",
  },
];

const listBackgroundAgentRuns = mock(async () => runs);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  listBackgroundAgentRuns,
}));

const routeModulePromise = import("./route");

describe("GET /api/background-agent-runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    runs = [
      {
        id: "run-1",
        status: "running",
        source: "github",
        triggerKind: "github.pull_request",
        repoOwner: "acme",
        repoName: "widgets",
      },
    ];
    listBackgroundAgentRuns.mockClear();
    listBackgroundAgentRuns.mockImplementation(async () => runs);
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs"),
    );

    expect(response.status).toBe(401);
    expect(listBackgroundAgentRuns).not.toHaveBeenCalled();
  });

  test("lists owned runs with optional repo filters and a clamped limit", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agent-runs?repoOwner=acme&repoName=widgets&limit=500",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ runs });
    expect(listBackgroundAgentRuns).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      limit: 200,
    });
  });

  test("defaults invalid limits for global run history", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs?limit=abc"),
    );

    expect(response.status).toBe(200);
    expect(listBackgroundAgentRuns).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: undefined,
      repoName: undefined,
      limit: 50,
    });
  });
});
