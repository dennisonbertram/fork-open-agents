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

const TEST_SECRET = "test-secret";
const TEST_AUTH_COOKIE_VALUE = `test-auth:${TEST_SECRET}`;

const originalNodeEnv = process.env.NODE_ENV;
const originalTestAuth = process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalTestAuthSecret = process.env.TEST_AUTH_SECRET;
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
  if (originalTestAuthSecret === undefined) {
    delete process.env.TEST_AUTH_SECRET;
  } else {
    process.env.TEST_AUTH_SECRET = originalTestAuthSecret;
  }
}

describe("isTestAuthEnabled", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("must-stay-green: allows development without the explicit flag", () => {
    process.env[nodeEnvKey] = "development";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("must-stay-green: allows the explicit flag on a non-production Vercel env", () => {
    process.env[nodeEnvKey] = "test";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "preview";

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("must-stay-green: allows the explicit flag when VERCEL_ENV is unset", () => {
    process.env[nodeEnvKey] = "test";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(true);
  });

  test("refuses when VERCEL_ENV is production even if the flag and secret are set", () => {
    process.env[nodeEnvKey] = "development";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(isTestAuthEnabled()).toBe(false);
  });

  // Regression (#1398): non-Vercel production hosts (Docker/Railway/etc.)
  // never set VERCEL_ENV, so the guard must also refuse on NODE_ENV alone.
  test("refuses when NODE_ENV is production even if VERCEL_ENV is unset", () => {
    process.env[nodeEnvKey] = "production";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(false);
  });

  test("stays off in test without the flag", () => {
    process.env[nodeEnvKey] = "test";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(false);
  });

  // Regression (#1398): without a configured shared secret, test-auth must
  // be disabled entirely, no matter what the other flags say.
  test("refuses when TEST_AUTH_SECRET is not set even if the flag and environment allow it", () => {
    process.env[nodeEnvKey] = "development";
    delete process.env.TEST_AUTH_SECRET;
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(false);
  });

  test("refuses when TEST_AUTH_SECRET is an empty string", () => {
    process.env[nodeEnvKey] = "development";
    process.env.TEST_AUTH_SECRET = "";
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(false);
  });

  test("allows once TEST_AUTH_SECRET is configured alongside the explicit flag", () => {
    process.env[nodeEnvKey] = "test";
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(isTestAuthEnabled()).toBe(true);
  });
});

describe("getTestAuthSessionFromCookieHeader", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("returns the demo session when enabled and the cookie matches the secret-derived value", () => {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    const session = getTestAuthSessionFromCookieHeader(
      `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_COOKIE_VALUE)}`,
    );

    expect(session?.user.id).toBe(TEST_AUTH_USER_ID);
  });

  // Regression (#1398): the plain, guessable user id must never authenticate
  // on its own — only the secret-derived cookie value can.
  test("returns undefined when the cookie carries the plain user id instead of the secret-derived value", () => {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    const session = getTestAuthSessionFromCookieHeader(
      `${TEST_AUTH_COOKIE}=${TEST_AUTH_USER_ID}`,
    );

    expect(session).toBeUndefined();
  });

  test("returns undefined on production even when the cookie and flag are present", () => {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(
      getTestAuthSessionFromCookieHeader(
        `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_COOKIE_VALUE)}`,
      ),
    ).toBeUndefined();
  });

  test("returns undefined when TEST_AUTH_SECRET is not set even with the flag and a matching cookie name", () => {
    delete process.env.TEST_AUTH_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(
      getTestAuthSessionFromCookieHeader(
        `${TEST_AUTH_COOKIE}=${TEST_AUTH_USER_ID}`,
      ),
    ).toBeUndefined();
  });

  test("emits test-auth.refused with reason=env when production refuses a present cookie", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      process.env[nodeEnvKey] = "production";
      process.env.TEST_AUTH_SECRET = TEST_SECRET;
      process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
      delete process.env.VERCEL_ENV;

      getTestAuthSessionFromCookieHeader(
        `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_COOKIE_VALUE)}`,
        { requestId: "req-env", host: "app.example" },
      );

      const refused = warnings
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((payload) => payload?.event === "test-auth.refused");

      expect(refused).toMatchObject({
        service: "session-test-auth",
        event: "test-auth.refused",
        level: "warn",
        reason: "env",
        requestId: "req-env",
        host: "app.example",
      });
      expect(JSON.stringify(refused)).not.toContain(TEST_SECRET);
      expect(JSON.stringify(refused)).not.toContain(TEST_AUTH_COOKIE_VALUE);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("emits test-auth.refused with reason=secret when the cookie secret mismatches", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      process.env[nodeEnvKey] = "development";
      process.env.TEST_AUTH_SECRET = TEST_SECRET;
      delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
      delete process.env.VERCEL_ENV;

      getTestAuthSessionFromCookieHeader(
        `${TEST_AUTH_COOKIE}=${encodeURIComponent("test-auth:wrong")}`,
        { requestId: "req-secret", host: "localhost:3000" },
      );

      const refused = warnings
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((payload) => payload?.event === "test-auth.refused");

      expect(refused).toMatchObject({
        service: "session-test-auth",
        event: "test-auth.refused",
        level: "warn",
        reason: "secret",
        requestId: "req-secret",
        host: "localhost:3000",
      });
      expect(JSON.stringify(refused)).not.toContain(TEST_SECRET);
      expect(JSON.stringify(refused)).not.toContain("test-auth:wrong");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("test-auth cookie headers", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("setTestAuthCookie writes a Path=/ HttpOnly cookie with the secret-derived value", () => {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;

    const response = new Response(null);
    setTestAuthCookie(response);
    const header = response.headers.get("Set-Cookie");

    expect(header).toContain(
      `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_COOKIE_VALUE)}`,
    );
    expect(header).not.toContain(TEST_AUTH_USER_ID);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Max-Age=86400");
  });

  // Regression (#1398): without the secret configured, no cookie should be
  // issued at all — the plain user id must never appear on the wire.
  test("setTestAuthCookie sets nothing when TEST_AUTH_SECRET is not configured", () => {
    delete process.env.TEST_AUTH_SECRET;

    const response = new Response(null);
    setTestAuthCookie(response);

    expect(response.headers.get("Set-Cookie")).toBeNull();
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
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(shouldBypassGitHubReconnectForTestAuth(TEST_AUTH_USER_ID)).toBe(
      true,
    );
    expect(shouldBypassGitHubReconnectForTestAuth("user-1")).toBe(false);
  });

  test("does not bypass on production even for the demo user", () => {
    process.env.TEST_AUTH_SECRET = TEST_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    expect(shouldBypassGitHubReconnectForTestAuth(TEST_AUTH_USER_ID)).toBe(
      false,
    );
  });

  test("does not bypass when TEST_AUTH_SECRET is not configured", () => {
    delete process.env.TEST_AUTH_SECRET;
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    delete process.env.VERCEL_ENV;

    expect(shouldBypassGitHubReconnectForTestAuth(TEST_AUTH_USER_ID)).toBe(
      false,
    );
  });
});
