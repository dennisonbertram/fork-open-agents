/**
 * Behavior tests for POST /api/github/repos (#1177) — create an empty GitHub
 * repository from the new-session repo picker, without a session or sandbox.
 *
 * Error taxonomy mirrors the session-based create-repo flow: unauthorized,
 * invalid_request, github_not_connected, rate_limited, repo_name_taken (409),
 * github_scope_required (403), github_error (502).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
    username: string;
    name: string | null;
    email: string | null;
  };
} | null;

let authSession: AuthSession;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

let mockGitHubToken: string | null = "gho_token";

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => mockGitHubToken,
}));

type CreateParams = {
  name: string;
  description?: string;
  private?: boolean;
  org?: string;
};

let createForAuthenticatedUserImpl: (
  params: CreateParams,
) => Promise<{ data: Record<string, unknown> }>;
let createInOrgImpl: (
  params: CreateParams,
) => Promise<{ data: Record<string, unknown> }>;

const createForAuthenticatedUserSpy = mock((params: CreateParams) =>
  createForAuthenticatedUserImpl(params),
);
const createInOrgSpy = mock((params: CreateParams) => createInOrgImpl(params));

const mockOctokit = {
  rest: {
    repos: {
      createForAuthenticatedUser: createForAuthenticatedUserSpy,
      createInOrg: createInOrgSpy,
    },
  },
};

let mockOctokitOrNull: typeof mockOctokit | null = mockOctokit;

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async () => mockOctokitOrNull,
}));

let mockGitHubProfile: { username?: string } | null = { username: "octocat" };

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async () => mockGitHubProfile,
}));

let mockRateLimitResponse: Response | null = null;

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => mockRateLimitResponse,
  rateLimitKey: (parts: (number | string | null | undefined)[]) =>
    parts.map((part) => String(part ?? "unknown")).join(":"),
}));

const routeModulePromise = import("./route");

const CREATED_REPO_DATA = {
  html_url: "https://github.com/octocat/my-repo",
  clone_url: "https://github.com/octocat/my-repo.git",
  name: "my-repo",
  owner: { login: "octocat" },
};

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/github/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/github/repos", () => {
  beforeEach(() => {
    authSession = {
      user: {
        id: "user-1",
        username: "octocat",
        name: "Octo Cat",
        email: "octo@example.com",
      },
    };
    mockGitHubToken = "gho_token";
    mockOctokitOrNull = mockOctokit;
    mockGitHubProfile = { username: "octocat" };
    mockRateLimitResponse = null;
    createForAuthenticatedUserSpy.mockClear();
    createInOrgSpy.mockClear();
    createForAuthenticatedUserImpl = async () => ({ data: CREATED_REPO_DATA });
    createInOrgImpl = async () => ({
      data: { ...CREATED_REPO_DATA, owner: { login: "acme" } },
    });
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "my-repo" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Not authenticated",
      errorKind: "unauthorized",
    });
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON body",
      errorKind: "invalid_request",
    });
  });

  test("returns 400 when repoName is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Repository name is required",
      errorKind: "invalid_request",
    });
  });

  test("returns 400 for a repoName GitHub would reject", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "bad name!" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errorKind).toBe("invalid_request");
    expect(createForAuthenticatedUserSpy).not.toHaveBeenCalled();
    expect(createInOrgSpy).not.toHaveBeenCalled();
  });

  test("returns the rate-limit response when limited", async () => {
    mockRateLimitResponse = Response.json(
      { error: "Too many requests", errorKind: "rate_limited" },
      { status: 429 },
    );
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "my-repo" }));

    expect(response.status).toBe(429);
    expect(createForAuthenticatedUserSpy).not.toHaveBeenCalled();
  });

  test("returns 401 github_not_connected when there is no GitHub token", async () => {
    mockGitHubToken = null;
    mockOctokitOrNull = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "my-repo" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error:
        "GitHub not connected. Connect GitHub before creating a repository.",
      errorKind: "github_not_connected",
    });
    expect(createForAuthenticatedUserSpy).not.toHaveBeenCalled();
  });

  test("creates a repo for the authenticated user when no owner is given", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        repoName: "my-repo",
        description: "A test repo",
        isPrivate: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createForAuthenticatedUserSpy).toHaveBeenCalledWith({
      name: "my-repo",
      description: "A test repo",
      private: true,
    });
    expect(createInOrgSpy).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      success: true,
      owner: "octocat",
      repoName: "my-repo",
      repoUrl: "https://github.com/octocat/my-repo",
      cloneUrl: "https://github.com/octocat/my-repo.git",
    });
  });

  test("treats an owner matching the user's GitHub username as a user repo", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ repoName: "my-repo", owner: "OctoCat" }),
    );

    expect(response.status).toBe(200);
    expect(createForAuthenticatedUserSpy).toHaveBeenCalled();
    expect(createInOrgSpy).not.toHaveBeenCalled();
  });

  test("creates in an org when the owner differs from the user's username", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ repoName: "my-repo", owner: "acme" }),
    );

    expect(response.status).toBe(200);
    expect(createInOrgSpy).toHaveBeenCalledWith({
      org: "acme",
      name: "my-repo",
      description: undefined,
      private: undefined,
    });
    expect(createForAuthenticatedUserSpy).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.owner).toBe("acme");
  });

  test("maps GitHub 422 to 409 repo_name_taken", async () => {
    createForAuthenticatedUserImpl = async () => {
      throw Object.assign(new Error("Repository creation failed."), {
        status: 422,
      });
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ repoName: "my-repo", owner: "octocat" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'A repository named "my-repo" already exists under octocat.',
      errorKind: "repo_name_taken",
    });
  });

  test("maps GitHub 403 to 403 github_scope_required", async () => {
    createForAuthenticatedUserImpl = async () => {
      throw Object.assign(
        new Error("Resource not accessible by personal access token"),
        {
          status: 403,
        },
      );
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "my-repo" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "GitHub rejected the request. Reconnect GitHub to grant repository creation access, then try again.",
      errorKind: "github_scope_required",
    });
  });

  test("maps GitHub 404 to 403 github_scope_required", async () => {
    createInOrgImpl = async () => {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ repoName: "my-repo", owner: "acme" }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.errorKind).toBe("github_scope_required");
  });

  test("maps any other GitHub failure to 502 github_error", async () => {
    createForAuthenticatedUserImpl = async () => {
      throw Object.assign(new Error("GitHub is down"), { status: 503 });
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ repoName: "my-repo" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "GitHub is down",
      errorKind: "github_error",
    });
  });
});
