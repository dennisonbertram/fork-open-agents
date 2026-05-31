import { describe, expect, test } from "bun:test";
import { classifyCreateRepoResponse } from "./create-repo-response-classifier";

// BT-001: 207 pushFailed case
describe("classifyCreateRepoResponse — 207 pushFailed", () => {
  test("returns pushFailed classification when status is 207", () => {
    const body = {
      status: "pushFailed",
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      error: "git push failed: authentication error",
    };

    const result = classifyCreateRepoResponse(207, body);

    expect(result.kind).toBe("pushFailed");
  });

  test("207 pushFailed exposes repoUrl so the user can see the orphan repo", () => {
    const body = {
      status: "pushFailed",
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      error: "git push failed",
    };

    const result = classifyCreateRepoResponse(207, body);

    if (result.kind !== "pushFailed") {
      throw new Error(`Expected pushFailed, got ${result.kind}`);
    }
    expect(result.repoUrl).toBe("https://github.com/alice/my-repo");
    expect(result.owner).toBe("alice");
    expect(result.repoName).toBe("my-repo");
    expect(result.error).toBe("git push failed");
  });

  test("207 pushFailed does NOT expose cloneUrl or branch (they are absent in the server response)", () => {
    const body = {
      status: "pushFailed",
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      error: "push error",
    };

    const result = classifyCreateRepoResponse(207, body);

    // cloneUrl and branch must not appear on a pushFailed result
    expect("cloneUrl" in result).toBe(false);
    expect("branch" in result).toBe(false);
  });
});

// BT-002: 200 success case
describe("classifyCreateRepoResponse — 200 success", () => {
  test("returns success classification with cloneUrl and branch present", () => {
    const body = {
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      cloneUrl: "https://github.com/alice/my-repo.git",
      branch: "main",
      appAccess: "verified",
    };

    const result = classifyCreateRepoResponse(200, body);

    expect(result.kind).toBe("success");
  });

  test("200 success exposes cloneUrl and branch from the body", () => {
    const body = {
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      cloneUrl: "https://github.com/alice/my-repo.git",
      branch: "main",
      appAccess: "verified",
    };

    const result = classifyCreateRepoResponse(200, body);

    if (result.kind !== "success") {
      throw new Error(`Expected success, got ${result.kind}`);
    }
    expect(result.cloneUrl).toBe("https://github.com/alice/my-repo.git");
    expect(result.branch).toBe("main");
    expect(result.repoUrl).toBe("https://github.com/alice/my-repo");
    expect(result.owner).toBe("alice");
    expect(result.repoName).toBe("my-repo");
  });

  test("200 with missing cloneUrl is NOT treated as success (guards against force-cast of undefined)", () => {
    const body = {
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      // cloneUrl and branch intentionally absent
    };

    const result = classifyCreateRepoResponse(200, body);

    // Must NOT be "success" when cloneUrl/branch are absent
    expect(result.kind).not.toBe("success");
  });

  test("200 with missing branch is NOT treated as success", () => {
    const body = {
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      cloneUrl: "https://github.com/alice/my-repo.git",
      // branch intentionally absent
    };

    const result = classifyCreateRepoResponse(200, body);

    expect(result.kind).not.toBe("success");
  });
});

// BT-003: 403 fail-closed case
describe("classifyCreateRepoResponse — 403 fail-closed", () => {
  test("returns pushFailed classification when status is 403 and body has pushFailed status", () => {
    const body = {
      error:
        "GitHub App access is required to push to the repository. Install or grant the GitHub App on this account and try again.",
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      status: "pushFailed",
    };

    const result = classifyCreateRepoResponse(403, body);

    expect(result.kind).toBe("pushFailed");
  });

  test("403 fail-closed exposes repo identity (repoUrl, owner, repoName)", () => {
    const body = {
      error: "GitHub App access is required",
      repoUrl: "https://github.com/alice/my-repo",
      owner: "alice",
      repoName: "my-repo",
      status: "pushFailed",
    };

    const result = classifyCreateRepoResponse(403, body);

    if (result.kind !== "pushFailed") {
      throw new Error(`Expected pushFailed, got ${result.kind}`);
    }
    expect(result.repoUrl).toBe("https://github.com/alice/my-repo");
    expect(result.owner).toBe("alice");
    expect(result.repoName).toBe("my-repo");
  });

  test("403 without pushFailed body status is classified as httpError", () => {
    const body = { error: "Not authenticated" };

    const result = classifyCreateRepoResponse(403, body);

    expect(result.kind).toBe("httpError");
  });
});

// Additional error cases
describe("classifyCreateRepoResponse — other error statuses", () => {
  test("401 returns httpError with error message", () => {
    const body = { error: "Reconnect GitHub before creating a repository." };

    const result = classifyCreateRepoResponse(401, body);

    expect(result.kind).toBe("httpError");
    if (result.kind !== "httpError") {
      throw new Error(`Expected httpError, got ${result.kind}`);
    }
    expect(result.error).toBe("Reconnect GitHub before creating a repository.");
  });

  test("500 returns httpError", () => {
    const body = { error: "Internal server error" };

    const result = classifyCreateRepoResponse(500, body);

    expect(result.kind).toBe("httpError");
  });

  test("409 returns httpError", () => {
    const body = { error: "Session is already connected to a repository" };

    const result = classifyCreateRepoResponse(409, body);

    expect(result.kind).toBe("httpError");
  });
});
