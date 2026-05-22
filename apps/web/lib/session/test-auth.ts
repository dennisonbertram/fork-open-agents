import type { Session } from "./types";

export const TEST_AUTH_COOKIE = "open_agents_test_user_id";
export const TEST_AUTH_USER_ID = "dev-managed-runtime-user";

export function isTestAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH === "1"
  );
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
