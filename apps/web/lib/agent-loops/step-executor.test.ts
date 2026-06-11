/**
 * Agent Loops step-executor tests — TDD RED
 *
 * Full mocked-client test matrix for executeAgentLoopStep:
 *   - github_check: each check kind happy path, API failure, *From missing path
 *   - condition: true / false / error paths
 *   - end: run finalization
 *   - start: trivially succeeds
 *   - agent_step: not_implemented typed failure (M1-05)
 *   - snapshot parse failure (loop_invalid)
 *   - missing node in snapshot
 *   - permission / installation failure mapping
 *   - event emission (names, statuses, correlation fields)
 *   - redaction: token-bearing payload never persisted raw
 *
 * Follows the mock.module pattern established in store.test.ts and
 * background-agents/executor.test.ts.  No real DB, no real network.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Recorded call captures ────────────────────────────────────────────────────

type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
  requestId?: string | null;
  workflowRunId?: string | null;
};

type StepUpdateInput = {
  stepRunId: string;
  status?: string;
  stepOutput?: Record<string, unknown> | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
};

type RunStatusInput = {
  runId: string;
  status: string;
  context?: Record<string, unknown>;
  errorKind?: string | null;
  errorMessage?: string | null;
  finishedAt?: Date | null;
};

let recordedEvents: EventInput[] = [];
let recordedStepUpdates: StepUpdateInput[] = [];
let recordedRunUpdates: RunStatusInput[] = [];

// ── Store mocks ───────────────────────────────────────────────────────────────

let currentStepRun: AgentLoopStepRun;
let currentLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;

const getAgentLoopStepRunMock = mock(async (_stepRunId: string) => ({
  stepRun: currentStepRun,
  loopRun: currentLoopRun,
  loop: currentLoop,
}));

const updateAgentLoopStepRunMock = mock(
  async (input: StepUpdateInput): Promise<AgentLoopStepRun> => {
    recordedStepUpdates.push(input);
    return { ...currentStepRun, ...(input as Partial<AgentLoopStepRun>) };
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: "evt-1", ...input };
});

const updateAgentLoopRunStatusMock = mock(
  async (input: RunStatusInput): Promise<AgentLoopRun> => {
    recordedRunUpdates.push(input);
    return {
      ...currentLoopRun,
      status: input.status as AgentLoopRun["status"],
    };
  },
);

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getAgentLoopStepRunMock,
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
}));

// ── GitHub access + app mocks ─────────────────────────────────────────────────

let verifyRepoAccessResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  defaultBranch?: string;
  reason?: string;
} = {
  ok: true,
  installationId: 42,
  repositoryId: 7,
  defaultBranch: "main",
};

const verifyRepoAccessMock = mock(async () => verifyRepoAccessResult);

let mintInstallationTokenResult: { token: string } = {
  token: "ghs_test_token",
};
const mintInstallationTokenMock = mock(async () => mintInstallationTokenResult);
const revokeInstallationTokenMock = mock(async () => undefined);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessMock,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mintInstallationTokenMock,
  revokeInstallationToken: revokeInstallationTokenMock,
}));

// ── GitHub API client mock ────────────────────────────────────────────────────

// These mocks are set per-test for the check kind under test.
let listIssuesResult: unknown[] = [];
let listIssuesThrows: Error | null = null;

let getPullResult: unknown = null;
let getPullThrows: Error | null = null;

let listDeploymentStatusesResult: unknown[] = [];
let listDeploymentStatusesThrows: Error | null = null;

let listCheckRunsResult: unknown[] = [];
let listCheckRunsThrows: Error | null = null;

// Track if the GitHub API was called (for *From missing-path tests)
let githubApiCallCount = 0;

const issuesMock = {
  listForRepo: mock(async () => {
    githubApiCallCount++;
    if (listIssuesThrows) throw listIssuesThrows;
    return { data: listIssuesResult };
  }),
};

const pullsMock = {
  get: mock(async () => {
    githubApiCallCount++;
    if (getPullThrows) throw getPullThrows;
    return { data: getPullResult };
  }),
};

// repos.listDeployments + repos.listDeploymentStatuses (deployment_status check)
const reposMock = {
  listDeployments: mock(async () => {
    githubApiCallCount++;
    if (listDeploymentStatusesThrows) throw listDeploymentStatusesThrows;
    return { data: listDeploymentStatusesResult };
  }),
  listDeploymentStatuses: mock(async () => {
    githubApiCallCount++;
    if (listDeploymentStatusesThrows) throw listDeploymentStatusesThrows;
    return { data: [] };
  }),
};

const checksRunsMock = {
  listForRef: mock(async () => {
    githubApiCallCount++;
    if (listCheckRunsThrows) throw listCheckRunsThrows;
    return {
      data: {
        check_runs: listCheckRunsResult,
        total_count: listCheckRunsResult.length,
      },
    };
  }),
};

const octokitMock = {
  rest: {
    issues: issuesMock,
    pulls: pullsMock,
    repos: reposMock,
    checks: checksRunsMock,
  },
};

mock.module("@octokit/rest", () => ({
  Octokit: mock(function () {
    return octokitMock;
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDefinitionSnapshot(nodes: unknown[], edges: unknown[] = []) {
  return { nodes, edges };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-run-1",
    loopRunId: "loop-run-1",
    nodeId: "check-node-1",
    nodeKind: "github_check",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-run-1",
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "loop-run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running",
    definitionSnapshot: makeDefinitionSnapshot([]) as Record<string, unknown>,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-run-1",
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "my-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {
      github: { issues: "read", checks: "read", deployments: "read" },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function resetMocks() {
  recordedEvents = [];
  recordedStepUpdates = [];
  recordedRunUpdates = [];
  githubApiCallCount = 0;

  verifyRepoAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 7,
    defaultBranch: "main",
  };
  mintInstallationTokenResult = { token: "ghs_test_token" };

  listIssuesResult = [];
  listIssuesThrows = null;
  getPullResult = null;
  getPullThrows = null;
  listDeploymentStatusesResult = [];
  listDeploymentStatusesThrows = null;
  listCheckRunsResult = [];
  listCheckRunsThrows = null;

  getAgentLoopStepRunMock.mockClear();
  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  verifyRepoAccessMock.mockClear();
  mintInstallationTokenMock.mockClear();
  revokeInstallationTokenMock.mockClear();
  issuesMock.listForRepo.mockClear();
  pullsMock.get.mockClear();
  reposMock.listDeployments.mockClear();
  reposMock.listDeploymentStatuses.mockClear();
  checksRunsMock.listForRef.mockClear();
}

// Import executor after all mocks are set up.
const executorPromise = import("./step-executor");

// ── BT-001: github_check list_issues happy path ───────────────────────────────

describe("github_check — list_issues", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "check-node-1",
      kind: "github_check",
      label: "Check Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues", labels: ["bug"], state: "open" },
    };
    const snapshot = makeDefinitionSnapshot([node]);

    currentStepRun = makeStepRun({
      nodeId: "check-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();

    listIssuesResult = [
      {
        number: 1,
        title: "Fix bug",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/acme/my-repo/issues/1",
      },
      {
        number: 2,
        title: "Another bug",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/acme/my-repo/issues/2",
      },
    ];
  });

  test("BT-001: succeeds with normalized output — openIssueCount + issues array", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");

    // The step must have been updated to succeeded with stepOutput
    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    expect(succeededUpdate).toBeDefined();
    expect(succeededUpdate?.stepOutput).toBeDefined();
    const output = succeededUpdate?.stepOutput as Record<string, unknown>;
    expect(typeof output["openIssueCount"]).toBe("number");
    expect(output["openIssueCount"]).toBe(2);
    expect(Array.isArray(output["issues"])).toBe(true);
    const issues = output["issues"] as Array<Record<string, unknown>>;
    expect(issues[0]).toHaveProperty("number");
    expect(issues[0]).toHaveProperty("title");
    expect(issues[0]).toHaveProperty("labels");
    expect(issues[0]).toHaveProperty("url");
  });

  test("BT-001: output is merged into run context", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    // Run context must be updated with the check output under the node id
    const contextUpdate = recordedRunUpdates.find(
      (u) => u.context !== undefined,
    );
    expect(contextUpdate).toBeDefined();
    const ctx = contextUpdate?.context as Record<string, unknown>;
    expect(ctx["check-node-1"]).toBeDefined();
    const nodeCtx = ctx["check-node-1"] as Record<string, unknown>;
    expect(nodeCtx["openIssueCount"]).toBe(2);
  });

  test("BT-001: list is capped at 20 items", async () => {
    // Provide 25 issues
    listIssuesResult = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      labels: [],
      html_url: `https://github.com/acme/my-repo/issues/${i + 1}`,
    }));

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    const output = succeededUpdate?.stepOutput as Record<string, unknown>;
    const issues = output?.["issues"] as unknown[];
    expect(issues.length).toBeLessThanOrEqual(20);
  });

  test("BT-001: GitHub API error → typed github_check_failed failure", async () => {
    listIssuesThrows = new Error("GitHub 500");

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("github_check_failed");

    const failedUpdate = recordedStepUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("github_check_failed");
  });
});

// ── BT-002: github_check pr_status happy path ─────────────────────────────────

describe("github_check — pr_status", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "pr-node-1",
      kind: "github_check",
      label: "PR Status",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "impl_step.prNumber" },
    };
    const snapshot = makeDefinitionSnapshot([node]);

    currentStepRun = makeStepRun({
      nodeId: "pr-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
      context: { impl_step: { prNumber: 42 } },
    });
    currentLoop = makeLoop();

    getPullResult = {
      number: 42,
      title: "My PR",
      state: "open",
      merged: false,
      draft: false,
      html_url: "https://github.com/acme/my-repo/pull/42",
      head: { sha: "abc123", ref: "feature-branch" },
      base: { ref: "main" },
      mergeable: true,
    };
  });

  test("BT-002: succeeds with normalized pr_status output", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");

    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    const output = succeededUpdate?.stepOutput as Record<string, unknown>;
    expect(output["number"]).toBe(42);
    expect(output["state"]).toBe("open");
    expect(typeof output["merged"]).toBe("boolean");
    expect(output["url"]).toBeDefined();
  });

  test("BT-002: prNumberFrom path missing → condition_path_missing, no GitHub call", async () => {
    // Context does NOT have impl_step.prNumber
    currentLoopRun = makeLoopRun({
      definitionSnapshot: currentLoopRun.definitionSnapshot,
      context: {},
    });

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_path_missing");
    // GitHub API must NOT have been called
    expect(githubApiCallCount).toBe(0);
  });

  test("BT-002: GitHub API error → github_check_failed", async () => {
    getPullThrows = new Error("Not Found");

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("github_check_failed");
  });
});

// ── BT-003: github_check deployment_status happy path ─────────────────────────

describe("github_check — deployment_status", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "deploy-node-1",
      kind: "github_check",
      label: "Deploy Status",
      position: { x: 0, y: 0 },
      check: { kind: "deployment_status", environment: "production" },
    };
    const snapshot = makeDefinitionSnapshot([node]);

    currentStepRun = makeStepRun({
      nodeId: "deploy-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();

    listDeploymentStatusesResult = [
      {
        id: 1,
        state: "success",
        environment: "production",
        created_at: "2026-06-11T00:00:00Z",
        log_url: "https://github.com/acme/my-repo/deployments/1",
      },
    ];
  });

  test("BT-003: succeeds with normalized deployment_status output", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");

    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    const output = succeededUpdate?.stepOutput as Record<string, unknown>;
    // Must include at least: latestState, environment
    expect(output["latestState"]).toBeDefined();
    expect(output["environment"]).toBeDefined();
  });

  test("BT-003: GitHub API error → github_check_failed", async () => {
    listDeploymentStatusesThrows = new Error("API Error");

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("github_check_failed");
  });
});

// ── BT-004: github_check ci_status happy path ─────────────────────────────────

describe("github_check — ci_status", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "ci-node-1",
      kind: "github_check",
      label: "CI Status",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "impl_step.headSha" },
    };
    const snapshot = makeDefinitionSnapshot([node]);

    currentStepRun = makeStepRun({
      nodeId: "ci-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
      context: { impl_step: { headSha: "abc123" } },
    });
    currentLoop = makeLoop();

    listCheckRunsResult = [
      { id: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, name: "test", status: "completed", conclusion: "success" },
    ];
  });

  test("BT-004: succeeds with normalized ci_status output", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");

    const succeededUpdate = recordedStepUpdates.find(
      (u) => u.status === "succeeded",
    );
    const output = succeededUpdate?.stepOutput as Record<string, unknown>;
    // Must include: totalCount, passedCount, failedCount, pendingCount, checkRuns
    expect(typeof output["totalCount"]).toBe("number");
    expect(typeof output["passedCount"]).toBe("number");
    expect(Array.isArray(output["checkRuns"])).toBe(true);
  });

  test("BT-004: refFrom path missing → condition_path_missing, no GitHub call", async () => {
    // Context has no impl_step.headSha
    currentLoopRun = makeLoopRun({
      definitionSnapshot: currentLoopRun.definitionSnapshot,
      context: {},
    });

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_path_missing");
    expect(githubApiCallCount).toBe(0);
  });

  test("BT-004: GitHub API error → github_check_failed", async () => {
    listCheckRunsThrows = new Error("API Error");

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("github_check_failed");
  });
});

// ── BT-005: permission / installation failures ────────────────────────────────

describe("github_check — permission / installation failures", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "check-node-1",
      kind: "github_check",
      label: "Check Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    const snapshot = makeDefinitionSnapshot([node]);

    currentStepRun = makeStepRun({
      nodeId: "check-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-005: no_installation → installation_missing failure", async () => {
    verifyRepoAccessResult = { ok: false, reason: "no_installation" };

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("installation_missing");
    expect(githubApiCallCount).toBe(0);
  });

  test("BT-005: user_no_access → permission_missing failure", async () => {
    verifyRepoAccessResult = { ok: false, reason: "user_no_access" };

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("permission_missing");
    expect(githubApiCallCount).toBe(0);
  });

  test("BT-005: app_no_access → permission_missing failure", async () => {
    verifyRepoAccessResult = { ok: false, reason: "app_no_access" };

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("permission_missing");
  });
});

// ── BT-006: condition node ────────────────────────────────────────────────────

describe("condition node", () => {
  function setupConditionNode(
    condition: unknown,
    context: Record<string, unknown> = {},
  ) {
    const node = {
      id: "cond-node-1",
      kind: "condition",
      label: "Condition",
      position: { x: 0, y: 0 },
      condition,
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({
      nodeId: "cond-node-1",
      nodeKind: "condition",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
      context,
    });
    currentLoop = makeLoop();
  }

  beforeEach(() => {
    resetMocks();
  });

  test("BT-006: condition true → outcome 'true', no I/O", async () => {
    setupConditionNode(
      { path: "check.openIssueCount", op: "gt", value: 0 },
      { check: { openIssueCount: 3 } },
    );

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("true");
    // No GitHub API calls — pure evaluation
    expect(githubApiCallCount).toBe(0);
    // No verify/mint calls
    expect(verifyRepoAccessMock.mock.calls.length).toBe(0);
  });

  test("BT-006: condition false → outcome 'false'", async () => {
    setupConditionNode(
      { path: "check.openIssueCount", op: "gt", value: 0 },
      { check: { openIssueCount: 0 } },
    );

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("false");
  });

  test("BT-006: condition path missing → typed condition_path_missing failure", async () => {
    setupConditionNode({ path: "nonexistent.path", op: "gt", value: 0 }, {});

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_path_missing");
  });

  test("BT-006: condition type mismatch → typed condition_type_mismatch failure", async () => {
    setupConditionNode(
      { path: "check.value", op: "gt", value: 0 },
      // Value is a string, op expects number
      { check: { value: "not-a-number" } },
    );

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_type_mismatch");
  });
});

// ── BT-007: end node finalizes the run ───────────────────────────────────────

describe("end node", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "end-node-1",
      kind: "end",
      label: "End",
      position: { x: 0, y: 0 },
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({ nodeId: "end-node-1", nodeKind: "end" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-007: end node → outcome 'success' + run status completed", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");

    // Run status must be set to completed
    const completedUpdate = recordedRunUpdates.find(
      (u) => u.status === "completed",
    );
    expect(completedUpdate).toBeDefined();
  });

  test("BT-007: end node emits agent-loop.run.completed event", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const completedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.completed",
    );
    expect(completedEvent).toBeDefined();
  });

  test("BT-007: end node does not call verifyRepoAccess or GitHub", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(verifyRepoAccessMock.mock.calls.length).toBe(0);
    expect(githubApiCallCount).toBe(0);
  });
});

// ── BT-008: start node trivially succeeds ─────────────────────────────────────

describe("start node", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "start-node-1",
      kind: "start",
      label: "Start",
      position: { x: 0, y: 0 },
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({ nodeId: "start-node-1", nodeKind: "start" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-008: start node → outcome 'success', no GitHub calls", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("success");
    expect(verifyRepoAccessMock.mock.calls.length).toBe(0);
    expect(githubApiCallCount).toBe(0);
  });
});

// ── BT-009: agent_step → not_implemented (M1-05) ─────────────────────────────

describe("agent_step node", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "agent-node-1",
      kind: "agent_step",
      label: "Implement",
      position: { x: 0, y: 0 },
      instructions: "Do something",
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({
      nodeId: "agent-node-1",
      nodeKind: "agent_step",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-009: agent_step → typed not_implemented failure referencing M1-05", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("not_implemented");
    expect(result.errorMessage).toMatch(/M1-05/);
  });
});

// ── BT-010: snapshot parse failure ───────────────────────────────────────────

describe("snapshot parse failure", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("BT-010: invalid definitionSnapshot → typed loop_invalid failure", async () => {
    // The snapshot has nodes that fail zod parsing (e.g. node with unknown kind)
    const badSnapshot = {
      nodes: [{ id: "x", kind: "totally_unknown", label: "bad" }],
      edges: [],
    };
    currentStepRun = makeStepRun({ nodeId: "x", nodeKind: "github_check" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: badSnapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("loop_invalid");
  });
});

// ── BT-011: missing node in snapshot ─────────────────────────────────────────

describe("missing node in snapshot", () => {
  beforeEach(() => {
    resetMocks();

    // Snapshot has no node matching the stepRun's nodeId
    const snapshot = makeDefinitionSnapshot([
      {
        id: "other-node",
        kind: "end",
        label: "End",
        position: { x: 0, y: 0 },
      },
    ]);
    // stepRun references "missing-node-1" which is not in snapshot
    currentStepRun = makeStepRun({
      nodeId: "missing-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-011: node missing from snapshot → typed loop_invalid failure", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("loop_invalid");
  });
});

// ── BT-012: event emission assertions ────────────────────────────────────────

describe("event emission", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "end-node-1",
      kind: "end",
      label: "End",
      position: { x: 0, y: 0 },
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({ nodeId: "end-node-1", nodeKind: "end" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
  });

  test("BT-012: agent-loop.step.started emitted with correlation fields", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const startedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.started",
    );
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.loopRunId).toBe("loop-run-1");
    expect(startedEvent?.stepRunId).toBe("step-run-1");
    expect(startedEvent?.nodeId).toBe("end-node-1");
    expect(startedEvent?.workflowRunId).toBe("wf-run-1");
  });

  test("BT-012: agent-loop.step.completed emitted on success with correlation fields", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const completedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.completed",
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.loopRunId).toBe("loop-run-1");
    expect(completedEvent?.stepRunId).toBe("step-run-1");
    expect(completedEvent?.status).toBe("succeeded");
  });

  test("BT-012: agent-loop.step.failed emitted on failure with errorKind", async () => {
    resetMocks();
    // Use an agent_step node to trigger a not_implemented failure
    const node = {
      id: "agent-node-1",
      kind: "agent_step",
      label: "Impl",
      position: { x: 0, y: 0 },
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({
      nodeId: "agent-node-1",
      nodeKind: "agent_step",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const failedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.failed",
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.loopRunId).toBe("loop-run-1");
    expect(failedEvent?.stepRunId).toBe("step-run-1");
    expect(failedEvent?.status).toBe("failed");
    // The payload must contain errorKind
    const payload = failedEvent?.payload as Record<string, unknown>;
    expect(payload?.["errorKind"]).toBe("not_implemented");
  });
});

// ── BT-013: redaction — token-bearing payload never persisted raw ─────────────

describe("redaction", () => {
  beforeEach(() => {
    resetMocks();

    const node = {
      id: "check-node-1",
      kind: "github_check",
      label: "Check Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    const snapshot = makeDefinitionSnapshot([node]);
    currentStepRun = makeStepRun({
      nodeId: "check-node-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: snapshot as Record<string, unknown>,
    });
    currentLoop = makeLoop();
    listIssuesResult = [];
  });

  test("BT-013: installation token is not present in any recorded event payload", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const tokenValue = mintInstallationTokenResult.token;
    for (const event of recordedEvents) {
      const serialized = JSON.stringify(event.payload ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });

  test("BT-013: stepOutput does not contain raw installation token", async () => {
    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const tokenValue = mintInstallationTokenResult.token;
    for (const update of recordedStepUpdates) {
      const serialized = JSON.stringify(update.stepOutput ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });
});
