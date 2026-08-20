import { NextResponse } from "next/server";
import { seedTestAuthUser } from "@/lib/dev/test-auth-seed";
import {
  TEST_AUTH_USER_ID,
  isTestAuthEnabled,
  setTestAuthCookie,
} from "@/lib/session/test-auth";

function resolveSafeNextPath(next: string | null): string | null {
  if (!next) {
    return null;
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return null;
  }
  return next;
}

export async function GET(request: Request) {
  if (!isTestAuthEnabled()) {
    return Response.json(
      { error: "Not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  await seedTestAuthUser();

  const url = new URL(request.url);
  const nextPath = resolveSafeNextPath(url.searchParams.get("next"));
  const response = nextPath
    ? NextResponse.redirect(new URL(nextPath, url.origin))
    : NextResponse.json({ ok: true, userId: TEST_AUTH_USER_ID });

  setTestAuthCookie(response);
  return response;
}
