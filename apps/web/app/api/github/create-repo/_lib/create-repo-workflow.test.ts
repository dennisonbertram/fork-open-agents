import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type ExecResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function execOk(stdout = ""): ExecResult {
  return { success: true, exitCode: 0, stdout, stderr: "", truncated: false };
}

function execFail(stderr = ""): ExecResult {
  return { success: false, exitCode: 1, stdout: "", stderr, truncated: false };
}

let execScript: Record<string, ExecResult> = {};
let execCalls: string[] = [];
let authTokenCalls: (string | undefined)[] = [];
let generatedCommitMessage = "feat: initial commit";
let createForUserResult: unknown;
let createInOrgResult: unknown;
let createForUserCalls: Record<string, unknown>[] = [];
let createInOrgCalls: Record<string, unknown>[] = [];
let githubProfile: { username: string; externalUserId: string } | null = {
  username: "octocat",
  externalUserId: "991",
};

const sandboxMock = {
  exec: async (command: string) => {
    execCalls.push(command);
    for (const [prefix, result] of Object.entries(execScript)) {
      if (command.startsWith(prefix)) {
        return result;
      }
    }
    return execOk();
  },
  setGitHubAuthToken: async (token?: string) => {
    authTokenCalls.push(token);
  },
};

mock.module("@open-agents/sandbox", () => ({
  withTemporaryGitHubAuth: async (
    _sandbox: unknown,
    token: string | undefined,
    operation: () => Promise<unknown>,
  ) => {
    await sandboxMock.setGitHubAuthToken(token);
    try {
      return await operation();
    } finally {
      await sandboxMock.setGitHubAuthToken(undefined);
    }
  },
}));

mock.module("ai", () => ({
  gateway: (_model: string) => "test-model",
  generateText: async () => ({ text: generatedCommitMessage }),
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async (_userId: string) => githubProfile,
}));

const octokitMock = {
  rest: {
    repos: {
      createForAuthenticatedUser: async (params: Record<string, unknown>) => {
        createForUserCalls.push(params);
        if (createForUserResult instanceof Error) throw createForUserResult;
        return createForUserResult;
      },
      createInOrg: async (params: Record<string, unknown>) => {
        createInOrgCalls.push(params);
        if (createInOrgResult instanceof Error) throw createInOrgResult;
        return createInOrgResult;
      },
    },
  },
};

const workflowModulePromise = import("./create-repo-workflow");

function createdRepoData() {
  return {
    data: {
      html_url: "https://github.com/octocat/repo-1",
      clone_url: "https://github.com/octocat/repo-1.git",
      name: "repo-1",
      owner: { login: "octocat" },
    },
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    octokit: octokitMock,
    sandbox: sandboxMock,
    cwd: "/work",
    repoName: "repo-1",
    sessionTitle: "My Session",
    owner: "octocat",
    accountType: "User" as const,
    repoToken: "user-token-123",
    sessionUser: {
      id: "user-1",
      username: "octocat",
      name: "Octo Cat",
      email: "octo@example.com",
    },
    ...overrides,
  };
}

describe("runCreateRepoWorkflow", () => {
  beforeEach(() => {
    execCalls = [];
    authTokenCalls = [];
    createForUserCalls = [];
    createInOrgCalls = [];
    createForUserResult = createdRepoData();
    createInOrgResult = createdRepoData();
    generatedCommitMessage = "feat: initial commit";
    githubProfile = { username: "octocat", externalUserId: "991" };
    execScript = {
      "ls -A": execOk("file.txt\n"),
      "git rev-parse --git-dir": execOk(".git\n"),
      "git diff --cached --stat": execOk("1 file changed"),
    };
  });

  test("returns workspace_empty before calling GitHub when sandbox has no files", async () => {
    execScript["ls -A"] = execOk("");
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).errorKind).toBe("workspace_empty");
    }
    expect(createForUserCalls.length).toBe(0);
    expect(createInOrgCalls.length).toBe(0);
  });

  test("creates a user repo and runs the full git pipeline", async () => {
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repoUrl).toBe("https://github.com/octocat/repo-1");
      expect(result.cloneUrl).toBe("https://github.com/octocat/repo-1.git");
      expect(result.owner).toBe("octocat");
      expect(result.repoName).toBe("repo-1");
      expect(result.branch).toBe("main");
    }

    expect(createForUserCalls.length).toBe(1);
    expect(createForUserCalls[0]?.name).toBe("repo-1");
    expect(createInOrgCalls.length).toBe(0);

    // git init is skipped because rev-parse succeeded
    expect(execCalls.some((c) => c === "git init")).toBe(false);
    // author identity uses the GitHub noreply email
    expect(
      execCalls.some(
        (c) =>
          c.startsWith("git config user.email") &&
          c.includes("991+octocat@users.noreply.github.com"),
      ),
    ).toBe(true);
    // the remote URL must not embed credentials
    const remoteAdd = execCalls.find((c) => c.startsWith("git remote add origin"));
    expect(remoteAdd).toBeDefined();
    expect(remoteAdd).toContain("https://github.com/octocat/repo-1.git");
    expect(remoteAdd).not.toContain("user-token-123");
    expect(remoteAdd).not.toContain("x-access-token");
    // the push happens with the brokered token and is cleared afterwards
    expect(execCalls.some((c) => c.startsWith("git push -u origin main"))).toBe(
      true,
    );
    expect(authTokenCalls).toEqual(["user-token-123", undefined]);
    // commit message comes from the AI helper
    const commit = execCalls.find((c) => c.startsWith("git commit"));
    expect(commit).toContain("feat: initial commit");
  });

  test("creates an org repo when accountType is Organization", async () => {
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(
      baseParams({ owner: "my-org", accountType: "Organization" }) as never,
    );

    expect(result.ok).toBe(true);
    expect(createInOrgCalls.length).toBe(1);
    expect(createInOrgCalls[0]?.org).toBe("my-org");
    expect(createForUserCalls.length).toBe(0);
  });

  test("runs git init when the workspace is not yet a git repo", async () => {
    execScript["git rev-parse --git-dir"] = execFail("not a git repository");
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(true);
    expect(execCalls.some((c) => c === "git init")).toBe(true);
  });

  test("maps GitHub 422 to repo_name_taken", async () => {
    createForUserResult = Object.assign(new Error("Unprocessable Entity"), {
      status: 422,
    });
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      expect((await result.response.json()).errorKind).toBe("repo_name_taken");
    }
  });

  test("maps GitHub 403 to github_scope_required", async () => {
    createForUserResult = Object.assign(new Error("Forbidden"), {
      status: 403,
    });
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect((await result.response.json()).errorKind).toBe(
        "github_scope_required",
      );
    }
  });

  test("wraps post-creation failures with a manual-cleanup note and clears the token", async () => {
    execScript["git push -u origin main"] = execFail("push rejected");
    const { runCreateRepoWorkflow } = await workflowModulePromise;

    const result = await runCreateRepoWorkflow(baseParams() as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toContain("octocat/repo-1");
      expect(body.error).toContain("was created on GitHub");
      expect(body.error).toContain("delete it manually");
    }
    expect(authTokenCalls).toEqual(["user-token-123", undefined]);
  });
});
