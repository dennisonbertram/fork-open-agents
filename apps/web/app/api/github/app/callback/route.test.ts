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

  test("returns no_action when the user exits before selecting an installation", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?state=state-match-1",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/settings/connections");
    expect(redirectUrl.searchParams.get("github")).toBe("no_action");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBe("1");
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
});
