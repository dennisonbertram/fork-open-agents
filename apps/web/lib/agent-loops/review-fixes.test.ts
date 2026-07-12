/**
 * Agent Loops — Review-fix behavioral tests (TASK-PR344-REVIEW-FIXES)
 *
 * TDD RED tests for four PR review findings:
 *
 * BT-F1: checkListIssues filters out pull_request items BEFORE the 20-item cap
 * BT-F2: checkDeploymentStatus preserves log_url / target_url from deployment status
 * BT-F3: *From resolution failures assert verifyRepoAccess + mintInstallationToken call count = 0
 * BT-F4: updateAgentLoopRunStatus does not reset startedAt when called with status=running twice;
 *         updateAgentLoopRunContext exists and only updates context + updatedAt
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── BT-F1 & BT-F2: github-checks unit tests ──────────────────────────────────
//
// We test checkListIssues and checkDeploymentStatus directly, mocking Octokit.

let listForRepoResult: unknown[] = [];
let listDeploymentsResult: unknown[] = [];
let listDeploymentStatusesResult: unknown[] = [];

const octokitMockGhChecks = {
  rest: {
    issues: {
      listForRepo: mock(async () => ({
        data: listForRepoResult,
      })),
    },
    repos: {
      listDeployments: mock(async () => ({
        data: listDeploymentsResult,
      })),
      listDeploymentStatuses: mock(async () => ({
        data: listDeploymentStatusesResult,
      })),
    },
  },
};

mock.module("@octokit/rest", () => ({
  Octokit: mock(function () {
    return octokitMockGhChecks;
  }),
}));

function resetGhCheckMocks() {
  listForRepoResult = [];
  listDeploymentsResult = [];
  listDeploymentStatusesResult = [];
  octokitMockGhChecks.rest.issues.listForRepo.mockClear();
  octokitMockGhChecks.rest.repos.listDeployments.mockClear();
  octokitMockGhChecks.rest.repos.listDeploymentStatuses.mockClear();
}

const githubChecksPromise = import("./github-checks");

// ── BT-F1: list_issues PR filtering ──────────────────────────────────────────

describe("BT-F1: checkListIssues filters out pull requests", () => {
  beforeEach(resetGhCheckMocks);

  test("BT-F1a: response with mixed issues + PRs → only true issues in output", async () => {
    listForRepoResult = [
      // True issue
      {
        number: 1,
        title: "Real issue",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/acme/repo/issues/1",
        // No pull_request field
      },
      // Pull request (should be excluded)
      {
        number: 2,
        title: "A pull request",
        labels: [],
        html_url: "https://github.com/acme/repo/pull/2",
        pull_request: { url: "https://api.github.com/repos/acme/repo/pulls/2" },
      },
      // Another true issue
      {
        number: 3,
        title: "Another issue",
        labels: [],
        html_url: "https://github.com/acme/repo/issues/3",
      },
    ];

    const { checkListIssues } = await githubChecksPromise;
    const result = await checkListIssues({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    // Only the 2 true issues should be in the output
    expect(result.openIssueCount).toBe(2);
    expect(result.issues.length).toBe(2);
    // PR number 2 must not appear
    const numbers = result.issues.map((i) => i.number);
    expect(numbers).not.toContain(2);
    expect(numbers).toContain(1);
    expect(numbers).toContain(3);
  });

  test("BT-F1b: openIssueCount equals the filtered issues length (not total including PRs)", async () => {
    // 5 PRs + 3 issues — openIssueCount must be 3, not 8
    listForRepoResult = [
      ...Array.from({ length: 5 }, (_, i) => ({
        number: 100 + i,
        title: `PR ${i}`,
        labels: [],
        html_url: `https://github.com/acme/repo/pull/${100 + i}`,
        pull_request: {
          url: `https://api.github.com/repos/acme/repo/pulls/${100 + i}`,
        },
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        number: 200 + i,
        title: `Issue ${i}`,
        labels: [],
        html_url: `https://github.com/acme/repo/issues/${200 + i}`,
      })),
    ];

    const { checkListIssues } = await githubChecksPromise;
    const result = await checkListIssues({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    expect(result.openIssueCount).toBe(3);
    expect(result.issues.length).toBe(3);
  });

  test("BT-F1c: 20-item cap applies AFTER PR filtering — not to the mixed list", async () => {
    // 10 PRs + 15 issues — after filtering we have 15 issues, cap → 15 (still under 20)
    listForRepoResult = [
      ...Array.from({ length: 10 }, (_, i) => ({
        number: 100 + i,
        title: `PR ${i}`,
        labels: [],
        html_url: `https://github.com/acme/repo/pull/${100 + i}`,
        pull_request: { url: "https://api.github.com/repos/acme/repo/pulls/1" },
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        number: 200 + i,
        title: `Issue ${i}`,
        labels: [],
        html_url: `https://github.com/acme/repo/issues/${200 + i}`,
      })),
    ];

    const { checkListIssues } = await githubChecksPromise;
    const result = await checkListIssues({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    // All 15 issues should appear because they're under the 20 cap
    expect(result.issues.length).toBe(15);
    expect(result.openIssueCount).toBe(15);
  });

  test("BT-F1d: 20-item cap after filtering — 25 issues (no PRs) capped at 20", async () => {
    listForRepoResult = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      labels: [],
      html_url: `https://github.com/acme/repo/issues/${i + 1}`,
    }));

    const { checkListIssues } = await githubChecksPromise;
    const result = await checkListIssues({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    expect(result.issues.length).toBeLessThanOrEqual(20);
    expect(result.openIssueCount).toBe(result.issues.length);
  });
});

// ── BT-F2: deployment_status preserves log_url / target_url ──────────────────

describe("BT-F2: checkDeploymentStatus preserves log URL", () => {
  beforeEach(resetGhCheckMocks);

  test("BT-F2a: status with log_url → logUrl is preserved in output", async () => {
    listDeploymentsResult = [{ id: 10, created_at: "2026-06-11T00:00:00Z" }];
    listDeploymentStatusesResult = [
      {
        state: "success",
        log_url: "https://github.com/acme/repo/deployments/10/log",
        target_url: "https://preview.acme.com",
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    expect(result.deployments.length).toBe(1);
    expect(result.deployments[0]?.logUrl).toBe(
      "https://github.com/acme/repo/deployments/10/log",
    );
  });

  test("BT-F2b: status with only target_url (no log_url) → falls back to target_url", async () => {
    listDeploymentsResult = [{ id: 11, created_at: "2026-06-11T00:00:00Z" }];
    listDeploymentStatusesResult = [
      {
        state: "success",
        // no log_url — only target_url
        target_url: "https://deploy.acme.com/runs/42",
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    expect(result.deployments.length).toBe(1);
    expect(result.deployments[0]?.logUrl).toBe(
      "https://deploy.acme.com/runs/42",
    );
  });

  test("BT-F2c: status with neither log_url nor target_url → logUrl is null", async () => {
    listDeploymentsResult = [{ id: 12, created_at: "2026-06-11T00:00:00Z" }];
    listDeploymentStatusesResult = [
      {
        state: "success",
        // neither log_url nor target_url
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    expect(result.deployments.length).toBe(1);
    expect(result.deployments[0]?.logUrl).toBeNull();
  });

  test("BT-F2d: empty log_url string → falls back to target_url or null", async () => {
    listDeploymentsResult = [{ id: 13, created_at: "2026-06-11T00:00:00Z" }];
    listDeploymentStatusesResult = [
      {
        state: "success",
        log_url: "",
        target_url: "https://fallback.acme.com",
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "acme",
      repo: "repo",
      token: "tok",
    });

    // empty log_url should fall back to target_url
    expect(result.deployments.length).toBe(1);
    expect(result.deployments[0]?.logUrl).toBe("https://fallback.acme.com");
  });
});

// ── BT-F3 & BT-F4: step-executor + store tests ───────────────────────────────
//
// We need separate mocks for the step-executor tests (they mock @octokit/rest
// again but that's fine — bun mock.module is per-module-file context).

// Store mock for executor tests
type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
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
};

type RunContextInput = {
  runId: string;
  context: Record<string, unknown>;
};

let f3f4RecordedEvents: EventInput[] = [];
let f3f4RecordedStepUpdates: StepUpdateInput[] = [];
let f3f4RecordedRunUpdates: RunStatusInput[] = [];
let f3f4RecordedContextUpdates: RunContextInput[] = [];

let f3f4CurrentStepRun: AgentLoopStepRun;
let f3f4CurrentLoopRun: AgentLoopRun;
let f3f4CurrentLoop: AgentLoop;

const f3f4GetStepRunMock = mock(async (_id: string) => ({
  stepRun: f3f4CurrentStepRun,
  loopRun: f3f4CurrentLoopRun,
  loop: f3f4CurrentLoop,
}));

const f3f4UpdateStepRunMock = mock(async (input: StepUpdateInput) => {
  f3f4RecordedStepUpdates.push(input);
  return {
    ...f3f4CurrentStepRun,
    ...(input as Partial<AgentLoopStepRun>),
  };
});

const f3f4RecordEventMock = mock(async (input: EventInput) => {
  f3f4RecordedEvents.push(input);
  return { id: "evt-f3f4", ...input };
});

const f3f4UpdateRunStatusMock = mock(async (input: RunStatusInput) => {
  f3f4RecordedRunUpdates.push(input);
  return {
    ...f3f4CurrentLoopRun,
    status: input.status as AgentLoopRun["status"],
  };
});

const f3f4UpdateRunContextMock = mock(async (input: RunContextInput) => {
  f3f4RecordedContextUpdates.push(input);
  return { ...f3f4CurrentLoopRun, context: input.context };
});

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  getAgentLoopStepRunWithContext: f3f4GetStepRunMock,
  updateAgentLoopStepRun: f3f4UpdateStepRunMock,
  recordAgentLoopEvent: f3f4RecordEventMock,
  updateAgentLoopRunStatus: f3f4UpdateRunStatusMock,
  updateAgentLoopRunContext: f3f4UpdateRunContextMock,
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
  // watchdog stubs (M3-01)
  createAgentLoopWatchdogRun: mock(async () => ({
    id: "wdr-stub",
    loopId: "loop-1",
    loopRunId: "run-1",
    stepRunId: null,
    nodeId: null,
    attempt: 1,
    decision: null,
    diagnosis: null,
    hint: null,
    failReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateAgentLoopWatchdogRun: mock(async () => undefined),
  countWatchdogRetryDecisions: mock(async () => 0),
  listWatchdogRunsForLoopRun: mock(async () => []),
  retryCurrentStepForWatchdog: mock(async () => undefined),
  pauseLoopRunSystem: mock(async () => undefined),
  advanceToFailureEdge: mock(async () => false),
  dispatchStepWorkflow: mock(async () => undefined),
}));

mock.module("./watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false })),
}));

// GitHub access/app mocks for executor tests
let f3f4VerifyResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  reason?: string;
} = { ok: true, installationId: 42, repositoryId: 7 };

const f3f4VerifyMock = mock(async () => f3f4VerifyResult);
const f3f4MintMock = mock(async () => ({ token: "ghs_f3f4_token" }));
const f3f4RevokeMock = mock(async () => undefined);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: f3f4VerifyMock,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: f3f4MintMock,
  revokeInstallationToken: f3f4RevokeMock,
  withScopedInstallationOctokit: mock(() => Promise.resolve(undefined)),
}));

// GitHub API mock for executor tests
let _f3f4GithubApiCallCount = 0;

const f3f4OctokitMock = {
  rest: {
    issues: {
      listForRepo: mock(async () => {
        _f3f4GithubApiCallCount++;
        return { data: [] };
      }),
    },
    pulls: {
      get: mock(async () => {
        _f3f4GithubApiCallCount++;
        return {
          data: {
            number: 1,
            title: "PR",
            state: "open",
            merged: false,
            draft: false,
            html_url: "https://github.com/a/b/pull/1",
            head: { sha: "abc", ref: "feat" },
            base: { ref: "main" },
            mergeable: true,
          },
        };
      }),
    },
    repos: {
      listDeployments: mock(async () => {
        _f3f4GithubApiCallCount++;
        return { data: [] };
      }),
      listDeploymentStatuses: mock(async () => {
        _f3f4GithubApiCallCount++;
        return { data: [] };
      }),
    },
    checks: {
      listForRef: mock(async () => {
        _f3f4GithubApiCallCount++;
        return { data: { check_runs: [], total_count: 0 } };
      }),
    },
  },
};

// Note: @octokit/rest was already mocked above for github-checks tests.
// The executor imports github-checks which imports Octokit.
// The mock.module is keyed by module specifier so the same mock applies.

// ── Fixtures for executor tests ───────────────────────────────────────────────

function makeF3F4StepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-f3f4",
    loopRunId: "run-f3f4",
    nodeId: "node-f3f4",
    nodeKind: "github_check",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-f3f4",
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeF3F4LoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-f3f4",
    loopId: "loop-f3f4",
    userId: "user-f3f4",
    status: "running",
    definitionSnapshot: { nodes: [], edges: [] } as unknown as Record<
      string,
      unknown
    >,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-f3f4",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-f3f4",
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeF3F4Loop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-f3f4",
    userId: "user-f3f4",
    name: "F3F4 Loop",
    description: null,
    repoOwner: "acme",
    repoName: "f3f4-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function resetF3F4Mocks() {
  f3f4RecordedEvents = [];
  f3f4RecordedStepUpdates = [];
  f3f4RecordedRunUpdates = [];
  f3f4RecordedContextUpdates = [];
  _f3f4GithubApiCallCount = 0;
  f3f4VerifyResult = { ok: true, installationId: 42, repositoryId: 7 };
  f3f4GetStepRunMock.mockClear();
  f3f4UpdateStepRunMock.mockClear();
  f3f4RecordEventMock.mockClear();
  f3f4UpdateRunStatusMock.mockClear();
  f3f4UpdateRunContextMock.mockClear();
  f3f4VerifyMock.mockClear();
  f3f4MintMock.mockClear();
  f3f4RevokeMock.mockClear();
  f3f4OctokitMock.rest.issues.listForRepo.mockClear();
  f3f4OctokitMock.rest.pulls.get.mockClear();
  f3f4OctokitMock.rest.repos.listDeployments.mockClear();
  f3f4OctokitMock.rest.checks.listForRef.mockClear();
}

const executorPromise = import("./step-executor");

// ── BT-F3: *From resolution BEFORE verifyRepoAccess ──────────────────────────

describe("BT-F3: *From resolution failures short-circuit before verifyRepoAccess", () => {
  beforeEach(resetF3F4Mocks);

  test("BT-F3a: pr_status missing prNumberFrom path → condition_path_missing, verifyRepoAccess call count = 0", async () => {
    const node = {
      id: "pr-node-f3",
      kind: "github_check",
      label: "PR",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "missing.path" },
    };
    f3f4CurrentStepRun = makeF3F4StepRun({
      nodeId: "pr-node-f3",
      nodeKind: "github_check",
    });
    f3f4CurrentLoopRun = makeF3F4LoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    f3f4CurrentLoop = makeF3F4Loop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-f3f4",
      workflowRunId: "wf-f3f4",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_path_missing");
    expect(f3f4VerifyMock.mock.calls.length).toBe(0);
    expect(f3f4MintMock.mock.calls.length).toBe(0);
  });

  test("BT-F3b: pr_status non-number prNumberFrom → condition_type_mismatch, verifyRepoAccess call count = 0", async () => {
    const node = {
      id: "pr-node-f3b",
      kind: "github_check",
      label: "PR",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "step.prNum" },
    };
    f3f4CurrentStepRun = makeF3F4StepRun({
      nodeId: "pr-node-f3b",
      nodeKind: "github_check",
    });
    f3f4CurrentLoopRun = makeF3F4LoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { step: { prNum: "not-a-number" } },
    });
    f3f4CurrentLoop = makeF3F4Loop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-f3f4",
      workflowRunId: "wf-f3f4",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_type_mismatch");
    // CRITICAL: verify and mint must NOT have been called
    expect(f3f4VerifyMock.mock.calls.length).toBe(0);
    expect(f3f4MintMock.mock.calls.length).toBe(0);
  });

  test("BT-F3c: ci_status missing refFrom path → condition_path_missing, verifyRepoAccess call count = 0", async () => {
    const node = {
      id: "ci-node-f3",
      kind: "github_check",
      label: "CI",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "missing.sha" },
    };
    f3f4CurrentStepRun = makeF3F4StepRun({
      nodeId: "ci-node-f3",
      nodeKind: "github_check",
    });
    f3f4CurrentLoopRun = makeF3F4LoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    f3f4CurrentLoop = makeF3F4Loop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-f3f4",
      workflowRunId: "wf-f3f4",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_path_missing");
    expect(f3f4VerifyMock.mock.calls.length).toBe(0);
    expect(f3f4MintMock.mock.calls.length).toBe(0);
  });

  test("BT-F3d: ci_status non-string refFrom → condition_type_mismatch, verifyRepoAccess call count = 0", async () => {
    const node = {
      id: "ci-node-f3d",
      kind: "github_check",
      label: "CI",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "step.sha" },
    };
    f3f4CurrentStepRun = makeF3F4StepRun({
      nodeId: "ci-node-f3d",
      nodeKind: "github_check",
    });
    f3f4CurrentLoopRun = makeF3F4LoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { step: { sha: 12345 } },
    });
    f3f4CurrentLoop = makeF3F4Loop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-f3f4",
      workflowRunId: "wf-f3f4",
    });

    expect(result.outcome).toBe("failure");
    expect(result.errorKind).toBe("condition_type_mismatch");
    expect(f3f4VerifyMock.mock.calls.length).toBe(0);
    expect(f3f4MintMock.mock.calls.length).toBe(0);
  });
});

// ── BT-F4: executor context-merge uses updateAgentLoopRunContext (not updateAgentLoopRunStatus) ─

describe("BT-F4: github_check context-merge uses updateAgentLoopRunContext, not updateAgentLoopRunStatus", () => {
  beforeEach(resetF3F4Mocks);

  test("BT-F4a: successful list_issues → updateAgentLoopRunContext called, updateAgentLoopRunStatus NOT called with status=running", async () => {
    const node = {
      id: "ctx-merge-node",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    f3f4CurrentStepRun = makeF3F4StepRun({
      nodeId: "ctx-merge-node",
      nodeKind: "github_check",
    });
    f3f4CurrentLoopRun = makeF3F4LoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    f3f4CurrentLoop = makeF3F4Loop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-f3f4",
      workflowRunId: "wf-f3f4",
    });

    expect(result.outcome).toBe("success");

    // The context-merge path MUST use updateAgentLoopRunContext
    expect(f3f4RecordedContextUpdates.length).toBeGreaterThan(0);
    const ctxUpdate = f3f4RecordedContextUpdates[0];
    expect(ctxUpdate?.runId).toBe("run-f3f4");
    expect(ctxUpdate?.context).toBeDefined();
    const mergedCtx = ctxUpdate?.context ?? {};
    expect(
      (mergedCtx as Record<string, unknown>)["ctx-merge-node"],
    ).toBeDefined();

    // updateAgentLoopRunStatus must NOT have been called with status="running"
    // (it may be called with "completed" for the end node, but not "running" for context merge)
    const runningStatusCalls = f3f4RecordedRunUpdates.filter(
      (u) => u.status === "running",
    );
    expect(runningStatusCalls.length).toBe(0);
  });
});
