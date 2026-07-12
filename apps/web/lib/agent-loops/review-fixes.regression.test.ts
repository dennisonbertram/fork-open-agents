/**
 * Agent Loops — regression tests for PR #344 review fixes (TASK-PR344)
 *
 * These tests lock in the behaviors fixed by the review-bot findings. Each
 * would fail if the corresponding fix were reverted.
 *
 * REG-RF1: reverting the PR filter in checkListIssues makes a mix of
 *          issues+PRs inflate openIssueCount beyond the true issue count.
 * REG-RF2: reverting the log_url mapping sets logUrl to null even when
 *          the deployment status carries a log_url field.
 * REG-RF3: *From resolution must run before verifyRepoAccess — calling
 *          verify with a missing context path would expose the token-mint
 *          code path to unchecked inputs.
 * REG-RF4: the executor context-merge must never call
 *          updateAgentLoopRunStatus with status="running" — that would
 *          reset startedAt on every github_check step, breaking duration
 *          accounting and the M1-06 wall-clock guardrail.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── REG-RF1 & REG-RF2: direct github-checks unit regressions ────────────────

let regListForRepoResult: unknown[] = [];
let regListDeploymentsResult: unknown[] = [];
let regListDeploymentStatusesResult: unknown[] = [];

const regOctokitMock = {
  rest: {
    issues: {
      listForRepo: mock(async () => ({ data: regListForRepoResult })),
    },
    repos: {
      listDeployments: mock(async () => ({ data: regListDeploymentsResult })),
      listDeploymentStatuses: mock(async () => ({
        data: regListDeploymentStatusesResult,
      })),
    },
  },
};

mock.module("@octokit/rest", () => ({
  Octokit: mock(function () {
    return regOctokitMock;
  }),
}));

function resetRegGhMocks() {
  regListForRepoResult = [];
  regListDeploymentsResult = [];
  regListDeploymentStatusesResult = [];
  regOctokitMock.rest.issues.listForRepo.mockClear();
  regOctokitMock.rest.repos.listDeployments.mockClear();
  regOctokitMock.rest.repos.listDeploymentStatuses.mockClear();
}

const githubChecksPromise = import("./github-checks");

describe("REG-RF1: checkListIssues excludes pull_request items from count and list", () => {
  beforeEach(resetRegGhMocks);

  test("mixed response: openIssueCount matches issues.length (not the full response length)", async () => {
    // 1 true issue + 2 PRs — without the fix openIssueCount would be 3
    regListForRepoResult = [
      {
        number: 1,
        title: "Bug report",
        labels: [],
        html_url: "https://github.com/a/b/issues/1",
        // no pull_request field
      },
      {
        number: 2,
        title: "Fix: bug",
        labels: [],
        html_url: "https://github.com/a/b/pull/2",
        pull_request: { url: "https://api.github.com/repos/a/b/pulls/2" },
      },
      {
        number: 3,
        title: "Add feature",
        labels: [],
        html_url: "https://github.com/a/b/pull/3",
        pull_request: { url: "https://api.github.com/repos/a/b/pulls/3" },
      },
    ];

    const { checkListIssues } = await githubChecksPromise;
    const result = await checkListIssues({
      owner: "a",
      repo: "b",
      token: "tok",
    });

    // The regression: openIssueCount must equal issues.length, not raw.length
    expect(result.openIssueCount).toBe(result.issues.length);
    // And it must be 1 (the true issue), not 3 (all items)
    expect(result.openIssueCount).toBe(1);
    // The PR numbers must not appear in issues
    const nums = result.issues.map((i) => i.number);
    expect(nums).not.toContain(2);
    expect(nums).not.toContain(3);
  });
});

describe("REG-RF2: checkDeploymentStatus maps log_url from deployment status", () => {
  beforeEach(resetRegGhMocks);

  test("logUrl is populated from log_url field when present (not hardcoded null)", async () => {
    regListDeploymentsResult = [{ id: 99, created_at: "2026-06-11T00:00:00Z" }];
    regListDeploymentStatusesResult = [
      {
        state: "success",
        log_url: "https://ci.example.com/runs/999",
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "a",
      repo: "b",
      token: "tok",
    });

    // The regression: if logUrl is hardcoded to null this fails
    expect(result.deployments[0]?.logUrl).toBe(
      "https://ci.example.com/runs/999",
    );
  });

  test("logUrl falls back to target_url when log_url is absent", async () => {
    regListDeploymentsResult = [{ id: 88, created_at: "2026-06-11T00:00:00Z" }];
    regListDeploymentStatusesResult = [
      {
        state: "failure",
        target_url: "https://app.example.com",
        // no log_url
      },
    ];

    const { checkDeploymentStatus } = await githubChecksPromise;
    const result = await checkDeploymentStatus({
      owner: "a",
      repo: "b",
      token: "tok",
    });

    expect(result.deployments[0]?.logUrl).toBe("https://app.example.com");
  });
});

// ── REG-RF3 & REG-RF4: executor regression ────────────────────────────────────

type RegEventInput = {
  loopRunId: string;
  eventName: string;
  status: string;
  [key: string]: unknown;
};
type RegStepUpdateInput = {
  stepRunId: string;
  status?: string;
  [key: string]: unknown;
};
type RegRunStatusInput = {
  runId: string;
  status: string;
  [key: string]: unknown;
};
type RegContextInput = { runId: string; context: Record<string, unknown> };

let regEvents: RegEventInput[] = [];
let regStepUpdates: RegStepUpdateInput[] = [];
let regRunStatusCalls: RegRunStatusInput[] = [];
let regContextCalls: RegContextInput[] = [];

let regCurrentStepRun: AgentLoopStepRun;
let regCurrentLoopRun: AgentLoopRun;
let regCurrentLoop: AgentLoop;

const regGetStepRunMock = mock(async (_id: string) => ({
  stepRun: regCurrentStepRun,
  loopRun: regCurrentLoopRun,
  loop: regCurrentLoop,
}));

const regUpdateStepRunMock = mock(async (input: RegStepUpdateInput) => {
  regStepUpdates.push(input);
  return { ...regCurrentStepRun, ...(input as Partial<AgentLoopStepRun>) };
});

const regRecordEventMock = mock(async (input: RegEventInput) => {
  regEvents.push(input);
  return { id: "evt-reg-rf", ...input };
});

const regUpdateRunStatusMock = mock(async (input: RegRunStatusInput) => {
  regRunStatusCalls.push(input);
  return {
    ...regCurrentLoopRun,
    status: input.status as AgentLoopRun["status"],
  };
});

const regUpdateRunContextMock = mock(async (input: RegContextInput) => {
  regContextCalls.push(input);
  return { ...regCurrentLoopRun, context: input.context };
});

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  getAgentLoopStepRunWithContext: regGetStepRunMock,
  updateAgentLoopStepRun: regUpdateStepRunMock,
  recordAgentLoopEvent: regRecordEventMock,
  updateAgentLoopRunStatus: regUpdateRunStatusMock,
  updateAgentLoopRunContext: regUpdateRunContextMock,
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

let regVerifyResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  reason?: string;
} = { ok: true, installationId: 1, repositoryId: 2 };
const regVerifyMock = mock(async () => regVerifyResult);
const regMintMock = mock(async () => ({ token: "ghs_reg_rf_tok" }));
const regRevokeMock = mock(async () => undefined);

mock.module("@/lib/github/access", () => ({ verifyRepoAccess: regVerifyMock }));
mock.module("@/lib/github/app", () => ({
  mintInstallationToken: regMintMock,
  revokeInstallationToken: regRevokeMock,
  // agent-step.ts (loaded via step-executor.ts) imports this; bun's
  // mock.module replaces the whole module, so the export must exist here.
  withScopedInstallationOctokit: mock(() => Promise.resolve(undefined)),
}));

let _regGhApiCallCount = 0;

const regExecOctokitMock = {
  rest: {
    issues: {
      listForRepo: mock(async () => {
        _regGhApiCallCount++;
        return { data: [] };
      }),
    },
    pulls: {
      get: mock(async () => {
        _regGhApiCallCount++;
        return { data: {} };
      }),
    },
    repos: {
      listDeployments: mock(async () => {
        _regGhApiCallCount++;
        return { data: [] };
      }),
      listDeploymentStatuses: mock(async () => {
        _regGhApiCallCount++;
        return { data: [] };
      }),
    },
    checks: {
      listForRef: mock(async () => {
        _regGhApiCallCount++;
        return { data: { check_runs: [], total_count: 0 } };
      }),
    },
  },
};

// Note: @octokit/rest is already mocked above for the github-checks regressions.
// The executor imports github-checks which uses the same Octokit mock.

function makeRegStepRun(o: Partial<AgentLoopStepRun> = {}): AgentLoopStepRun {
  return {
    id: "step-reg-rf",
    loopRunId: "run-reg-rf",
    nodeId: "node-reg-rf",
    nodeKind: "github_check",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-reg-rf",
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...o,
  };
}

function makeRegLoopRun(o: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-reg-rf",
    loopId: "loop-reg-rf",
    userId: "user-reg-rf",
    status: "running",
    definitionSnapshot: { nodes: [], edges: [] } as unknown as Record<
      string,
      unknown
    >,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg-rf",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-reg-rf",
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

function makeRegLoop(o: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-reg-rf",
    userId: "user-reg-rf",
    name: "Reg RF Loop",
    description: null,
    repoOwner: "acme",
    repoName: "rf-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

function resetRegExecMocks() {
  regEvents = [];
  regStepUpdates = [];
  regRunStatusCalls = [];
  regContextCalls = [];
  _regGhApiCallCount = 0;
  regVerifyResult = { ok: true, installationId: 1, repositoryId: 2 };
  regGetStepRunMock.mockClear();
  regUpdateStepRunMock.mockClear();
  regRecordEventMock.mockClear();
  regUpdateRunStatusMock.mockClear();
  regUpdateRunContextMock.mockClear();
  regVerifyMock.mockClear();
  regMintMock.mockClear();
  regRevokeMock.mockClear();
  regExecOctokitMock.rest.issues.listForRepo.mockClear();
  regExecOctokitMock.rest.pulls.get.mockClear();
  regExecOctokitMock.rest.repos.listDeployments.mockClear();
  regExecOctokitMock.rest.checks.listForRef.mockClear();
}

const executorPromise = import("./step-executor");

describe("REG-RF3: *From missing/invalid path halts before verifyRepoAccess", () => {
  beforeEach(resetRegExecMocks);

  test("pr_status missing prNumberFrom → no verifyRepoAccess call", async () => {
    const node = {
      id: "reg-pr",
      kind: "github_check",
      label: "PR",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "does.not.exist" },
    };
    regCurrentStepRun = makeRegStepRun({
      nodeId: "reg-pr",
      nodeKind: "github_check",
    });
    regCurrentLoopRun = makeRegLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    regCurrentLoop = makeRegLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-reg-rf",
      workflowRunId: "wf-reg-rf",
    });

    expect(result.errorKind).toBe("condition_path_missing");
    // If the ordering were reverted, verifyRepoAccess would be called first
    expect(regVerifyMock.mock.calls.length).toBe(0);
    expect(regMintMock.mock.calls.length).toBe(0);
  });

  test("ci_status non-string refFrom → no verifyRepoAccess call", async () => {
    const node = {
      id: "reg-ci",
      kind: "github_check",
      label: "CI",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "step.sha" },
    };
    regCurrentStepRun = makeRegStepRun({
      nodeId: "reg-ci",
      nodeKind: "github_check",
    });
    regCurrentLoopRun = makeRegLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { step: { sha: 42 } }, // number, not string
    });
    regCurrentLoop = makeRegLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-reg-rf",
      workflowRunId: "wf-reg-rf",
    });

    expect(result.errorKind).toBe("condition_type_mismatch");
    expect(regVerifyMock.mock.calls.length).toBe(0);
    expect(regMintMock.mock.calls.length).toBe(0);
  });
});

describe("REG-RF4: github_check context-merge uses updateAgentLoopRunContext — NOT updateAgentLoopRunStatus", () => {
  beforeEach(resetRegExecMocks);

  test("list_issues success: updateAgentLoopRunStatus is not called with status=running", async () => {
    const node = {
      id: "reg-issues",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    regCurrentStepRun = makeRegStepRun({
      nodeId: "reg-issues",
      nodeKind: "github_check",
    });
    regCurrentLoopRun = makeRegLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    regCurrentLoop = makeRegLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-reg-rf",
      workflowRunId: "wf-reg-rf",
    });

    expect(result.outcome).toBe("success");

    // updateAgentLoopRunContext must have been called (for context merge)
    expect(regContextCalls.length).toBe(1);

    // updateAgentLoopRunStatus must NOT have been called with status="running"
    // (only "completed" is acceptable, from end nodes)
    const runningSentinel = regRunStatusCalls.filter(
      (c) => c.status === "running",
    );
    expect(runningSentinel.length).toBe(0);
  });

  test("list_issues context-merge call carries the merged context under the node id", async () => {
    const node = {
      id: "reg-issues2",
      kind: "github_check",
      label: "Issues2",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    regCurrentStepRun = makeRegStepRun({
      nodeId: "reg-issues2",
      nodeKind: "github_check",
    });
    regCurrentLoopRun = makeRegLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { "existing-key": { value: 1 } },
    });
    regCurrentLoop = makeRegLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-reg-rf",
      workflowRunId: "wf-reg-rf",
    });

    expect(regContextCalls.length).toBe(1);
    const ctxCall = regContextCalls[0];
    // The merged context must contain the new node's output
    expect(ctxCall?.context["reg-issues2"]).toBeDefined();
    // And must preserve the existing context
    expect(ctxCall?.context["existing-key"]).toBeDefined();
  });
});
