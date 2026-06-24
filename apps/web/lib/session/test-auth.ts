import type { Session } from "./types";

export const TEST_AUTH_COOKIE = "open_agents_test_user_id";
export const TEST_AUTH_USER_ID = "dev-managed-runtime-user";

export function getTestAuthUserId(): string {
  return process.env.OPEN_AGENTS_TEST_AUTH_USER_ID?.trim() || TEST_AUTH_USER_ID;
}

function getTestAuthUsername(userId: string): string {
  const configured = process.env.OPEN_AGENTS_TEST_AUTH_USERNAME?.trim();
  if (configured) {
    return configured;
  }

  if (userId === TEST_AUTH_USER_ID) {
    return "managed-runtime-demo";
  }

  return "local-test-user";
}

function getTestAuthEmail(userId: string): string {
  const configured = process.env.OPEN_AGENTS_TEST_AUTH_EMAIL?.trim();
  if (configured) {
    return configured;
  }

  if (userId === TEST_AUTH_USER_ID) {
    return "managed-runtime-demo@example.test";
  }

  return "local-test-user@example.test";
}

function getTestAuthName(userId: string): string {
  const configured = process.env.OPEN_AGENTS_TEST_AUTH_NAME?.trim();
  if (configured) {
    return configured;
  }

  if (userId === TEST_AUTH_USER_ID) {
    return "Managed Runtime Demo";
  }

  return "Local Test User";
}

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
  const expectedUserId = getTestAuthUserId();
  if (userId !== expectedUserId) {
    return undefined;
  }

  return {
    created: Date.now(),
    authProvider: "vercel",
    user: {
      id: expectedUserId,
      username: getTestAuthUsername(expectedUserId),
      email: getTestAuthEmail(expectedUserId),
      avatar: "",
      name: getTestAuthName(expectedUserId),
    },
  };
}

export function setTestAuthCookie(response: Response): void {
  response.headers.append(
    "Set-Cookie",
    `${TEST_AUTH_COOKIE}=${encodeURIComponent(
      getTestAuthUserId(),
    )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}
