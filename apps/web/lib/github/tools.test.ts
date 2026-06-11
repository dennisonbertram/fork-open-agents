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
  userPermission?: "read" | "write";
  reason?: string;
} = {
  ok: true,
  installationId: 42,
  repositoryId: 99,
  defaultBranch: "main",
  userPermission: "write",
};

let verifyRepoAccessCallCount = 0;

// Capture args passed to withScopedInstallationOctokit for assertion
let capturedScopedOctokitArgs: {
  installationId: number;
  repositoryId: number;
  permissions: Record<string, string>;
} | null = null;

// Capture args passed to each issue mutating method
let capturedCreateArgs: Record<string, unknown> | null = null;
let capturedUpdateArgs: Record<string, unknown> | null = null;
let capturedCreateCommentArgs: Record<string, unknown> | null = null;
let capturedSetLabelsArgs: Record<string, unknown> | null = null;

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
      create: async (args: Record<string, unknown>) => {
        capturedCreateArgs = args;
        return {
          data: {
            number: 101,
            html_url: "https://github.com/acme/my-repo/issues/101",
            state: "open",
            title: (args.title as string) ?? "New Issue",
          },
        };
      },
      update: async (args: Record<string, unknown>) => {
        capturedUpdateArgs = args;
        return {
          data: {
            number: (args.issue_number as number) ?? 42,
            html_url: `https://github.com/acme/my-repo/issues/${args.issue_number ?? 42}`,
            state: (args.state as string) ?? "open",
            title: (args.title as string) ?? "Updated Issue",
          },
        };
      },
      createComment: async (args: Record<string, unknown>) => {
        capturedCreateCommentArgs = args;
        return {
          data: {
            id: 555,
            html_url: `https://github.com/acme/my-repo/issues/${args.issue_number ?? 1}#issuecomment-555`,
          },
        };
      },
      setLabels: async (args: Record<string, unknown>) => {
        capturedSetLabelsArgs = args;
        const labels = (args.labels as string[]) ?? [];
        return {
          data: labels.map((name) => ({ name })),
        };
      },
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
    userPermission: "write",
  };
  mockOctokitIssues = [];
  capturedScopedOctokitArgs = null;
  capturedCreateArgs = null;
  capturedUpdateArgs = null;
  capturedCreateCommentArgs = null;
  capturedSetLabelsArgs = null;
  verifyRepoAccessCallCount = 0;
}

type ToolExecutor = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

async function getReadyTools(): Promise<ToolSet> {
  const result = await resolveGitHubToolsForChat({
    userId: "user-1",
    chatId: "chat-1",
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected ready");
  return result.tools as ToolSet;
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

// ── Split-access tests ─────────────────────────────────────────────────────────

describe("resolveGitHubToolsForChat — split access model", () => {
  const writeToolNames = [
    "github_create_issue",
    "github_update_issue",
    "github_comment_on_issue",
    "github_set_issue_labels",
    "github_close_issue",
  ];

  test("userPermission='write' → returns all 6 tools (list + 5 write)", async () => {
    mockAccessResult = {
      ok: true,
      installationId: 42,
      repositoryId: 99,
      defaultBranch: "main",
      userPermission: "write",
    };

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const toolNames = Object.keys(result.tools);
    expect(toolNames).toContain("github_list_issues");
    for (const name of writeToolNames) {
      expect(toolNames).toContain(name);
    }
    expect(toolNames).toHaveLength(6);
  });

  test("userPermission='read' → read-only user gets github_list_issues but NOT write tools", async () => {
    mockAccessResult = {
      ok: true,
      installationId: 42,
      repositoryId: 99,
      defaultBranch: "main",
      userPermission: "read",
    };

    const result = await resolveGitHubToolsForChat({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const toolNames = Object.keys(result.tools);
    expect(toolNames).toContain("github_list_issues");
    for (const name of writeToolNames) {
      expect(toolNames).not.toContain(name);
    }
    expect(toolNames).toHaveLength(1);
  });

  test("verifyRepoAccess is called exactly once (single round-trip)", async () => {
    await resolveGitHubToolsForChat({ userId: "user-1", chatId: "chat-1" });
    expect(verifyRepoAccessCallCount).toBe(1);
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

// ── github_create_issue tests ─────────────────────────────────────────────────

describe("github_create_issue execute", () => {
  test("mints { issues: 'write' } permission token", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_create_issue"];
    expect(tool).toBeDefined();

    await (tool as unknown as ToolExecutor).execute({ title: "New bug" });

    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "write" });
  });

  test("forwards title, body, labels, assignees to octokit.rest.issues.create", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_create_issue"];

    await (tool as unknown as ToolExecutor).execute({
      title: "New bug",
      body: "Reproduction steps...",
      labels: ["bug", "triage"],
      assignees: ["alice"],
    });

    expect(capturedCreateArgs).toMatchObject({
      owner: "acme",
      repo: "my-repo",
      title: "New bug",
      body: "Reproduction steps...",
      labels: ["bug", "triage"],
      assignees: ["alice"],
    });
  });

  test("returns { ok: true, number, url, state, title }", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_create_issue"];

    const output = await (tool as unknown as ToolExecutor).execute({
      title: "New bug",
    });

    expect(output).toMatchObject({
      ok: true,
      number: 101,
      url: "https://github.com/acme/my-repo/issues/101",
      state: "open",
      title: "New bug",
    });
  });
});

// ── github_update_issue tests ─────────────────────────────────────────────────

describe("github_update_issue execute", () => {
  test("mints { issues: 'write' } permission token", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_update_issue"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 7,
      title: "Updated title",
    });

    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "write" });
  });

  test("maps issueNumber→issue_number and stateReason→state_reason", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_update_issue"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 7,
      state: "closed",
      stateReason: "not_planned",
    });

    expect(capturedUpdateArgs).toMatchObject({
      owner: "acme",
      repo: "my-repo",
      issue_number: 7,
      state: "closed",
      state_reason: "not_planned",
    });
    // camelCase keys must NOT be forwarded
    expect(capturedUpdateArgs).not.toHaveProperty("issueNumber");
    expect(capturedUpdateArgs).not.toHaveProperty("stateReason");
  });

  test("returns { ok: true, number, url, state, title }", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_update_issue"];

    const output = await (tool as unknown as ToolExecutor).execute({
      issueNumber: 7,
      title: "Fixed title",
    });

    expect(output).toMatchObject({
      ok: true,
      number: 7,
      url: expect.stringContaining("/issues/7"),
      state: expect.any(String),
      title: expect.any(String),
    });
  });
});

// ── github_comment_on_issue tests ─────────────────────────────────────────────

describe("github_comment_on_issue execute", () => {
  test("mints { issues: 'write' } permission token", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_comment_on_issue"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 3,
      body: "Great work!",
    });

    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "write" });
  });

  test("forwards issueNumber→issue_number and body", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_comment_on_issue"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 3,
      body: "Great work!",
    });

    expect(capturedCreateCommentArgs).toMatchObject({
      owner: "acme",
      repo: "my-repo",
      issue_number: 3,
      body: "Great work!",
    });
  });

  test("returns { ok: true, commentId, url }", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_comment_on_issue"];

    const output = await (tool as unknown as ToolExecutor).execute({
      issueNumber: 3,
      body: "Great work!",
    });

    expect(output).toMatchObject({
      ok: true,
      commentId: 555,
      url: expect.stringContaining("issuecomment-555"),
    });
  });
});

// ── github_set_issue_labels tests ─────────────────────────────────────────────

describe("github_set_issue_labels execute", () => {
  test("mints { issues: 'write' } permission token", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_set_issue_labels"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 5,
      labels: ["enhancement"],
    });

    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "write" });
  });

  test("forwards issueNumber→issue_number and labels array", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_set_issue_labels"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 5,
      labels: ["enhancement", "help wanted"],
    });

    expect(capturedSetLabelsArgs).toMatchObject({
      owner: "acme",
      repo: "my-repo",
      issue_number: 5,
      labels: ["enhancement", "help wanted"],
    });
  });

  test("returns { ok: true, labels: string[] } normalized from object array", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_set_issue_labels"];

    const output = await (tool as unknown as ToolExecutor).execute({
      issueNumber: 5,
      labels: ["enhancement", "help wanted"],
    });

    expect(output).toEqual({
      ok: true,
      labels: ["enhancement", "help wanted"],
    });
  });

  test("empty labels array clears all labels", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_set_issue_labels"];

    const output = await (tool as unknown as ToolExecutor).execute({
      issueNumber: 5,
      labels: [],
    });

    expect(output).toEqual({ ok: true, labels: [] });
  });
});

// ── github_close_issue tests ──────────────────────────────────────────────────

describe("github_close_issue execute", () => {
  test("mints { issues: 'write' } permission token", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_close_issue"];

    await (tool as unknown as ToolExecutor).execute({ issueNumber: 9 });

    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "write" });
  });

  test("sends state='closed' with default stateReason='completed'", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_close_issue"];

    await (tool as unknown as ToolExecutor).execute({ issueNumber: 9 });

    expect(capturedUpdateArgs).toMatchObject({
      owner: "acme",
      repo: "my-repo",
      issue_number: 9,
      state: "closed",
      state_reason: "completed",
    });
  });

  test("forwards custom stateReason='not_planned'", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_close_issue"];

    await (tool as unknown as ToolExecutor).execute({
      issueNumber: 9,
      stateReason: "not_planned",
    });

    expect(capturedUpdateArgs).toMatchObject({
      issue_number: 9,
      state: "closed",
      state_reason: "not_planned",
    });
  });

  test("returns { ok: true, number, url, state }", async () => {
    const tools = await getReadyTools();
    const tool = tools["github_close_issue"];

    const output = await (tool as unknown as ToolExecutor).execute({
      issueNumber: 9,
    });

    expect(output).toMatchObject({
      ok: true,
      number: 9,
      url: expect.stringContaining("/issues/9"),
      state: expect.any(String),
    });
  });
});

// ── Error-path (try/catch → { ok: false, error }) tests ───────────────────────
//
// Each write tool wraps execute() in try/catch and must return
// { ok: false, error: <string message> } — never a raw Error object.
// These tests make the relevant octokit method throw so the catch branch runs.

describe("write tool error paths — octokit throws → { ok: false, error: string }", () => {
  // Helpers to inject throwing implementations into the shared mockOctokit

  function makeThrow(message: string): () => never {
    return () => {
      throw new Error(message);
    };
  }

  test("github_create_issue: octokit.create throws → ok:false with string error", async () => {
    const origCreate = mockOctokit.rest.issues.create;
    mockOctokit.rest.issues.create = makeThrow(
      "Not Found",
    ) as typeof mockOctokit.rest.issues.create;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_create_issue"];
      const result = await (tool as unknown as ToolExecutor).execute({
        title: "Boom",
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        expect(typeof (result as { ok: false; error: string }).error).toBe(
          "string",
        );
        expect((result as { ok: false; error: string }).error).toBe(
          "Not Found",
        );
      }
    } finally {
      mockOctokit.rest.issues.create = origCreate;
    }
  });

  test("github_update_issue: octokit.update throws → ok:false with string error", async () => {
    const origUpdate = mockOctokit.rest.issues.update;
    mockOctokit.rest.issues.update = makeThrow(
      "Unprocessable Entity",
    ) as typeof mockOctokit.rest.issues.update;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_update_issue"];
      const result = await (tool as unknown as ToolExecutor).execute({
        issueNumber: 7,
        title: "New title",
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        expect(typeof (result as { ok: false; error: string }).error).toBe(
          "string",
        );
        expect((result as { ok: false; error: string }).error).toBe(
          "Unprocessable Entity",
        );
      }
    } finally {
      mockOctokit.rest.issues.update = origUpdate;
    }
  });

  test("github_comment_on_issue: octokit.createComment throws → ok:false with string error", async () => {
    const origCreateComment = mockOctokit.rest.issues.createComment;
    mockOctokit.rest.issues.createComment = makeThrow(
      "Forbidden",
    ) as typeof mockOctokit.rest.issues.createComment;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_comment_on_issue"];
      const result = await (tool as unknown as ToolExecutor).execute({
        issueNumber: 3,
        body: "Test comment",
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        expect(typeof (result as { ok: false; error: string }).error).toBe(
          "string",
        );
        expect((result as { ok: false; error: string }).error).toBe(
          "Forbidden",
        );
      }
    } finally {
      mockOctokit.rest.issues.createComment = origCreateComment;
    }
  });

  test("github_set_issue_labels: octokit.setLabels throws → ok:false with string error", async () => {
    const origSetLabels = mockOctokit.rest.issues.setLabels;
    mockOctokit.rest.issues.setLabels = makeThrow(
      "Label not found",
    ) as typeof mockOctokit.rest.issues.setLabels;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_set_issue_labels"];
      const result = await (tool as unknown as ToolExecutor).execute({
        issueNumber: 5,
        labels: ["missing-label"],
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        expect(typeof (result as { ok: false; error: string }).error).toBe(
          "string",
        );
        expect((result as { ok: false; error: string }).error).toBe(
          "Label not found",
        );
      }
    } finally {
      mockOctokit.rest.issues.setLabels = origSetLabels;
    }
  });

  test("github_close_issue: octokit.update throws → ok:false with string error (close uses update)", async () => {
    const origUpdate = mockOctokit.rest.issues.update;
    mockOctokit.rest.issues.update = makeThrow(
      "Resource not accessible",
    ) as typeof mockOctokit.rest.issues.update;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_close_issue"];
      const result = await (tool as unknown as ToolExecutor).execute({
        issueNumber: 9,
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        expect(typeof (result as { ok: false; error: string }).error).toBe(
          "string",
        );
        expect((result as { ok: false; error: string }).error).toBe(
          "Resource not accessible",
        );
      }
    } finally {
      mockOctokit.rest.issues.update = origUpdate;
    }
  });

  test("non-Error thrown → error is 'Unknown error' string (never leaks raw object)", async () => {
    const origCreate = mockOctokit.rest.issues.create;
    // Throw a plain object (non-Error) to exercise the non-Error branch
    mockOctokit.rest.issues.create = (() => {
      throw "plain string thrown";
    }) as typeof mockOctokit.rest.issues.create;
    try {
      const tools = await getReadyTools();
      const tool = tools["github_create_issue"];
      const result = await (tool as unknown as ToolExecutor).execute({
        title: "Boom",
      });
      expect(result).toMatchObject({ ok: false });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        const err = (result as { ok: false; error: string }).error;
        expect(typeof err).toBe("string");
        expect(err).toBe("Unknown error");
      }
    } finally {
      mockOctokit.rest.issues.create = origCreate;
    }
  });
});
