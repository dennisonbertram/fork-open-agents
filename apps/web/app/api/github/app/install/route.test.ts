import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let authSession: {
  authProvider: "vercel";
  user: { id: string; email?: string };
} | null;
let hasLinkedGitHub = false;
let installations: Array<{ installationId: number }> = [];
let syncError: Error | null;

mock.module("server-only", () => ({}));

mock.module("arctic", () => ({
  generateState: () => "state-123",
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => (hasLinkedGitHub ? "ghu_test" : null),
}));

mock.module("@/lib/github/users", () => ({
  hasGitHubAccount: async () => hasLinkedGitHub,
  getGitHubUsername: async () => (hasLinkedGitHub ? "testuser" : null),
  getGitHubAccountId: async () => (hasLinkedGitHub ? "12345" : null),
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/github/sync", () => ({
  syncUserInstallations: async () => {
    if (syncError) {
      throw syncError;
    }

    return installations.length;
  },
  isGitHubInstallationsAuthError: (error: unknown) =>
    error instanceof Error && error.message.includes(" 401 "),
}));

const routeModulePromise = import("./route");

const originalEnv = {
  NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
  NODE_ENV: process.env.NODE_ENV,
};

function createRequest(url: string): NextRequest {
  const nextUrl = new URL(url);

  return {
    url,
    nextUrl,
    cookies: {
      get: () => undefined,
    },
  } as unknown as NextRequest;
}

describe("GET /api/github/app/install", () => {
  beforeEach(() => {
    authSession = {
      authProvider: "vercel",
      user: { id: "user-1", email: "person@vercel.com" },
    };
    hasLinkedGitHub = true;
    installations = [{ installationId: 1 }];
    syncError = null;

    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: "open-agents",
      NODE_ENV: "test",
    });
  });

  afterEach(() => {
    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: originalEnv.NEXT_PUBLIC_GITHUB_APP_SLUG,
      NODE_ENV: originalEnv.NODE_ENV,
    });
  });

  test("redirects to get-started and preserves next when github not linked", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "http://localhost/api/github/app/install?next=/settings/connections",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("next")).toBe("/settings/connections");
  });

  // Issue #781: the not_linked redirect to /get-started must carry
  // step=github so the GitHub step auto-opens on arrival.
  test("redirects to get-started with step=github when github not linked", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "http://localhost/api/github/app/install?next=/settings/connections",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("not_linked");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
  });

  // Issue #781: app_not_configured redirect targets /get-started (the
  // default `next` fallback) and must also carry step=github there.
  test("redirects to get-started with step=github when app is not configured", async () => {
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "";
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install"),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("app_not_configured");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
  });

  // Issue #829 (comment 3516151659): app_not_configured must reroute to
  // /get-started with next preserved even when next is a non-/get-started
  // target like /sessions, not bounce the user to bare /sessions with the
  // status silently dropped.
  test("redirects app_not_configured to get-started with next=/sessions preserved", async () => {
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "";
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("app_not_configured");
    expect(redirectUrl.searchParams.get("step")).toBe("github");
    expect(redirectUrl.searchParams.get("next")).toBe("/sessions");
  });

  test("redirects to github install when linked but no installations", async () => {
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).toBe("https://github.com");
    expect(redirectUrl.pathname).toContain("open-agents");
  });

  // Issue #783: a non-auth sync failure inside the zero-installations sync
  // attempt must surface as sync_failed instead of silently falling through
  // to the "no installations, go install" branch.
  test("redirects to sync_failed when syncUserInstallations throws a non-auth error", async () => {
    installations = [];
    syncError = new Error("GitHub API 500 Internal Server Error");
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("sync_failed");
  });

  // Issue #783: an unlinked user hitting target_id must be redirected to
  // not_linked before any github.com/apps/.../installations/new URL is built.
  test("redirects unlinked user to not_linked before building a target_id install URL", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "http://localhost/api/github/app/install?target_id=123&next=/settings/connections",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).not.toBe("https://github.com");
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("github")).toBe("not_linked");
  });
});
