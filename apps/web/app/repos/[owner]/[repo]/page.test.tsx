import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let userId: string | null = "user-1";
let accessAllowed = true;
let accessThrows = false;
const callOrder: string[] = [];
const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const notFound = mock(() => {
  throw new Error("notFound");
});
const verifyRepoAccess = mock(async () => {
  callOrder.push("access");
  if (accessThrows) throw new Error("GitHub unavailable");
  return accessAllowed
    ? {
        ok: true as const,
        installationId: 1,
        repositoryId: 2,
        defaultBranch: "main",
        userPermission: "write" as const,
      }
    : { ok: false as const, reason: "user_no_access" as const };
});
const loadRepositoryDashboardSummary = mock(async () => {
  callOrder.push("summary");
  return {
    automations: { status: "ready" as const, count: 2 },
    runs: { status: "ready" as const, count: 1 },
  };
});

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => {
    callOrder.push("auth");
    return userId ? { user: { id: userId } } : null;
  },
}));
mock.module("@/lib/github/access", () => ({ verifyRepoAccess }));
mock.module("./repository-dashboard-summary", () => ({
  loadRepositoryDashboardSummary,
}));
mock.module("./repository-dashboard-view", () => ({
  RepositoryDashboardView: ({
    owner,
    repo,
  }: {
    owner: string;
    repo: string;
  }) => (
    <div>
      {owner}/{repo} dashboard
    </div>
  ),
  RepositoryDashboardAccessError: () => (
    <div role="alert">Repository access could not be verified</div>
  ),
}));

// Old dashboard dependencies remain mocked so this RED test can characterize
// the current page before the reduced page stops importing them.
mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents: async () => [],
  listBackgroundAgentRuns: async () => [],
}));
mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async () => ({
    prSummary: { ok: true, prs: [] },
    issueSummary: { ok: true, totalOpen: 0, recent: [] },
    actionsSummary: { ok: true, latestStatus: "passing", recentRuns: [] },
  }),
}));
mock.module("@/lib/composio/repo-tools-page-data", () => ({
  getRepoToolsEffectiveStatuses: async () => [],
}));

const pageModulePromise = import("./page");

describe("RepoDashboardPage ownership", () => {
  beforeEach(() => {
    userId = "user-1";
    accessAllowed = true;
    accessThrows = false;
    callOrder.length = 0;
    redirect.mockClear();
    notFound.mockClear();
    verifyRepoAccess.mockClear();
    loadRepositoryDashboardSummary.mockClear();
  });

  test("authenticates, proves repository access, then loads summaries", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(callOrder).toEqual(["auth", "access", "summary"]);
    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "read",
    });
    expect(loadRepositoryDashboardSummary).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });
    expect(html).toContain("acme/widgets dashboard");
  });

  test("redirects signed-out users before access or summary reads", async () => {
    userId = null;
    const { default: RepoDashboardPage } = await pageModulePromise;

    await expect(
      RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect");
    expect(callOrder).toEqual(["auth"]);
  });

  test("fails closed before summary reads for an inaccessible repository", async () => {
    accessAllowed = false;
    const { default: RepoDashboardPage } = await pageModulePromise;

    await expect(
      RepoDashboardPage({
        params: Promise.resolve({ owner: "private", repo: "secret" }),
      }),
    ).rejects.toThrow("notFound");
    expect(callOrder).toEqual(["auth", "access"]);
    expect(loadRepositoryDashboardSummary).not.toHaveBeenCalled();
  });

  test("renders a deliberate safe error when repository verification is unavailable", async () => {
    accessThrows = true;
    const { default: RepoDashboardPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(callOrder).toEqual(["auth", "access"]);
    expect(loadRepositoryDashboardSummary).not.toHaveBeenCalled();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Repository access could not be verified");
  });
});
