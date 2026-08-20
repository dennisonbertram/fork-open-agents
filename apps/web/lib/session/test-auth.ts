import type { Session } from "./types";

export const TEST_AUTH_COOKIE = "open_agents_test_user_id";
export const TEST_AUTH_USER_ID = "dev-managed-runtime-user";

export type TestAuthCookieStore = {
  delete: (cookie: { name: string; path: string }) => void;
};

/**
 * Test-auth is a local/dev impersonation cookie.
 *
 * Fail closed when `VERCEL_ENV === "production"`: even
 * `OPEN_AGENTS_ENABLE_TEST_AUTH=1` cannot enable it there. This is a
 * security boundary, not a deploy gate — an unconfigured `VERCEL_ENV`
 * must not look like Production and refuse every local/CI run.
 *
 * Fail open (allow) when `VERCEL_ENV` is unset: local checkouts and CI
 * are not Production, and `NODE_ENV=development` already enables the
 * cookie.
 */
export function isTestAuthEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }

  return (
    process.env.NODE_ENV === "development" ||
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH === "1"
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
): Session | undefined {
  if (!isTestAuthEnabled()) {
    return undefined;
  }

  const userId = parseCookieHeader(cookieHeader).get(TEST_AUTH_COOKIE);
  if (userId !== TEST_AUTH_USER_ID) {
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
  response.headers.append(
    "Set-Cookie",
    `${TEST_AUTH_COOKIE}=${encodeURIComponent(
      TEST_AUTH_USER_ID,
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
