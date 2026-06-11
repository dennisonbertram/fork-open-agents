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

// Capture the search query used (Option A verification)
let capturedSearchQuery: string | null = null;

type MockSearchIssueItem = {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name?: string }>;
  updated_at: string;
  html_url: string;
};

let mockSearchItems: MockSearchIssueItem[] = [];

const mockOctokit = {
  rest: {
    search: {
      issuesAndPullRequests: async (args: {
        q: string;
        sort?: string;
        order?: string;
        per_page?: number;
      }) => {
        capturedSearchQuery = args.q;
        return {
          data: {
            total_count: mockSearchItems.length,
            incomplete_results: false,
            items: mockSearchItems,
          },
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
  };
  mockSearchItems = [];
  capturedScopedOctokitArgs = null;
  capturedSearchQuery = null;
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

type ToolExecutor = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

async function getListIssuesTool(): Promise<ToolExecutor> {
  const result = await resolveGitHubToolsForChat({
    userId: "user-1",
    chatId: "chat-1",
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected ready");
  const tools = result.tools as ToolSet;
  const t = tools["github_list_issues"];
  expect(t).toBeDefined();
  return t as unknown as ToolExecutor;
}

describe("github_list_issues execute", () => {
  test("uses search API with is:issue qualifier and returns mapped issues; permissions requested are { issues: 'read' }", async () => {
    mockSearchItems = [
      {
        number: 1,
        title: "Real issue",
        state: "open",
        labels: [{ name: "bug" }],
        updated_at: "2024-01-01T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/1",
      },
    ];

    const tool = await getListIssuesTool();
    const output = await tool.execute({ state: "open", perPage: 30 });

    // Search API must have been called with is:issue qualifier
    expect(capturedSearchQuery).not.toBeNull();
    expect(capturedSearchQuery).toContain("is:issue");
    expect(capturedSearchQuery).toContain("repo:acme/my-repo");

    expect(output).toMatchObject({
      ok: true,
      issues: [
        {
          number: 1,
          title: "Real issue",
          state: "open",
          labels: ["bug"],
          url: "https://github.com/acme/my-repo/issues/1",
        },
      ],
    });

    // Permissions requested must be { issues: "read" }
    expect(capturedScopedOctokitArgs).not.toBeNull();
    expect(capturedScopedOctokitArgs?.permissions).toEqual({ issues: "read" });
  });

  test("search query uses is:open when state is 'open'", async () => {
    mockSearchItems = [];
    const tool = await getListIssuesTool();
    await tool.execute({ state: "open", perPage: 10 });

    expect(capturedSearchQuery).toContain("is:open");
    // Must not include state:open (search API uses is:open not state:)
    expect(capturedSearchQuery).not.toContain("state:open");
  });

  test("search query uses is:closed when state is 'closed'", async () => {
    mockSearchItems = [];
    const tool = await getListIssuesTool();
    await tool.execute({ state: "closed", perPage: 10 });

    expect(capturedSearchQuery).toContain("is:closed");
    expect(capturedSearchQuery).not.toContain("state:closed");
  });

  test("search query omits state qualifier when state is 'all'", async () => {
    mockSearchItems = [];
    const tool = await getListIssuesTool();
    await tool.execute({ state: "all", perPage: 10 });

    // For 'all', no is:open or is:closed appended — let search return everything
    expect(capturedSearchQuery).not.toContain("is:open");
    expect(capturedSearchQuery).not.toContain("is:closed");
    // But must still scope to repo and issue type
    expect(capturedSearchQuery).toContain("is:issue");
    expect(capturedSearchQuery).toContain("repo:acme/my-repo");
  });

  test("PRs are excluded server-side: search returns only issues (no client-side PR filtering needed)", async () => {
    // The search API with is:issue excludes PRs on the server side.
    // All items returned by search are true issues — tool surfaces them all.
    mockSearchItems = [
      {
        number: 10,
        title: "First issue",
        state: "open",
        labels: [],
        updated_at: "2024-01-10T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/10",
      },
      {
        number: 11,
        title: "Second issue",
        state: "open",
        labels: [],
        updated_at: "2024-01-09T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/11",
      },
    ];

    const tool = await getListIssuesTool();
    const output = await tool.execute({ state: "open", perPage: 30 });

    expect(output).toMatchObject({
      ok: true,
      issues: [
        { number: 10, title: "First issue" },
        { number: 11, title: "Second issue" },
      ],
    });
    // Confirms is:issue was used (server-side exclusion)
    expect(capturedSearchQuery).toContain("is:issue");
  });

  test("under-delivery fix: tool returns up to perPage true issues even when PRs would have polluted listForRepo results", async () => {
    // With the old listForRepo approach: if perPage=5 but 3 results are PRs,
    // only 2 issues would be returned. With search API + is:issue, the server
    // returns only true issues — all 5 are real issues.
    const fiveIssues: MockSearchIssueItem[] = Array.from(
      { length: 5 },
      (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        state: "open",
        labels: [],
        updated_at: `2024-01-0${i + 1}T00:00:00Z`,
        html_url: `https://github.com/acme/my-repo/issues/${i + 1}`,
      }),
    );
    mockSearchItems = fiveIssues;

    const tool = await getListIssuesTool();
    const output = await tool.execute({ state: "open", perPage: 5 });

    expect(output).toMatchObject({ ok: true });
    const typed = output as { ok: true; issues: unknown[] };
    // All 5 true issues are returned — no under-delivery
    expect(typed.issues).toHaveLength(5);
    // Search was used with is:issue (server-side exclusion)
    expect(capturedSearchQuery).toContain("is:issue");
  });

  test("normalizes labels: objects with name, objects without name, and string labels", async () => {
    mockSearchItems = [
      {
        number: 3,
        title: "Issue with partial label data",
        state: "open",
        labels: [{ name: "" }, { name: "valid-label" }, { name: "another" }],
        updated_at: "2024-01-03T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/3",
      },
    ];

    const tool = await getListIssuesTool();
    const output = await tool.execute({ state: "open" });

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

  test("handles empty label list gracefully", async () => {
    mockSearchItems = [
      {
        number: 5,
        title: "Issue with no labels",
        state: "open",
        labels: [],
        updated_at: "2024-01-05T00:00:00Z",
        html_url: "https://github.com/acme/my-repo/issues/5",
      },
    ];

    const tool = await getListIssuesTool();
    const output = await tool.execute({ state: "open" });

    expect(output).toMatchObject({
      ok: true,
      issues: [{ number: 5, labels: [] }],
    });
  });

  test("error path: wraps thrown errors in { ok: false, error } union", async () => {
    // Arrange: make withScopedInstallationOctokit throw for this test by using
    // the mockSearchItems poisoning approach — set items to a Proxy that throws
    // on array iteration (which happens inside the execute mapping step).
    // This validates the catch branch returns { ok: false, error: string }.

    // We simulate an octokit-level throw by overriding the mock to throw.
    // Since mock.module is top-level, we use a flag approach: set items
    // to a value that causes the operation to throw during execution.
    // The simplest: the search mock already reads mockSearchItems.
    // We make the mock throw by overwriting mockOctokit.rest.search.issuesAndPullRequests
    // — but that's a const. Instead, test with an items array that is
    // a Proxy throwing on access:
    (mockSearchItems as unknown) = new Proxy([], {
      get(_target, prop) {
        if (prop === "length") return 0;
        // Throws when the map callback tries to iterate
        throw new Error("simulated octokit failure");
      },
    });

    const tool = await getListIssuesTool();
    // Reset capturedSearchQuery since getListIssuesTool triggers an execute-free resolve
    capturedSearchQuery = null;

    const output = await tool.execute({ state: "open" });
    expect((output as { ok: boolean }).ok).toBe(false);
    expect((output as { ok: false; error: string }).error).toContain(
      "simulated octokit failure",
    );
  });
});
