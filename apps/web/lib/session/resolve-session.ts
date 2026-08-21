import type { Session } from "./types";
import { auth } from "@/lib/auth/config";
import { getTestAuthSessionFromCookieHeader } from "./test-auth";

function extractUsername(user: {
  name?: string | null;
  [key: string]: unknown;
}): string {
  if (typeof user.username === "string" && user.username) {
    return user.username;
  }
  return user.name ?? "";
}

function hasSessionCredential(headers: Headers): boolean {
  const cookie = headers.get("cookie");
  if (cookie && cookie.trim().length > 0) {
    return true;
  }

  const authorization = headers.get("authorization");
  return !!authorization && authorization.trim().length > 0;
}

export async function resolveSessionFromHeaders(
  headers: Headers,
): Promise<Session | undefined> {
  const cookieHeader = headers.get("cookie");
  const testSession = getTestAuthSessionFromCookieHeader(cookieHeader, {
    requestId: headers.get("x-request-id") ?? undefined,
    host: headers.get("host") ?? undefined,
  });
  if (testSession) {
    return testSession;
  }

  if (!hasSessionCredential(headers)) {
    return undefined;
  }

  const baSession = await auth.api.getSession({
    headers,
  });

  if (!baSession?.user) {
    return undefined;
  }

  return {
    created: baSession.session.createdAt.getTime(),
    authProvider: "vercel",
    user: {
      id: baSession.user.id,
      username: extractUsername(baSession.user),
      email: baSession.user.email ?? undefined,
      avatar: baSession.user.image ?? "",
      name: baSession.user.name ?? undefined,
    },
  };
}
