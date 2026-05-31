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
const readiness = {
  enabled: false,
  ready: false,
  missing: ["BACKGROUND_AGENTS_ENABLED"],
  checks: [
    {
      id: "feature_flag",
      label: "Feature flag",
      status: "disabled",
      detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
      missing: ["BACKGROUND_AGENTS_ENABLED"],
    },
  ],
};
const getBackgroundAgentReadinessWithGitHubAppMetadata = mock(
  async () => readiness,
);
const getBackgroundAgentRepoReadiness = mock(async () => ({
  ready: true,
  repoOwner: "acme",
  repoName: "widgets",
  requiredUserPermission: "write",
  reason: null,
  message: "GitHub user access and GitHub App installation cover this repo.",
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "main",
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/readiness", () => ({
  getBackgroundAgentReadinessWithGitHubAppMetadata,
}));

mock.module("@/lib/background-agents/repo-readiness", () => ({
  getBackgroundAgentRepoReadiness,
}));

const routeModulePromise = import("./route");

describe("GET /api/background-agents/readiness", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    getBackgroundAgentReadinessWithGitHubAppMetadata.mockClear();
    getBackgroundAgentRepoReadiness.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(
      getBackgroundAgentReadinessWithGitHubAppMetadata,
    ).not.toHaveBeenCalled();
  });

  test("returns background agent readiness without secrets", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(readiness);
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(
      getBackgroundAgentReadinessWithGitHubAppMetadata,
    ).toHaveBeenCalledTimes(1);
    expect(getBackgroundAgentRepoReadiness).not.toHaveBeenCalled();
  });

  test("returns repo-specific GitHub App readiness when requested", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/readiness?repoOwner=acme&repoName=widgets&permission=write",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      enabled: false,
      repoAccess: {
        ready: true,
        repoOwner: "acme",
        repoName: "widgets",
        requiredUserPermission: "write",
        installationId: 123,
      },
    });
    expect(getBackgroundAgentRepoReadiness).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
    });
  });

  test("validates paired repo query params", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/readiness?repoOwner=acme",
      ),
    );

    expect(response.status).toBe(400);
    expect(getBackgroundAgentRepoReadiness).not.toHaveBeenCalled();
  });
});
