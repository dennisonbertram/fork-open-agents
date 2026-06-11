import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ToolSet } from "ai";

mock.module("server-only", () => ({}));

// ── Mock state ─────────────────────────────────────────────────────────────────

let mockChat: {
  id: string;
  sessionId: string;
} | null = {
  id: "chat-1",
  sessionId: "session-1",
};

let mockSession: {
  id: string;
  repoOwner: string | null;
  repoName: string | null;
} | null = {
  id: "session-1",
  repoOwner: "acme",
  repoName: "my-repo",
};

let mockAgentRow: {
  role: string;
  fromDbRow: boolean;
  githubToolsEnabled: boolean;
} = {
  role: "main",
  fromDbRow: true,
  githubToolsEnabled: true,
};

let mockAccessResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  defaultBranch?: string;
  reason?: string;
} = {
  ok: true,
  installationId: 42,
  repositoryId: 99,
  defaultBranch: "main",
};

let verifyRepoAccessCallCount = 0;

// Capture args passed to withScopedInstallationOctokit for assertion
let capturedScopedOctokitArgs: {
  installationId: number;
  repositoryId: number;
  permissions: Record<string, string>;
} | null = null;

type MockIssue = {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string } | string>;
  updated_at: string;
  html_url: string;
  pull_request?: { url: string };
};

let mockOctokitIssues: MockIssue[] = [];

const mockOctokit = {
  rest: {
    issues: {
      listForRepo: async (_args: unknown) => ({
        data: mockOctokitIssues,
      }),
    },
  },
};

// ── Module mocks ───────────────────────────────────────────────────────────────

mock.module("@/lib/db/sessions", () => ({
  getChatById: async (_chatId: string) => mockChat,
  getSessionById: async (_sessionId: string) => mockSession,
}));

mock.module("@/lib/agents/resolve-agent", () => ({
  resolveAgentForRole: async (_params: unknown) => mockAgentRow,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async (_params: unknown) => {
    verifyRepoAccessCallCount++;
    return mockAccessResult;
  },
}));

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit: async (params: {
    installationId: number;
    repositoryId: number;
    permissions: Record<string, string>;
    operation: (octokit: typeof mockOctokit) => Promise<unknown>;
  }) => {
    capturedScopedOctokitArgs = {
      installationId: params.installationId,
      repositoryId: params.repositoryId,
      permissions: params.permissions,
    };
    return params.operation(mockOctokit);
  },
}));

// ── Import the module under test (after mocks) ────────────────────────────────

const { resolveGitHubToolsForChat } = await import("./tools");

// ── Test helpers ───────────────────────────────────────────────────────────────

function resetToDefaults() {
  mockChat = { id: "chat-1", sessionId: "session-1" };
  mockSession = { id: "session-1", repoOwner: "acme", repoName: "my-repo" };
  mockAgentRow = { role: "main", fromDbRow: true, githubToolsEnabled: true };
  mockAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 99,
    defaultBranch: "main",
  };
  mockOctokitIssues = [];
  capturedScopedOctokitArgs = null;
  verifyRepoAccessCallCount = 0;
}

beforeEach(resetToDefaults);

// ── Factory gating tests ───────────────────────────────────────────────────────

describe("resolveGitHubToolsForChat — factory gating", () => {
  test("gate OFF: githubToolsEnabled=false → { status: 'off', reason: 'not_enabled' }", async () => {
    mockAgentRow = { role: "main", fromDbRow: true, githubToolsEnabled: false };

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("not_enabled");
    }
  });

  test("no repo bound: session has null repoOwner → { status: 'off', reason: 'no_repo' }", async () => {
    mockSession = { id: "session-1", repoOwner: null, repoName: null };

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("no_repo");
    }
  });

  test("access denied: verifyRepoAccess returns { ok: false } → { status: 'off', reason: 'access_denied' }", async () => {
    mockAccessResult = { ok: false, reason: "no_installation" };

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("access_denied");
      expect(result.accessDeniedReason).toBe("no_installation");
    }
  });

  test("managed_runtime mode: returns { status: 'off', reason: 'non_classic_runtime' } without calling verifyRepoAccess", async () => {
    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
      runtimeMode: "managed_runtime",
    });

    expect(result.status).toBe("off");
    if (result.status === "off") {
      expect(result.reason).toBe("non_classic_runtime");
    }
    // verifyRepoAccess must NOT have been called (no token mint/revoke round-trip)
    expect(verifyRepoAccessCallCount).toBe(0);
  });

  test("gate ON + access ok: returns { status: 'ready' } with github_list_issues tool present", async () => {
    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(Object.keys(result.tools)).toContain("github_list_issues");
      expect(result.repoOwner).toBe("acme");
      expect(result.repoName).toBe("my-repo");
    }
  });
});

// ── github_list_issues tool-level tests ───────────────────────────────────────

describe("github_list_issues execute", () => {
  test("filters out PRs and normalizes labels; permissions requested are { issues: 'read' }", async () => {
    mockOctokitIssues = [
      {
        number: 1,
        title: "Real issue",
        state: "open",
        labels: [{ name: "bug" }, "enhancement"],
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/1",
      },
      {
        number: 2,
        title: "A pull request",
        state: "open",
        labels: [],
        updated_at: "2024-01-02T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/pull/2",
        pull_request: {
          url: "https://api.github.com/repos/acme/my-repo/pulls/2",
        },
      },
    ];

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const tools = result.tools as ToolSet;
    const tool = tools["github_list_issues"];
    expect(tool).toBeDefined();

    // Execute the tool (cast via unknown to satisfy strict TS overlap check)
    type ToolExecutor = {
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    };
    const output = await (tool as unknown as ToolExecutor).execute({
      state: "open",
      perPage: 30,
    });

    // Should only return the real issue, not the PR
    expect(output).toMatchObject({
      ok: true,
      issues: [
        {
          number: 1,
          title: "Real issue",
          state: "open",
          labels: ["bug", "enhancement"],
          url: "https://github.com/acme/my-repo/issues/1",
        },
      ],
    });

    // Permissions requested must be { issues: "read" }
    expect(capturedScopedOctokitArgs).not.toBeNull();
    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "read" });
  });

  test("handles empty label values gracefully (filters out empty strings)", async () => {
    mockOctokitIssues = [
      {
        number: 3,
        title: "Issue with partial label data",
        state: "open",
        labels: [{ name: "" }, "valid-label", { name: "another" }],
        updated_at: "2024-01-03T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/3",
      },
    ];

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const tools = result.tools as ToolSet;
    const tool = tools["github_list_issues"];
    type ToolExecutor = {
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    };
    const output = await (tool as unknown as ToolExecutor).execute({
      state: "open",
    });

    expect(output).toMatchObject({
      ok: true,
      issues: [
        {
          number: 3,
          labels: ["valid-label", "another"],
        },
      ],
    });
  });
});
