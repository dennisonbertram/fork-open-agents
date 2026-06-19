import { beforeEach, describe, expect, mock, test } from "bun:test";

const request = mock(async () => ({
  data: {
    slug: "open-agents",
    permissions: { actions: "read", metadata: "read" },
  },
}));

const withScopedInstallationOctokit = mock(async () => undefined);

mock.module("@/lib/github/app", () => ({
  getAppOctokit: () => ({ request }),
  isGitHubAppConfigured: () => true,
  withScopedInstallationOctokit,
}));

const { getActionsManagerReadinessCheck } = await import("./readiness");

describe("getActionsManagerReadinessCheck", () => {
  beforeEach(() => {
    request.mockClear();
    withScopedInstallationOctokit.mockClear();
    request.mockImplementation(async () => ({
      data: {
        slug: "open-agents",
        permissions: { actions: "read", metadata: "read" },
      },
    }));
    withScopedInstallationOctokit.mockImplementation(async () => undefined);
  });

  test("requires the installation to grant effective actions read access", async () => {
    withScopedInstallationOctokit.mockImplementationOnce(async () => {
      throw Object.assign(new Error("Resource not accessible by integration"), {
        status: 403,
      });
    });

    const verdict = await getActionsManagerReadinessCheck({
      installationId: 123,
      repositoryId: 456,
    });

    expect(withScopedInstallationOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 123,
        repositoryId: 456,
        permissions: { actions: "read", metadata: "read" },
      }),
    );
    expect(verdict).toMatchObject({
      status: "action-needed",
      errorKind: "app_no_actions_permission",
      actionHref:
        "https://github.com/apps/open-agents/installations/new/permissions",
    });
  });

  test("returns ready only after app metadata and installation token probe pass", async () => {
    const verdict = await getActionsManagerReadinessCheck({
      installationId: 123,
      repositoryId: 456,
    });

    expect(verdict).toMatchObject({
      status: "ready",
      headline: "Connected — Actions read available",
    });
  });
});
