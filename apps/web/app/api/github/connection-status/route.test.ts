import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
  };
} | null;

let authSession: AuthSession;
let hasLinkedGitHub = false;
let installations: Array<{ installationId: number }>;
let userToken: string | null;
let githubUsername: string | null;
let syncedInstallationsCount = 0;
let syncError: Error | null;
let syncErrorIsAuth = false;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => userToken,
}));

mock.module("@/lib/github/users", () => ({
  hasGitHubAccount: async () => hasLinkedGitHub,
  getGitHubUsername: async () => githubUsername,
  getGitHubAccountId: async () => null,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/github/sync", () => ({
  syncUserInstallations: async () => {
    if (syncError) {
      throw syncError;
    }

    return syncedInstallationsCount;
  },
  isGitHubInstallationsAuthError: () => syncErrorIsAuth,
}));

const routeModulePromise = import("./route");

const originalTestAuth = process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalTestAuthSecret = process.env.TEST_AUTH_SECRET;

function restoreTestAuthEnv() {
  if (originalTestAuth === undefined) {
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
  } else {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = originalTestAuth;
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
  if (originalTestAuthSecret === undefined) {
    delete process.env.TEST_AUTH_SECRET;
  } else {
    process.env.TEST_AUTH_SECRET = originalTestAuthSecret;
  }
}

describe("GET /api/github/connection-status", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    hasLinkedGitHub = true;
    installations = [{ installationId: 1 }];
    userToken = "ghu_user";
    githubUsername = "octocat";
    syncedInstallationsCount = 1;
    syncError = null;
    syncErrorIsAuth = false;
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;
    delete process.env.TEST_AUTH_SECRET;
  });

  afterEach(() => {
    restoreTestAuthEnv();
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Not authenticated",
      errorKind: "unauthorized",
    });
  });

  test("returns not_connected when no GitHub account is linked", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "not_connected",
      reason: null,
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("requires reconnect when no usable token is available", async () => {
    userToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });

  test("requires reconnect when live sync drops cached installations to zero", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "installations_missing",
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("stays connected when sync succeeds with installations", async () => {
    syncedInstallationsCount = 2;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
      hasInstallations: true,
      syncedInstallationsCount: 2,
    });
  });

  test("stays connected when the account has no installations yet", async () => {
    installations = [];
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("requires reconnect when GitHub rejects installation sync auth", async () => {
    syncError = new Error("GitHub auth failed");
    syncErrorIsAuth = true;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "sync_auth_failed",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });

  // Issue #783: an unknown (non-auth) thrown error must not be reported as
  // "connected" with a fabricated syncedInstallationsCount — it must return
  // a degraded status instead.
  test("stays connected for the test-auth user even when the token is missing", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.TEST_AUTH_SECRET = "test-secret";
    authSession = { user: { id: "dev-managed-runtime-user" } };
    userToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
      hasInstallations: true,
      syncedInstallationsCount: 0,
    });
  });

  test("still requires reconnect for a normal user when the token is missing", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    userToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });

  test("does not bypass reconnect for the demo user on production", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";
    authSession = { user: { id: "dev-managed-runtime-user" } };
    userToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });

  test("returns a degraded status when sync throws an unknown non-auth error", async () => {
    syncError = new Error("Unexpected GitHub API failure");
    syncErrorIsAuth = false;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).not.toBe("connected");
    expect(body.syncedInstallationsCount).not.toBe(installations.length);
  });
});
