import { afterEach, describe, expect, test } from "bun:test";
import {
  TEST_AUTH_COOKIE,
  TEST_AUTH_USER_ID,
  clearTestAuthCookie,
  deleteTestAuthCookie,
  getTestAuthSessionFromCookieHeader,
  isTestAuthEnabled,
  setTestAuthCookie,
  shouldBypassGitHubReconnectForTestAuth,
} from "./test-auth";

const originalNodeEnv = process.env.NODE_ENV;
const originalTestAuth = process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
const originalVercelEnv = process.env.VERCEL_ENV;
const nodeEnvKey = "NODE_ENV" as keyof NodeJS.ProcessEnv;

function restoreEnv() {
  process.env[nodeEnvKey] = originalNodeEnv;
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
}

describe("isTestAuthEnabled", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("must-stay-green: allows development without the explicit flag", () => {
    process.env[nodeEnvKey] = "development";
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("must-stay-green: allows the explicit flag on a non-production Vercel env", () => {
    process.env[nodeEnvKey] = "production";
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "preview";

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("must-stay-green: allows the explicit flag when VERCEL_ENV is unset", () => {
    process.env[nodeEnvKey] = "test";
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("refuses when VERCEL_ENV is production even if the flag is set", () => {
    process.env[nodeEnvKey] = "development";
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(isTestAuthEnabled()).toBe(false);
  });

  test("stays off in test without the flag", () => {
    process.env[nodeEnvKey] = "test";
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(false);
  });
});

describe("getTestAuthSessionFromCookieHeader", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("returns the demo session when enabled and the cookie matches", () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    const session = getTestAuthSessionFromCookieHeader(
      `${TEST_AUTH_COOKIE}=${TEST_AUTH_USER_ID}`,
    );

    expect(session?.user.id).toBe(TEST_AUTH_USER_ID);
  });

  test("returns undefined on production even when the cookie and flag are present", () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(
      getTestAuthSessionFromCookieHeader(
        `${TEST_AUTH_COOKIE}=${TEST_AUTH_USER_ID}`,
      ),
    ).toBeUndefined();
  });
});

describe("test-auth cookie headers", () => {
  test("setTestAuthCookie writes a Path=/ HttpOnly cookie for the demo user", () => {
    const response = new Response(null);
    setTestAuthCookie(response);
    const header = response.headers.get("Set-Cookie");

    expect(header).toContain(`${TEST_AUTH_COOKIE}=${TEST_AUTH_USER_ID}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Max-Age=86400");
  });

  test("clearTestAuthCookie expires the same Path=/ cookie", () => {
    const response = new Response(null);
    clearTestAuthCookie(response);
    const header = response.headers.get("Set-Cookie");

    expect(header).toContain(`${TEST_AUTH_COOKIE}=`);
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=0");
  });

  test("deleteTestAuthCookie removes the cookie from a Next cookie store", () => {
    const deleted: Array<{ name: string; path: string }> = [];
    deleteTestAuthCookie({
      delete: (cookie) => {
        deleted.push(cookie);
      },
    });

    expect(deleted).toEqual([{ name: TEST_AUTH_COOKIE, path: "/" }]);
  });
});

describe("shouldBypassGitHubReconnectForTestAuth", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("bypasses only the demo user while test-auth is enabled", () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(shouldBypassGitHubReconnectForTestAuth(TEST_AUTH_USER_ID)).toBe(
      true,
    );
    expect(shouldBypassGitHubReconnectForTestAuth("user-1")).toBe(false);
  });

  test("does not bypass on production even for the demo user", () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(shouldBypassGitHubReconnectForTestAuth(TEST_AUTH_USER_ID)).toBe(
      false,
    );
  });
});
