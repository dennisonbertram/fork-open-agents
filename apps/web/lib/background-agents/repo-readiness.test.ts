import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type RepoAccessResult =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | {
      ok: false;
      reason:
        | "no_user_token"
        | "user_no_access"
        | "user_no_write"
        | "no_installation"
        | "app_no_access";
    };

const verifyRepoAccess = mock(
  async (): Promise<RepoAccessResult> => ({
    ok: true as const,
    installationId: 123,
    repositoryId: 456,
    defaultBranch: "main",
  }),
);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess,
  getRepoAccessErrorMessage: (reason: string) => `message:${reason}`,
}));

const modulePromise = import("./repo-readiness");

describe("background agent repo readiness", () => {
  beforeEach(() => {
    // These cases exercise GitHub permission, not the allowlist. Readiness now
    // consults both, so give them a wildcard allowlist to isolate what they
    // actually assert.
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";
    verifyRepoAccess.mockReset();
    verifyRepoAccess.mockImplementation(
      async (): Promise<RepoAccessResult> => ({
        ok: true as const,
        installationId: 123,
        repositoryId: 456,
        defaultBranch: "main",
      }),
    );
  });

  test("reports repo access and installation readiness", async () => {
    const { getBackgroundAgentRepoReadiness } = await modulePromise;

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(readiness).toEqual({
      ready: true,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
      reason: null,
      message:
        "GitHub user access and GitHub App installation cover this repo.",
      installationId: 123,
      repositoryId: 456,
      defaultBranch: "main",
    });
    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "write",
    });
  });

  test("surfaces typed access failures without leaking credentials", async () => {
    verifyRepoAccess.mockImplementationOnce(async () => ({
      ok: false as const,
      reason: "app_no_access",
    }));
    const { getBackgroundAgentRepoReadiness } = await modulePromise;

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
    });

    expect(readiness).toEqual({
      ready: false,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
      reason: "app_no_access",
      message: "message:app_no_access",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
    });
    expect(JSON.stringify(readiness)).not.toContain("secret-value");
  });

  test("returns a generic readiness failure when GitHub verification throws", async () => {
    verifyRepoAccess.mockImplementationOnce(async () => {
      throw new Error("GitHub is unavailable");
    });
    const { getBackgroundAgentRepoReadiness } = await modulePromise;

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(readiness).toMatchObject({
      ready: false,
      reason: "github_error",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
    });
    expect(readiness.message).not.toContain("GitHub is unavailable");
  });
});

// Regression for a six-week silent production outage. A scheduled trigger on
// dennisonbertram/agent-university was refused every week from 2026-07-06 with
// `repo_not_allowlisted`, while the readiness panel reported the repo ready —
// because readiness checked only GitHub permission, and the allowlist that
// actually gates dispatch was consulted nowhere on this path. Readiness that
// disagrees with the dispatcher is worse than no readiness check.
describe("repo readiness reflects the allowlist the dispatcher enforces", () => {
  beforeEach(() => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/allowed";
  });

  test("a repo outside the allowlist is NOT ready, even with full GitHub write", async () => {
    const { getBackgroundAgentRepoReadiness } =
      await import("./repo-readiness");

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "not-listed",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe("repo_not_allowlisted");
    // The message must name the variable an operator has to change.
    expect(readiness.message).toContain("BACKGROUND_AGENTS_ALLOWED_REPOS");
  });

  test("a repo on the allowlist is ready", async () => {
    const { getBackgroundAgentRepoReadiness } =
      await import("./repo-readiness");

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "allowed",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.reason).toBeNull();
  });

  test("a wildcard allowlist allows any repo", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";
    const { getBackgroundAgentRepoReadiness } =
      await import("./repo-readiness");

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "anyone",
      repoName: "anything",
    });

    expect(readiness.ready).toBe(true);
  });

  test("an unconfigured allowlist is reported, not silently allowed", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = undefined as never;
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    const { getBackgroundAgentRepoReadiness } =
      await import("./repo-readiness");

    const readiness = await getBackgroundAgentRepoReadiness({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "allowed",
    });

    expect(readiness.ready).toBe(false);
  });
});
