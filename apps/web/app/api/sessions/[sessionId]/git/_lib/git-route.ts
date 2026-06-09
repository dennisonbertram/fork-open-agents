import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";

export type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type GitSessionGate =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/**
 * Authenticate the caller and confirm they own the session. The underlying
 * git/GitHub actions re-check this too (defense in depth), but doing it here
 * yields clean 401/403/404 responses before any sandbox work.
 */
export async function requireGitSession(
  sessionId: string,
): Promise<GitSessionGate> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return { ok: false, response: auth.response };
  }
  const owned = await requireOwnedSession({ userId: auth.userId, sessionId });
  if (!owned.ok) {
    return { ok: false, response: owned.response };
  }
  return { ok: true, userId: auth.userId };
}

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Parse a JSON body, returning null on malformed input. */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
