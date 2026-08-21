import type { Session } from "./types";

export const TEST_AUTH_COOKIE = "open_agents_test_user_id";
export const TEST_AUTH_USER_ID = "dev-managed-runtime-user";
const TEST_AUTH_COOKIE_PREFIX = "test-auth:";
const TEST_AUTH_SERVICE = "session-test-auth" as const;

export type TestAuthCookieStore = {
  delete: (cookie: { name: string; path: string }) => void;
};

export type TestAuthRefuseReason = "env" | "secret";

export type TestAuthResolveOptions = {
  requestId?: string;
  host?: string;
};

/**
 * Test-auth is a local/dev impersonation cookie.
 *
 * Fail closed when `VERCEL_ENV === "production"` OR `NODE_ENV ===
 * "production"`: even `OPEN_AGENTS_ENABLE_TEST_AUTH=1` cannot enable it
 * there. This is a security boundary, not a deploy gate — a platform that
 * never sets `VERCEL_ENV` (e.g. Docker/Railway) still refuses when
 * `NODE_ENV=production`.
 *
 * Also fail closed whenever `TEST_AUTH_SECRET` is not set: without a
 * non-empty shared secret, test-auth is disabled entirely, regardless of
 * every other flag. The cookie value must equal
 * `test-auth:${TEST_AUTH_SECRET}`, not a guessable plain user id.
 *
 * Fail open (allow) only when none of the above apply: local checkouts and
 * CI are not Production, and `NODE_ENV=development` already enables the
 * cookie once the secret is configured.
 */
export function isTestAuthEnabled(): boolean {
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  ) {
    return false;
  }

  if (!process.env.TEST_AUTH_SECRET) {
    return false;
  }

  return (
    process.env.NODE_ENV === "development" ||
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH === "1"
  );
}

/**
 * Value the test-auth cookie must carry. Returns `null` when
 * `TEST_AUTH_SECRET` is unset — callers must treat that as "no valid
 * cookie value exists", never fall back to a guessable default.
 */
function testAuthCookieValue(): string | null {
  const secret = process.env.TEST_AUTH_SECRET;
  if (!secret) {
    return null;
  }
  return `${TEST_AUTH_COOKIE_PREFIX}${secret}`;
}

function isProductionContext(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

function logTestAuthRefused(params: {
  reason: TestAuthRefuseReason;
  requestId?: string;
  host?: string;
}): void {
  console.warn(
    JSON.stringify({
      service: TEST_AUTH_SERVICE,
      event: "test-auth.refused",
      level: "warn",
      reason: params.reason,
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(params.host ? { host: params.host } : {}),
    }),
  );
}

export function shouldBypassGitHubReconnectForTestAuth(
  userId: string,
): boolean {
  return isTestAuthEnabled() && userId === TEST_AUTH_USER_ID;
}

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (!rawName) {
      continue;
    }
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

export function getTestAuthSessionFromCookieHeader(
  cookieHeader: string | null,
  options?: TestAuthResolveOptions,
): Session | undefined {
  const cookieValue = parseCookieHeader(cookieHeader).get(TEST_AUTH_COOKIE);
  if (cookieValue === undefined) {
    return undefined;
  }

  if (isProductionContext()) {
    logTestAuthRefused({
      reason: "env",
      requestId: options?.requestId,
      host: options?.host,
    });
    return undefined;
  }

  const expectedValue = testAuthCookieValue();
  if (!expectedValue || cookieValue !== expectedValue) {
    logTestAuthRefused({
      reason: "secret",
      requestId: options?.requestId,
      host: options?.host,
    });
    return undefined;
  }

  if (!isTestAuthEnabled()) {
    return undefined;
  }

  return {
    created: Date.now(),
    authProvider: "vercel",
    user: {
      id: TEST_AUTH_USER_ID,
      username: "managed-runtime-demo",
      email: "managed-runtime-demo@example.test",
      avatar: "",
      name: "Managed Runtime Demo",
    },
  };
}

export function setTestAuthCookie(response: Response): void {
  const cookieValue = testAuthCookieValue();
  if (!cookieValue) {
    return;
  }

  response.headers.append(
    "Set-Cookie",
    `${TEST_AUTH_COOKIE}=${encodeURIComponent(
      cookieValue,
    )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}

export function clearTestAuthCookie(response: Response): void {
  response.headers.append(
    "Set-Cookie",
    `${TEST_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function deleteTestAuthCookie(cookieStore: TestAuthCookieStore): void {
  cookieStore.delete({ name: TEST_AUTH_COOKIE, path: "/" });
}
