import type { NextRequest } from "next/server";
import { resolveSessionFromHeaders } from "./resolve-session";

export async function getSessionFromReq(
  req: NextRequest,
): ReturnType<typeof resolveSessionFromHeaders> {
  return resolveSessionFromHeaders(req.headers);
}
