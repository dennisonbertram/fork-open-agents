import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let authResult:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };
let repoAccess:
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      userPermission: "read" | "write";
    }
  | { ok: false; reason: "no_installation" } = {
  ok: true,
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "develop",
  userPermission: "read",
};

const proxyJobLogs = mock(async () => ({
  text: "1s Build started\n2s Build passed\n",
  bytes: 32,
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
  getActionsManagerReadinessCheck: async () => ({
    status: "ready",
    headline: "Connected — Actions read available",
  }),
}));

mock.module("@/lib/github/actions-manager/logs", () => ({
  proxyJobLogs,
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({ owner: "acme", repo: "widgets", jobId: "987" }),
  };
}

describe("GET /api/github/repos/[owner]/[repo]/actions/jobs/[jobId]/logs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    repoAccess = {
      ok: true,
      installationId: 123,
      repositoryId: 456,
      defaultBranch: "develop",
      userPermission: "read",
    };
    proxyJobLogs.mockClear();
    withScopedInstallationOctokit.mockClear();
  });

  test("returns raw log text and never exposes a signed redirect location", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/jobs/987/logs",
      ),
      routeContext(),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("location")).toBeNull();
    expect(text).toBe("1s Build started\n2s Build passed\n");
    expect(text).not.toContain("pipelines.actions.githubusercontent.com");
    expect(proxyJobLogs).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      987,
    );
  });
});
