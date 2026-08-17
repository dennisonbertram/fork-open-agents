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

const recordDataLoad = () => {
  callOrder.push("data");
};

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => {
    callOrder.push("auth");
    return userId ? { user: { id: userId } } : null;
  },
}));
mock.module("@/lib/github/access", () => ({ verifyRepoAccess }));
mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async () => {
    recordDataLoad();
    return {};
  },
}));
mock.module("@/lib/db/repository-settings", () => ({
  getRepositorySettings: async () => {
    recordDataLoad();
    return null;
  },
}));
mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => {
    recordDataLoad();
    return null;
  },
}));
mock.module("@/lib/github/users", () => ({
  hasGitHubAccount: async () => {
    recordDataLoad();
    return true;
  },
}));
mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => {
    recordDataLoad();
    return "token";
  },
}));
mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => {
    recordDataLoad();
    return [];
  },
}));
mock.module("@/lib/composio/repo-tools-page-data", () => ({
  getRepoToolsEffectiveStatuses: async () => {
    recordDataLoad();
    return [];
  },
}));
mock.module("@/components/ui/settings-section", () => ({
  SettingsPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
mock.module("./repo-settings-section", () => ({
  RepoSettingsSection: ({ owner, repo }: { owner: string; repo: string }) => (
    <div>
      {owner}/{repo} settings
    </div>
  ),
}));
mock.module("@/app/repos/[owner]/[repo]/repository-dashboard-view", () => ({
  RepositoryDashboardAccessError: () => (
    <div role="alert">Repository access could not be verified</div>
  ),
}));

const pageModulePromise = import("./page");

describe("RepoSettingsPage access control", () => {
  beforeEach(() => {
    userId = "user-1";
    accessAllowed = true;
    accessThrows = false;
    callOrder.length = 0;
    redirect.mockClear();
    notFound.mockClear();
    verifyRepoAccess.mockClear();
  });

  test("verifies read access, then loads per-repo settings", async () => {
    const { default: RepoSettingsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoSettingsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(callOrder[0]).toBe("auth");
    expect(callOrder[1]).toBe("access");
    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "read",
    });
    expect(callOrder).toContain("data");
    expect(html).toContain("acme/widgets");
  });

  test("redirects signed-out users to / before access or settings reads", async () => {
    userId = null;
    const { default: RepoSettingsPage } = await pageModulePromise;

    await expect(
      RepoSettingsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/");
    expect(callOrder).toEqual(["auth"]);
  });

  test("fails closed with notFound for an inaccessible repository", async () => {
    accessAllowed = false;
    const { default: RepoSettingsPage } = await pageModulePromise;

    await expect(
      RepoSettingsPage({
        params: Promise.resolve({ owner: "torvalds", repo: "linux" }),
      }),
    ).rejects.toThrow("notFound");
    expect(callOrder).toEqual(["auth", "access"]);
  });

  test("renders a deliberate safe error when repository verification is unavailable", async () => {
    accessThrows = true;
    const { default: RepoSettingsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoSettingsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(callOrder).toEqual(["auth", "access"]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Repository access could not be verified");
  });
});
