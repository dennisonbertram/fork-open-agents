import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";
import { DEFAULT_ON_TOOL_NAMES } from "./builtin-toolpack";

mock.module("server-only", () => ({}));

type EventInput = {
  runId: string;
  agentId?: string | null;
  userId: string;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  payload?: unknown;
};

type OutputInput = {
  runId: string;
  userId: string;
  kind: string;
  status: string;
  url?: string | null;
  prNumber?: number | null;
  payload?: unknown;
};

type StatusUpdateInput = {
  runId: string;
  status: BackgroundAgentRun["status"];
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
};

type ConnectSandboxInput = {
  state: {
    type: string;
    sandboxName: string;
    source: {
      repo: string;
      branch: string;
    };
  };
  options: {
    githubToken?: string;
    persistent?: boolean;
    resume?: boolean;
    createIfMissing?: boolean;
  };
};

type OpenPullRequestInput = {
  repoUrl: string;
  branchName: string;
  title: string;
  body: string;
  baseBranch: string;
  token: string;
};

const successfulAccess = {
  ok: true,
  installationId: 99,
  repositoryId: 42,
  defaultBranch: "main",
  repositorySelection: "selected" as "all" | "selected",
};

const successfulCommand: ExecResult = {
  success: true,
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  truncated: false,
};

let currentRun: BackgroundAgentRun;
let currentAgent: BackgroundAgent | null;
let commandResults = new Map<string, ExecResult>();

const getBackgroundAgentRunWithAgent = mock(async () => ({
  run: currentRun,
  agent: currentAgent,
}));
const recordBackgroundAgentEvent = mock(async (input: EventInput) => input);
const recordBackgroundAgentOutput = mock(async (input: OutputInput) => input);
const updateBackgroundAgentRunStatus = mock(
  async (input: StatusUpdateInput): Promise<BackgroundAgentRun> => ({
    ...currentRun,
    status: input.status,
    workflowRunId: input.workflowRunId ?? currentRun.workflowRunId,
    sandboxName: input.sandboxName ?? currentRun.sandboxName,
    errorKind: input.errorKind ?? currentRun.errorKind,
    errorMessage: input.errorMessage ?? currentRun.errorMessage,
    outputUrl: input.outputUrl ?? currentRun.outputUrl,
  }),
);

const sandboxExec = mock(async (command: string): Promise<ExecResult> => {
  if (commandResults.has(command)) {
    return commandResults.get(command) ?? successfulCommand;
  }
  if (command.includes("git checkout")) {
    return commandResults.get("git checkout") ?? successfulCommand;
  }
  return successfulCommand;
});

const fakeSandbox = {
  workingDirectory: "/workspace/widgets",
  currentBranch: "main",
  environmentDetails: "Vercel Sandbox test runtime",
  host: "sandbox.example",
  exec: sandboxExec,
  getState: () => ({
    type: "vercel",
    sandboxName: `background_agent_${currentRun.id}`,
  }),
} as unknown as Sandbox;

const connectSandbox = mock(async (_input: ConnectSandboxInput) => fakeSandbox);
const getCurrentBranch = mock(
  async () => "background-agent/smoke-fixer/run_12345678",
);
const getStagedDiff = mock(async () => "diff --git a/README.md b/README.md");
const hasUncommittedChanges = mock(async () => true);
const stageAll = mock(async () => undefined);

const verifyRepoAccess = mock(async () => successfulAccess);
const getRepoAccessErrorMessage = mock((reason: string) => reason);

type AppInstallationRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
};
const listAppInstallationRepositories = mock(
  async (): Promise<AppInstallationRepository[]> => [],
);
mock.module("@/lib/github/repos", () => ({
  listAppInstallationRepositories,
}));
const mintInstallationToken = mock(async () => ({ token: "setup-token" }));
const revokeInstallationToken = mock(async () => undefined);
const withScopedInstallationOctokit = mock(
  async (params: {
    operation: (octokit: unknown) => Promise<unknown>;
  }): Promise<unknown> => params.operation({}),
);
const buildCoAuthor = mock(async () => ({
  name: "mona",
  email: "1+mona@users.noreply.github.com",
}));
const createCommit = mock(
  async (): Promise<
    { ok: true; commitSha: string } | { ok: false; error: string }
  > => ({
    ok: true,
    commitSha: "commit-sha-1",
  }),
);
const buildCommitIntentFromSandbox = mock(async () => ({
  ok: true,
  intent: {
    owner: "acme",
    repo: "widgets",
    repositoryId: 42,
    installationId: 99,
    branch: "background-agent/smoke-fixer/run_12345678",
    baseBranch: "main",
    expectedHeadSha: "base-sha",
    message: "chore: apply Smoke fixer background changes",
    files: [
      {
        path: "README.md",
        content: "Updated",
        mode: "100644",
      },
    ],
    coAuthor: {
      name: "mona",
      email: "1+mona@users.noreply.github.com",
    },
  },
}));
const openPullRequest = mock(async (_input: OpenPullRequestInput) => ({
  success: true,
  prUrl: "https://github.com/acme/widgets/pull/42",
  prNumber: 42,
}));
const getGitHubAppUserToken = mock(async () => "user-token");
const getGitHubUserProfile = mock(async () => ({
  username: "mona",
  externalUserId: "1",
}));
const generate = mock(async () => ({
  finishReason: "stop",
  rawFinishReason: "stop",
  response: {
    messages: [],
  },
  steps: [],
  usage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
  totalUsage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
}));

const listBackgroundAgentEvents = mock(async () => []);
const listBackgroundAgentOutputs = mock(async () => []);

// ── Native GitHub action tool resolver (STEP-9 wiring) ──────────────────────
//
// The resolver's own behavior (which tools get built per action, per-call
// token minting, checkCommand gate inside github_open_pull_request, etc.) is
// already exhaustively tested in apps/web/lib/github/background-agent-tools.test.ts
// (STEPs 3-8). This module is mocked wholesale here so executor.test.ts can
// focus purely on STEP-9's wiring contract: is the resolver called with the
// right context (bounded repositoryIds, enabledActions, requireCiGreenToMerge,
// etc.) BEFORE the agent loop, and are the resulting tools actually merged
// into the tools object passed to openAgent.generate.
type CapturedGitHubToolContext = {
  installationId: number;
  repositoryId: number;
  repositoryIds: number[];
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  userId: string;
  agentName: string;
  runId: string;
  agentId: string | null;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  triggerKind: string;
  checkCommand: string | null;
  enabledActions: string[];
  requireCiGreenToMerge: boolean;
};

let capturedGitHubToolContexts: CapturedGitHubToolContext[] = [];

const resolveGitHubActionToolsForBackgroundAgent = mock(
  (ctx: CapturedGitHubToolContext) => {
    capturedGitHubToolContexts.push(ctx);
    const tools: Record<string, unknown> = {};
    for (const action of ctx.enabledActions) {
      tools[`github_stub_${action}`] = { stub: true };
    }
    return tools;
  },
);

mock.module("@/lib/github/background-agent-tools", () => ({
  resolveGitHubActionToolsForBackgroundAgent,
}));

mock.module("./store", () => ({
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
  // needed by builtin-agent.ts (imported via isLearningsAgent in executor.ts)
  listRepoBackgroundAgents: mock(async () => []),
  listBackgroundAgents: mock(async () => []),
  createBackgroundAgent: mock(async () => ({})),
  updateBackgroundAgent: mock(async () => null),
}));

mock.module("./run-summary", () => ({
  buildRunSummary: mock(() => ({
    headline: "Run succeeded",
    checked: [],
    changed: [],
    blocked: [],
    artifacts: [],
    next: [],
  })),
}));

mock.module("./run-summary-persist", () => ({
  persistRunSummary: mock(async () => undefined),
  recordSummaryFailedEvent: mock(async () => undefined),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: mock(async () => undefined),
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox,
  getCurrentBranch,
  getStagedDiff,
  hasUncommittedChanges,
  stageAll,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: "snapshot-test",
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess,
  getRepoAccessErrorMessage,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
}));

mock.module("@/lib/github/commit", () => ({
  buildCoAuthor,
  createCommit,
}));

mock.module("@/lib/github/commit-intent", () => ({
  buildCommitIntentFromSandbox,
}));

mock.module("@/lib/github/pulls", () => ({
  openPullRequest,
}));

mock.module("@/lib/github/token", () => ({
  getGitHubAppUserToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile,
}));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: (modelId: string) => modelId,
  openAgent: {
    generate,
  },
}));

const executorModulePromise = import("./executor");
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

function buildRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "run_1234567890abcdef",
    agentId: "agent-1",
    triggerId: "trigger-1",
    userId: "user-1",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-1",
    idempotencyKey: "idempotency-1",
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: "abc123",
    branch: null,
    prNumber: 7,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputKind: "none",
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {
      title: "Fix widgets",
      actor: "mona",
    },
    requestId: "req-1",
    workflowRunId: null,
    startedAt: null,
    finishedAt: null,
    resultSummary: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildAgent(overrides: Partial<BackgroundAgent> = {}): BackgroundAgent {
  const now = new Date("2026-05-27T12:00:00.000Z");
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Smoke fixer",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Fix the failing smoke check.",
    permissions: {},
    outputMode: "none",
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function recordedEvents() {
  return recordBackgroundAgentEvent.mock.calls.map(([input]) => input);
}

function recordedStatusUpdates() {
  return updateBackgroundAgentRunStatus.mock.calls.map(([input]) => input);
}

function recordedEvent(name: string) {
  return recordedEvents().find((event) => event.eventName === name);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://open-agents.example";
  currentRun = buildRun();
  currentAgent = buildAgent();
  commandResults = new Map<string, ExecResult>();
  getBackgroundAgentRunWithAgent.mockClear();
  recordBackgroundAgentEvent.mockClear();
  recordBackgroundAgentOutput.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  sandboxExec.mockClear();
  connectSandbox.mockClear();
  getCurrentBranch.mockClear();
  getStagedDiff.mockClear();
  hasUncommittedChanges.mockClear();
  stageAll.mockClear();
  verifyRepoAccess.mockClear();
  verifyRepoAccess.mockImplementation(async () => successfulAccess);
  getRepoAccessErrorMessage.mockClear();
  mintInstallationToken.mockClear();
  revokeInstallationToken.mockClear();
  withScopedInstallationOctokit.mockClear();
  listAppInstallationRepositories.mockClear();
  listAppInstallationRepositories.mockImplementation(async () => []);
  buildCoAuthor.mockClear();
  createCommit.mockClear();
  buildCommitIntentFromSandbox.mockClear();
  openPullRequest.mockClear();
  getGitHubAppUserToken.mockClear();
  getGitHubUserProfile.mockClear();
  generate.mockClear();
  resolveGitHubActionToolsForBackgroundAgent.mockClear();
  capturedGitHubToolContexts = [];
});

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
    return;
  }
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

afterAll(() => {
  mock.restore();
});

describe("executeBackgroundAgentRun", () => {
  test("starts a resumable sandbox and records skipped check evidence", async () => {
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(verifyRepoAccess).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
      requiredUserPermission: "read",
    });
    expect(mintInstallationToken).toHaveBeenCalledWith({
      installationId: 99,
      repositoryIds: [42],
      permissions: { contents: "read" },
    });
    const connectCall = connectSandbox.mock.calls[0]?.[0] as
      | ConnectSandboxInput
      | undefined;
    expect(connectCall).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "background_agent_run_1234567890abcdef",
        source: {
          repo: "https://github.com/acme/widgets.git",
          branch: "main",
        },
      },
      options: {
        githubToken: "setup-token",
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
    expect(revokeInstallationToken).toHaveBeenCalledWith("setup-token");

    expect(recordedEvents().map((event) => event.eventName)).toEqual(
      expect.arrayContaining([
        "background-agent.workflow.started",
        "background-agent.github.installation.resolved",
        "background-agent.sandbox.started",
        "background-agent.git.context.started",
        "background-agent.git.context.completed",
        "background-agent.check.completed",
        "background-agent.run.completed",
      ]),
    );
    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "skipped",
      summary: "No check command configured.",
    });
    expect(recordedStatusUpdates().map((update) => update.status)).toEqual([
      "running",
      "succeeded",
    ]);
  });

  test("skips write-scope resolution and injects no GitHub tools for an agent with no enabled GitHub actions, even when writeScopeMode is all_repos", async () => {
    currentAgent = buildAgent({
      outputMode: "none",
      permissions: {
        github: { writeScopeMode: "all_repos", enabledActions: [] },
      },
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(verifyRepoAccess).toHaveBeenCalledWith(
      expect.objectContaining({ requiredUserPermission: "read" }),
    );
    // needsWrite is false, so resolveWriteScopeRepositoryIds (and its
    // listAppInstallationRepositories call for all_repos) is never reached —
    // even though writeScopeMode is "all_repos" on the persisted agent.
    expect(listAppInstallationRepositories).not.toHaveBeenCalled();

    expect(resolveGitHubActionToolsForBackgroundAgent).toHaveBeenCalledTimes(1);
    expect(capturedGitHubToolContexts[0]).toMatchObject({
      enabledActions: [],
      repositoryIds: [42],
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      tools?: Record<string, unknown>;
    };
    expect(call?.tools).toBeUndefined();
  });

  test("resolves write scope once before the agent loop and injects github_open_pull_request + comment tools for a legacy outputMode 'ready_pr' agent (byte-identical migration)", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
    });
    currentRun = buildRun({
      outputKind: "ready_pr",
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(verifyRepoAccess).toHaveBeenCalledWith(
      expect.objectContaining({ requiredUserPermission: "write" }),
    );
    expect(capturedGitHubToolContexts).toHaveLength(1);
    expect(capturedGitHubToolContexts[0]).toMatchObject({
      installationId: 99,
      repositoryId: 42,
      repositoryIds: [42],
      repoOwner: "acme",
      repoName: "widgets",
      baseBranch: "main",
      checkCommand: "bun test",
      enabledActions: ["open_pull_request", "comment_on_pr_or_issue"],
      requireCiGreenToMerge: true,
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      tools?: Record<string, unknown>;
    };
    expect(Object.keys(call?.tools ?? {})).toEqual(
      expect.arrayContaining([
        "github_stub_open_pull_request",
        "github_stub_comment_on_pr_or_issue",
      ]),
    );

    // The checkCommand gate for opening a PR now lives inside the
    // github_open_pull_request tool itself — running it again here would
    // double-run the command, so the executor-level check step is skipped
    // (never actually executed) and only records an observability event.
    expect(
      sandboxExec.mock.calls.some(
        (call2) => (call2[0] as string) === "bun test",
      ),
    ).toBe(false);
    expect(recordedEvent("background-agent.check.completed")).toMatchObject({
      status: "skipped",
      summary:
        "Check command is enforced inside the github_open_pull_request tool.",
    });

    // No post-hoc PR creation — the mocked model never calls a tool, so the
    // run completes via the generic sandbox-evidence success path.
    expect(recordedEvent("background-agent.run.completed")).toMatchObject({
      status: "succeeded",
      summary: "Background agent run completed with sandbox evidence.",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
  });

  test("BT-A4-01: resolves an all_repos write scope to the installation's full accessible repo set and passes it to the GitHub tool context when repositorySelection is 'all'", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
      permissions: { github: { writeScopeMode: "all_repos" } },
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    verifyRepoAccess.mockImplementation(async () => ({
      ...successfulAccess,
      repositorySelection: "all",
    }));
    listAppInstallationRepositories.mockImplementation(async () => [
      { id: 100, name: "gadgets", full_name: "acme/gadgets", private: false },
      { id: 42, name: "widgets", full_name: "acme/widgets", private: false },
      { id: 7, name: "alpha", full_name: "acme/alpha", private: true },
    ]);
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(capturedGitHubToolContexts[0]?.repositoryIds).toEqual([7, 42, 100]);
    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      tools?: Record<string, unknown>;
    };
    expect(call?.tools).toHaveProperty("github_stub_open_pull_request");
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
  });

  test("BT-A4-02: denies an all_repos-scoped run with write_scope_denied BEFORE the agent loop starts, when the installation is only 'selected'", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
      permissions: { github: { writeScopeMode: "all_repos" } },
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    verifyRepoAccess.mockImplementation(async () => ({
      ...successfulAccess,
      repositorySelection: "selected",
    }));
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(listAppInstallationRepositories).not.toHaveBeenCalled();
    // Write-scope resolution happens BEFORE the agent loop — a denial means
    // the mutation agent (and the GitHub tool context/resolver) is never
    // reached at all.
    expect(generate).not.toHaveBeenCalled();
    expect(resolveGitHubActionToolsForBackgroundAgent).not.toHaveBeenCalled();
    expect(recordBackgroundAgentOutput).not.toHaveBeenCalled();
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "write_scope_denied",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "write_scope_denied",
    });
  });

  test("regression: re-checks repositorySelection fresh on every run — an installer narrowing the installation after an agent was configured with all_repos denies the very next run, and a later widening allows the run after it", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
      permissions: { github: { writeScopeMode: "all_repos" } },
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    // Run 1: installation is currently "selected" — must deny, not proceed.
    verifyRepoAccess.mockImplementation(async () => ({
      ...successfulAccess,
      repositorySelection: "selected",
    }));
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      errorKind: "write_scope_denied",
    });
    expect(generate).not.toHaveBeenCalled();

    // Reset per-run recorders but keep the same persisted agent config —
    // nothing about the agent's own saved scope changed between runs.
    recordBackgroundAgentEvent.mockClear();
    updateBackgroundAgentRunStatus.mockClear();
    generate.mockClear();
    listAppInstallationRepositories.mockImplementation(async () => [
      { id: 42, name: "widgets", full_name: "acme/widgets", private: false },
      { id: 100, name: "gadgets", full_name: "acme/gadgets", private: false },
    ]);

    // Run 2: installation is now "all" — the SAME agent config must now
    // succeed, proving the gate reads the installation's current state on
    // every run rather than a value cached from the first run or from save
    // time.
    verifyRepoAccess.mockImplementation(async () => ({
      ...successfulAccess,
      repositorySelection: "all",
    }));
    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-2",
    });
    expect(recordedEvent("background-agent.run.failed")).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });
  });

  test("regression: every write-scope-eligible run passes a bounded, non-empty repositoryIds list into the GitHub tool context, never an empty/omitted scope", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      checkCommand: "bun test",
      permissions: { github: { writeScopeMode: "all_repos" } },
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    verifyRepoAccess.mockImplementation(async () => ({
      ...successfulAccess,
      repositorySelection: "all",
    }));
    listAppInstallationRepositories.mockImplementation(async () => [
      { id: 42, name: "widgets", full_name: "acme/widgets", private: false },
      { id: 100, name: "gadgets", full_name: "acme/gadgets", private: false },
    ]);
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    // mintInstallationToken (the read-only sandbox setup mint) always scopes
    // to exactly the home repo.
    expect(mintInstallationToken).toHaveBeenCalledWith({
      installationId: 99,
      repositoryIds: [42],
      permissions: { contents: "read" },
    });

    expect(capturedGitHubToolContexts).toHaveLength(1);
    const ctx = capturedGitHubToolContexts[0];
    const repositoryIds = ctx?.repositoryIds;
    expect(Array.isArray(repositoryIds)).toBe(true);
    expect((repositoryIds as number[]).length).toBeGreaterThan(0);
    expect(repositoryIds).toEqual([42, 100]);
  });

  test("runs unattended and forwards the agent's builtinToolNames allowlist", async () => {
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      builtinToolNames: ["read", "grep", "bash"],
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { unattended?: boolean; allowedBuiltinToolNames?: string[] };
    };
    expect(call?.options?.unattended).toBe(true);
    expect(call?.options?.allowedBuiltinToolNames).toEqual([
      "read",
      "grep",
      "bash",
    ]);
  });

  test("BT-721-017: resolves a null builtinToolNames agent to the default toolpack (web_fetch OFF) at runtime, matching the detail page's 'default toolpack (web_fetch off)' claim", async () => {
    currentAgent = buildAgent({ outputMode: "ready_pr" });
    currentRun = buildRun({ outputKind: "ready_pr" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { allowedBuiltinToolNames?: unknown };
    };
    // Must NOT be null (null = fully unrestricted, including web_fetch).
    // Must resolve to the same DEFAULT_ON_TOOL_NAMES preset the detail page
    // and the new-agent default both use, so runtime, UI defaults, and the
    // detail page's "web_fetch off" claim never drift apart.
    expect(call?.options?.allowedBuiltinToolNames).toEqual([
      ...DEFAULT_ON_TOOL_NAMES,
    ]);
    const resolvedNames = (call?.options?.allowedBuiltinToolNames ??
      []) as string[];
    expect(resolvedNames.includes("web_fetch")).toBe(false);
  });

  test("invokes the mutation agent for Report-only (outputMode none) runs", async () => {
    // currentAgent/currentRun use defaults from beforeEach: outputMode "none".
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(recordedEvent("background-agent.agent.started")).toBeDefined();
    expect(openPullRequest).not.toHaveBeenCalled();
    expect(recordBackgroundAgentOutput).not.toHaveBeenCalled();
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "succeeded",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { allowedBuiltinToolNames?: unknown };
    };
    expect(call?.options?.allowedBuiltinToolNames).toEqual([
      ...DEFAULT_ON_TOOL_NAMES,
    ]);
  });

  test("REG-721-fix1: never resolves a legacy/unset builtinToolNames agent to a toolset that includes web_fetch, regardless of trigger or outputMode", async () => {
    // Guards against re-introducing the "null = fully unrestricted" bug at
    // executor.ts:1057 (the adversarial-review must-fix finding). Even if
    // DEFAULT_ON_TOOL_NAMES gains/loses unrelated tool names in the future,
    // this test independently asserts the one security-relevant invariant:
    // an agent that never configured a Standard toolpack must not run with
    // web_fetch (unauthenticated outbound HTTP, auto-approved, no human gate
    // in unattended runs) enabled by default.
    currentAgent = buildAgent({
      outputMode: "ready_pr",
      builtinToolNames: null,
    });
    currentRun = buildRun({ outputKind: "ready_pr" });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    const call = (generate.mock.calls[0] as unknown[] | undefined)?.[0] as {
      options?: { allowedBuiltinToolNames?: unknown };
    };
    const resolved = call?.options?.allowedBuiltinToolNames;
    // Must not be the "unrestricted" sentinel and must not contain web_fetch.
    expect(resolved).not.toBeNull();
    expect(Array.isArray(resolved)).toBe(true);
    expect((resolved as string[]).includes("web_fetch")).toBe(false);
  });

  test("records a workflow_failed failure (not a silent success) when the mutation agent throws for a Report-only run", async () => {
    // currentAgent/currentRun use defaults from beforeEach: outputMode "none".
    generate.mockImplementationOnce(() => {
      throw new Error("model provider unavailable");
    });
    const { executeBackgroundAgentRun } = await executorModulePromise;

    await executeBackgroundAgentRun({
      runId: currentRun.id,
      workflowRunId: "workflow-1",
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(recordedEvent("background-agent.run.failed")).toMatchObject({
      status: "failed",
      errorKind: "workflow_failed",
      summary: "model provider unavailable",
    });
    expect(recordedStatusUpdates().at(-1)).toMatchObject({
      status: "failed",
      errorKind: "workflow_failed",
    });
    // No fall-through to the deterministic no-model success path.
    expect(recordedEvent("background-agent.run.completed")).toBeUndefined();
  });
});
