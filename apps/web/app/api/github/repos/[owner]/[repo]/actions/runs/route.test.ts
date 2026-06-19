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
let repoAccess:
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      userPermission: "read" | "write";
    }
  | { ok: false; reason: "no_installation" | "app_no_access" } = {
  ok: true,
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "develop",
  userPermission: "write",
};

const listWorkflowRuns = mock(async () => ({
  totalCount: 1,
  runs: [
    {
      id: 42,
      runNumber: 7,
      name: "CI",
      status: "completed",
      conclusion: "success",
      branch: "develop",
      event: "push",
      actor: "octocat",
      createdAt: "2026-06-19T10:00:00Z",
      updatedAt: "2026-06-19T10:05:00Z",
      htmlUrl: "https://github.com/acme/widgets/actions/runs/42",
      display: {
        label: "Succeeded",
        tone: "success",
        className: "bg-emerald-500",
      },
    },
  ],
}));

const withScopedInstallationOctokit = mock(
  async (params: { operation: (octokit: unknown) => Promise<unknown> }) =>
    params.operation({ rest: { actions: {} } }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => repoAccess,
}));

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit,
}));

mock.module("@/lib/github/actions-manager/readiness", () => ({
  getActionsManagerReadinessCheck: async () =>
    readinessIsReady
      ? {
          status: "ready",
          headline: "Connected — Actions read available",
          subtext: "GitHub App can read workflow runs.",
        }
      : {
          status: "action-needed",
          headline: "Re-authorize the GitHub App to view Actions",
          subtext: "The GitHub App is missing Actions read permission.",
          errorKind: "app_no_actions_permission",
        },
}));

mock.module("@/lib/github/actions-manager/runs", () => ({
  listWorkflowRuns,
}));

let readinessIsReady = true;
let routeModulePromise = import("./route");

function createRequest(path = "/api/github/repos/acme/widgets/actions/runs") {
  return new Request(`http://localhost${path}`);
}

function routeContext() {
  return { params: Promise.resolve({ owner: "acme", repo: "widgets" }) };
}

describe("GET /api/github/repos/[owner]/[repo]/actions/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    repoAccess = {
      ok: true,
      installationId: 123,
      repositoryId: 456,
      defaultBranch: "develop",
      userPermission: "write",
    };
    readinessIsReady = true;
    listWorkflowRuns.mockClear();
    withScopedInstallationOctokit.mockClear();
    routeModulePromise = import("./route");
  });

  test("requires authentication before repo or GitHub calls", async () => {
    authResult = {
      ok: false,
      response: Response.json(
        { error: "Not authenticated", errorKind: "unauthenticated" },
        { status: 401 },
      ),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(listWorkflowRuns).not.toHaveBeenCalled();
    expect(withScopedInstallationOctokit).not.toHaveBeenCalled();
  });

  test("suppresses run listing when the GitHub App lacks actions read", async () => {
    readinessIsReady = false;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      errorKind: "app_no_actions_permission",
    });
    expect(listWorkflowRuns).not.toHaveBeenCalled();
  });

  test("lists runs through a scoped installation token with actions read", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "/api/github/repos/acme/widgets/actions/runs?branch=develop&status=success&per_page=200",
      ),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(withScopedInstallationOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 123,
        repositoryId: 456,
        permissions: { actions: "read", metadata: "read" },
      }),
    );
    expect(listWorkflowRuns).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      {
        branch: "develop",
        event: undefined,
        status: "success",
        perPage: 100,
      },
    );
    expect(body.runs[0]).toMatchObject({
      id: 42,
      display: { label: "Succeeded" },
    });
  });

  test("maps GitHub rate-limit signals to github_rate_limited", async () => {
    listWorkflowRuns.mockImplementationOnce(async () => {
      throw Object.assign(new Error("rate limit exceeded"), { status: 429 });
    });
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ errorKind: "github_rate_limited" });
  });
});
