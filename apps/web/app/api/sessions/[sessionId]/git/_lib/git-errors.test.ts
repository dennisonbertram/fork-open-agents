import { describe, expect, test } from "bun:test";
import { gitErrorStatus, mapGitActionError } from "./git-errors";

describe("gitErrorStatus", () => {
  test("maps the server-action error messages to HTTP statuses", () => {
    expect(gitErrorStatus("Not authenticated")).toBe(401);
    expect(gitErrorStatus("Forbidden")).toBe(403);
    expect(gitErrorStatus("Session not found")).toBe(404);
    expect(gitErrorStatus("Sandbox not initialized")).toBe(409);
    expect(gitErrorStatus("Sandbox not active")).toBe(409);
    expect(gitErrorStatus("Invalid base branch name")).toBe(400);
    expect(gitErrorStatus("Invalid branch name")).toBe(400);
    expect(gitErrorStatus("Missing required fields")).toBe(400);
    expect(gitErrorStatus("Branch name is required")).toBe(400);
    expect(
      gitErrorStatus("Auto-merge is not available for draft pull requests"),
    ).toBe(400);
    expect(gitErrorStatus("Failed to create branch: fatal: ...")).toBe(500);
  });
});

describe("mapGitActionError", () => {
  test("returns a JSON Response with the mapped status + message", async () => {
    const res = mapGitActionError(new Error("Sandbox not initialized"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Sandbox not initialized");
  });

  test("falls back to 500 with a generic message for non-Error throws", async () => {
    const res = mapGitActionError("boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Git operation failed");
  });

  test("uses 401 for auth errors", () => {
    expect(mapGitActionError(new Error("Not authenticated")).status).toBe(401);
  });
});
