import type { NextRequest } from "next/server";
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

export async function getSessionFromReq(
  req: NextRequest,
): Promise<Session | undefined> {
  const testSession = getTestAuthSessionFromCookieHeader(
    req.headers.get("cookie"),
  );
  if (testSession) {
    return testSession;
  }

  const baSession = await auth.api.getSession({
    headers: req.headers,
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
