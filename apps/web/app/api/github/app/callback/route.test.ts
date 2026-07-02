import { beforeEach, describe, expect, mock, test } from "bun:test";

let authSession: { user: { id: string } } | null;
let cookieValues: Record<string, string>;
let githubToken: string | null;
let githubUsername: string | null;
let syncedInstallationsCount = 0;
let syncInstallationsError: Error | null;
let syncCallCount = 0;

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues[name];
      return value ? { value } : undefined;
    },
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => githubToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUsername: async () => githubUsername,
  getGitHubAccountId: async () => null,
}));

mock.module("@/lib/github/sync", () => ({
  syncUserInstallations: async () => {
    syncCallCount += 1;
    if (syncInstallationsError) {
      throw syncInstallationsError;
    }

    return syncedInstallationsCount;
  },
}));

const routeModulePromise = import("./route");

function getRedirectUrl(response: Response): URL {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location as string);
}

function expectCookiesCleared(response: Response): void {
  const setCookies = response.headers.getSetCookie();
  const names = [
    "github_app_install_redirect_to",
    "github_app_install_state",
    "github_reconnect",
  ];
  for (const name of names) {
    const header = setCookies.find((entry) => entry.startsWith(`${name}=`));
    expect(header).toBeTruthy();
    expect(header).toContain("Expires=Thu, 01 Jan 1970");
  }
}

describe("GET /api/github/app/callback", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-match-1",
    };
    githubToken = "ghu_test";
    githubUsername = "octocat";
    syncedInstallationsCount = 1;
    syncInstallationsError = null;
    syncCallCount = 0;
  });

  // Issue #829 (comment 3516151659): no_action is a non-success status, so it
  // now always reroutes to /get-started (carrying the original redirect
  // target in `next`) instead of landing on the original non-/get-started
  // target where the status would be silently dropped.
  test("returns no_action and reroutes to get-started with next preserved", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("no_action");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBe("1");
    expect(redirectUrl.searchParams.get("next")).toBe("/settings/connections");
  });

  test("returns pending_sync when github reports an installation but sync is still empty", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("pending_sync");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBeNull();
  });

  test("returns app_installed only after at least one installation syncs", async () => {
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("app_installed");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBeNull();
  });

  // Issue #781: when the resolved redirect target is /get-started, the
  // redirect must carry step=github so the GitHub step auto-opens.
  test("carries step=github when resolved redirect target is /get-started", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/get-started",
      github_app_install_state: "state-match-1",
    };
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("app_installed");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
  });

  // Non-/get-started targets (e.g. settings) must not gain a step param —
  // only the first-run /get-started landing page uses it.
  test("does not add step=github when redirect target is not /get-started", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-match-1",
    };
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/settings/connections");
    expect(redirectUrl.searchParams.get("step")).toBeNull();
  });

  // Issue #829 (comment 3516151659): a non-success status returning to a
  // bare /sessions redirect target must reroute to /get-started with the
  // status + next preserved, instead of landing on /sessions where the
  // onboarding gate silently drops the query params.
  test("reroutes no_action to get-started with next=/sessions preserved", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/sessions",
      github_app_install_state: "state-match-1",
    };
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("no_action");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBe("1");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
    expect(redirectUrl.searchParams.get("next")).toBe("/sessions");
  });

  test("app_installed (success) keeps redirecting to the /sessions next target", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/sessions",
      github_app_install_state: "state-match-1",
    };
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/sessions");
    expect(redirectUrl.searchParams.get("github")).toBe("app_installed");
  });

  test("not_linked redirect also carries step=github for /get-started target", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/get-started",
      github_app_install_state: "state-match-1",
    };
    githubToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("not_linked");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
  });

  test("returns invalid_state and skips sync when the install-state cookie is missing", async () => {
    cookieValues = { github_app_install_redirect_to: "/settings/connections" };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=abc123&installation_id=123",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("invalid_state");
    expect(syncCallCount).toBe(0);
  });

  test("returns invalid_state and skips sync when the state param does not match the cookie", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-a",
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-b&installation_id=123",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("invalid_state");
    expect(syncCallCount).toBe(0);
  });

  test("returns invalid_state when the callback omits the state param entirely but a cookie exists", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-a",
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("invalid_state");
    expect(syncCallCount).toBe(0);
  });

  test("proceeds normally when state matches the cookie", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-match-1",
    };
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("app_installed");
    expect(syncCallCount).toBe(1);
  });

  test("clears all three install cookies on the invalid_state early return", async () => {
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
      github_app_install_state: "state-a",
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-b&installation_id=123",
      ),
    );

    expectCookiesCleared(response);
  });

  // Issue #783: a non-auth sync failure must not be swallowed into
  // no_action/pending_sync — it must surface as its own status.
  test("returns sync_failed when syncUserInstallations throws a non-auth error", async () => {
    syncInstallationsError = new Error("GitHub API 500 Internal Server Error");
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("sync_failed");
  });

  // Issue #783: an auth-classified sync failure keeps the existing reconnect
  // vocabulary instead of sync_failed.
  test("keeps reconnect vocabulary when syncUserInstallations throws an auth error", async () => {
    syncInstallationsError = new Error("Bad credentials 401 ");
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123&state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).not.toBe("sync_failed");
  });
});
