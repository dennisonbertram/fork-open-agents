import { desc, eq } from "drizzle-orm";
import type { Session } from "./types";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { getTestAuthSessionFromCookieHeader } from "./test-auth";

const SUPPORTED_AUTH_PROVIDERS = new Set<Session["authProvider"]>([
  "vercel",
  "github",
]);

function isSupportedAuthProvider(
  providerId: string,
): providerId is Session["authProvider"] {
  return SUPPORTED_AUTH_PROVIDERS.has(providerId as Session["authProvider"]);
}

async function resolveAuthProvider(
  userId: string,
): Promise<Session["authProvider"]> {
  try {
    const rows = await db
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(desc(accounts.updatedAt))
      .limit(1);

    const providerId = rows[0]?.providerId;
    if (providerId && isSupportedAuthProvider(providerId)) {
      return providerId;
    }
  } catch {
    // Preserve the existing Vercel fallback if the account cannot be read.
  }

  return "vercel";
}

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
  const testSession = getTestAuthSessionFromCookieHeader(cookieHeader);
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

  const authProvider = await resolveAuthProvider(baSession.user.id);

  return {
    created: baSession.session.createdAt.getTime(),
    authProvider,
    user: {
      id: baSession.user.id,
      username: extractUsername(baSession.user),
      email: baSession.user.email ?? undefined,
      avatar: baSession.user.image ?? "",
      name: baSession.user.name ?? undefined,
    },
  };
}
