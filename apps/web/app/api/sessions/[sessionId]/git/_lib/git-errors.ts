/**
 * Map the typed Error messages thrown by the git/GitHub server actions
 * (lib/git/**, lib/github/**) to HTTP status codes for the thin route layer.
 * The actions throw stable, human-readable messages; we translate them rather
 * than duplicating their auth/ownership/sandbox logic.
 */
export function gitErrorStatus(message: string): number {
  if (message === "Not authenticated") {
    return 401;
  }
  if (message === "Forbidden") {
    return 403;
  }
  if (message === "Session not found") {
    return 404;
  }
  if (message === "Sandbox not initialized") {
    return 409;
  }
  if (message.startsWith("Invalid ")) {
    return 400;
  }
  return 500;
}

export function mapGitActionError(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : "Git operation failed";
  const status = gitErrorStatus(message);
  if (status === 500) {
    console.error("[git-http] git action failed:", error);
  }
  return Response.json({ error: message }, { status });
}
