import { NextResponse } from "next/server";
import { resolveSafeTestAuthNextPath } from "@/lib/dev/test-auth-redirect";
import { seedTestAuthUser } from "@/lib/dev/test-auth-seed";
import {
  TEST_AUTH_USER_ID,
  isTestAuthEnabled,
  setTestAuthCookie,
} from "@/lib/session/test-auth";

export async function GET(request: Request) {
  if (!isTestAuthEnabled()) {
    return Response.json(
      { error: "Not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  await seedTestAuthUser();

  const url = new URL(request.url);
  const nextPath = resolveSafeTestAuthNextPath(
    url.searchParams.get("next"),
    url.origin,
  );
  const response = nextPath
    ? NextResponse.redirect(new URL(nextPath, url.origin))
    : NextResponse.json({ ok: true, userId: TEST_AUTH_USER_ID });

  setTestAuthCookie(response);
  return response;
}
