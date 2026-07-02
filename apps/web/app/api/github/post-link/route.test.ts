import { beforeEach, describe, expect, mock, test } from "bun:test";

let authSession: { user: { id: string } } | null;
let githubToken: string | null;
let githubUsername: string | null;
let syncedInstallationsCount: number;
let existingInstallations: Array<{ installationId: number }>;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => githubToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUsername: async () => githubUsername,
}));

mock.module("@/lib/github/sync", () => ({
  syncUserInstallations: async () => syncedInstallationsCount,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => existingInstallations,
}));

const routeModulePromise = import("./route");

function getRedirectUrl(response: Response): URL {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location as string);
}

describe("GET /api/github/post-link", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    githubToken = "ghu_test";
    githubUsername = "octocat";
    syncedInstallationsCount = 1;
    existingInstallations = [];
  });

  // Issue #829 (comment 3516151659): link_failed returning to a bare
  // /sessions next target must reroute to /get-started with the status +
  // next preserved, not drop the status on the /sessions gate.
  test("routes link_failed to get-started with status and next preserved when next is /sessions", async () => {
    githubToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/github/post-link?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("link_failed");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
    expect(redirectUrl.searchParams.get("next")).toBe("/sessions");
  });

  test("account_connected keeps redirecting to the sanitized next target", async () => {
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/github/post-link?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/sessions");
    expect(redirectUrl.searchParams.get("github")).toBe("account_connected");
  });

  test("account_connected from existing installations also targets the sanitized next", async () => {
    syncedInstallationsCount = 0;
    existingInstallations = [{ installationId: 42 }];
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/github/post-link?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/sessions");
    expect(redirectUrl.searchParams.get("github")).toBe("account_connected");
  });

  test("bounces to the install route when no installations exist at all", async () => {
    syncedInstallationsCount = 0;
    existingInstallations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/github/post-link?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/api/github/app/install");
    expect(redirectUrl.searchParams.get("next")).toBe("/sessions");
  });
});
