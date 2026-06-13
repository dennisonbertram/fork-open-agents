/**
 * Agent Loops step-executor regression tests — covers angles that would
 * break if the implementation in feat: TASK-323 were reverted or degraded.
 *
 * Scenarios:
 *   REG-001: *From paths must be resolved BEFORE any GitHub API call.
 *            If the lookup is moved after the API call the mock-call-count
 *            assertion would fail.
 *   REG-002: run context is updated when github_check succeeds.
 *            If mergeStepOutput/updateAgentLoopRunStatus were removed the
 *            contextUpdate assertion fails.
 *   REG-003: end node must NOT update run status to any non-completed value.
 *   REG-004: condition node must not call any GitHub helper.
 *   REG-005: step.started correlation fields must include workflowRunId
 *            (previously absent in early drafts of the spec).
 *   REG-006: github_check_failed error kind propagates to both the step
 *            row and the step.failed event payload.
 *   REG-007: list_issues output openIssueCount equals the length of the
 *            returned issues slice, not a separate API field.
 *   REG-008: token is not persisted raw in step output for any check kind.
 */

import { describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Store + GitHub mocks (same pattern as step-executor.test.ts) ──────────────

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
};

type RunContextInput = {
  runId: string;
  context: Record<string, unknown>;
};

let recordedEvents: EventInput[] = [];
let recordedStepUpdates: StepUpdateInput[] = [];
let recordedRunUpdates: RunStatusInput[] = [];
let recordedContextUpdates: RunContextInput[] = [];

let currentStepRun: AgentLoopStepRun;
let currentLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;

const getAgentLoopStepRunMock = mock(async (_id: string) => ({
  stepRun: currentStepRun,
  loopRun: currentLoopRun,
  loop: currentLoop,
}));

const updateAgentLoopStepRunMock = mock(async (input: StepUpdateInput) => {
  recordedStepUpdates.push(input);
  return { ...currentStepRun, ...(input as Partial<AgentLoopStepRun>) };
});

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: "evt-reg", ...input };
});

const updateAgentLoopRunStatusMock = mock(async (input: RunStatusInput) => {
  recordedRunUpdates.push(input);
  return {
    ...currentLoopRun,
    status: input.status as AgentLoopRun["status"],
  };
});

const updateAgentLoopRunContextMock = mock(async (input: RunContextInput) => {
  recordedContextUpdates.push(input);
  return { ...currentLoopRun, context: input.context };
});

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getAgentLoopStepRunMock,
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  updateAgentLoopRunContext: updateAgentLoopRunContextMock,
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

// Access + app mocks
let verifyRepoAccessResult: {
  ok: boolean;
  installationId?: number;
  repositoryId?: number;
  defaultBranch?: string;
  reason?: string;
} = { ok: true, installationId: 42, repositoryId: 7, defaultBranch: "main" };

const verifyRepoAccessMock = mock(async () => verifyRepoAccessResult);
const mintInstallationTokenMock = mock(async () => ({
  token: "ghs_reg_token",
}));
const revokeInstallationTokenMock = mock(async () => undefined);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessMock,
}));
mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mintInstallationTokenMock,
  revokeInstallationToken: revokeInstallationTokenMock,
  // agent-step.ts (loaded via step-executor.ts) imports this; bun's
  // mock.module replaces the whole module, so the export must exist here.
  withScopedInstallationOctokit: mock(() => Promise.resolve(undefined)),
}));

// GitHub API mocks
let githubApiCallCount = 0;
let issueListThrows: Error | null = null;
let issueListResult: unknown[] = [];

const octokitMock = {
  rest: {
    issues: {
      listForRepo: mock(async () => {
        githubApiCallCount++;
        if (issueListThrows) throw issueListThrows;
        return { data: issueListResult };
      }),
    },
    pulls: {
      get: mock(async () => {
        githubApiCallCount++;
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
        githubApiCallCount++;
        return { data: [] };
      }),
      listDeploymentStatuses: mock(async () => {
        githubApiCallCount++;
        return { data: [] };
      }),
    },
    checks: {
      listForRef: mock(async () => {
        githubApiCallCount++;
        return { data: { check_runs: [], total_count: 0 } };
      }),
    },
  },
};

mock.module("@octokit/rest", () => ({
  Octokit: mock(function () {
    return octokitMock;
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-run-reg",
    loopRunId: "loop-run-reg",
    nodeId: "node-1",
    nodeKind: "github_check",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: "wf-reg",
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
    id: "loop-run-reg",
    loopId: "loop-reg",
    userId: "user-reg",
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
    idempotencyKey: "idem-reg",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "wf-reg",
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
    id: "loop-reg",
    userId: "user-reg",
    name: "Regression Loop",
    description: null,
    repoOwner: "acme",
    repoName: "reg-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: { github: { issues: "read" } },
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function resetMocks() {
  recordedEvents = [];
  recordedStepUpdates = [];
  recordedRunUpdates = [];
  recordedContextUpdates = [];
  githubApiCallCount = 0;
  issueListThrows = null;
  issueListResult = [];
  verifyRepoAccessResult = {
    ok: true,
    installationId: 42,
    repositoryId: 7,
    defaultBranch: "main",
  };
  getAgentLoopStepRunMock.mockClear();
  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  updateAgentLoopRunContextMock.mockClear();
  verifyRepoAccessMock.mockClear();
  mintInstallationTokenMock.mockClear();
  revokeInstallationTokenMock.mockClear();
  octokitMock.rest.issues.listForRepo.mockClear();
  octokitMock.rest.pulls.get.mockClear();
  octokitMock.rest.repos.listDeployments.mockClear();
  octokitMock.rest.checks.listForRef.mockClear();
}

const executorPromise = import("./step-executor");

// ── REG-001: *From path missing halts BEFORE any API call ─────────────────────

describe("REG-001: *From path missing halts before API call", () => {
  test("pr_status with missing prNumberFrom context path: zero API calls", async () => {
    resetMocks();
    const node = {
      id: "pr-node",
      kind: "github_check",
      label: "PR",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "missing.path" },
    };
    currentStepRun = makeStepRun({
      nodeId: "pr-node",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    // No GitHub API calls must have been made at all
    expect(githubApiCallCount).toBe(0);
    expect(result.errorKind).toBe("condition_path_missing");
  });

  test("ci_status with missing refFrom context path: zero API calls", async () => {
    resetMocks();
    const node = {
      id: "ci-node",
      kind: "github_check",
      label: "CI",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "step.sha" },
    };
    currentStepRun = makeStepRun({
      nodeId: "ci-node",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: {},
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    expect(githubApiCallCount).toBe(0);
    expect(result.errorKind).toBe("condition_path_missing");
  });
});

// ── REG-002: context is persisted after github_check success ──────────────────

describe("REG-002: run context updated after github_check", () => {
  test("list_issues success: updateAgentLoopRunContext called with new context", async () => {
    resetMocks();
    issueListResult = [
      {
        number: 10,
        title: "Open issue",
        labels: [],
        html_url: "https://github.com/acme/reg-repo/issues/10",
      },
    ];
    const node = {
      id: "issues-node",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    currentStepRun = makeStepRun({
      nodeId: "issues-node",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    // Context must be persisted via the dedicated updateAgentLoopRunContext function
    expect(recordedContextUpdates.length).toBeGreaterThan(0);
    const ctxUpdate = recordedContextUpdates[0];
    expect(ctxUpdate).toBeDefined();

    // The context must contain the check node's output
    const nodeCtx = ctxUpdate?.context?.["issues-node"] as
      | Record<string, unknown>
      | undefined;
    expect(nodeCtx).toBeDefined();
    expect(nodeCtx?.["openIssueCount"]).toBe(1);
  });
});

// ── REG-003: end node sets run status to exactly "completed" ──────────────────

describe("REG-003: end node sets run to completed", () => {
  test("run status update must be 'completed', not any other value", async () => {
    resetMocks();
    const node = {
      id: "end-1",
      kind: "end",
      label: "End",
      position: { x: 0, y: 0 },
    };
    currentStepRun = makeStepRun({ nodeId: "end-1", nodeKind: "end" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    // All run status updates must only set 'completed' (not 'failed' or 'running')
    for (const update of recordedRunUpdates) {
      expect(update.status).toBe("completed");
    }
  });
});

// ── REG-004: condition node calls no GitHub helper ─────────────────────────────

describe("REG-004: condition node is pure — no GitHub calls", () => {
  test("condition evaluation must not call verifyRepoAccess or Octokit", async () => {
    resetMocks();
    const node = {
      id: "cond-1",
      kind: "condition",
      label: "Condition",
      position: { x: 0, y: 0 },
      condition: { path: "issues.openIssueCount", op: "gt", value: 0 },
    };
    currentStepRun = makeStepRun({ nodeId: "cond-1", nodeKind: "condition" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { issues: { openIssueCount: 5 } },
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    expect(result.outcome).toBe("true");
    expect(verifyRepoAccessMock.mock.calls.length).toBe(0);
    expect(githubApiCallCount).toBe(0);
  });
});

// ── REG-005: step.started event includes workflowRunId ────────────────────────

describe("REG-005: step.started event includes workflowRunId", () => {
  test("workflowRunId present in step.started event payload", async () => {
    resetMocks();
    const node = {
      id: "start-1",
      kind: "start",
      label: "Start",
      position: { x: 0, y: 0 },
    };
    currentStepRun = makeStepRun({ nodeId: "start-1", nodeKind: "start" });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    const startedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.started",
    );
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.workflowRunId).toBe("wf-reg");
  });
});

// ── REG-006: github_check_failed propagates to step row AND event payload ──────

describe("REG-006: github_check_failed propagates consistently", () => {
  test("step row errorKind and event payload errorKind both say github_check_failed", async () => {
    resetMocks();
    issueListThrows = new Error("Simulated GitHub 500");
    const node = {
      id: "check-fail-1",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    currentStepRun = makeStepRun({
      nodeId: "check-fail-1",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    const failedUpdate = recordedStepUpdates.find((u) => u.status === "failed");
    expect(failedUpdate?.errorKind).toBe("github_check_failed");

    const failedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.step.failed",
    );
    const payload = failedEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["errorKind"]).toBe("github_check_failed");
  });
});

// ── REG-007: openIssueCount equals the length of the issues slice ─────────────

describe("REG-007: openIssueCount == issues.length", () => {
  test("when API returns 3 issues, openIssueCount is 3", async () => {
    resetMocks();
    issueListResult = [
      {
        number: 1,
        title: "A",
        labels: [],
        html_url: "https://github.com/a/b/issues/1",
      },
      {
        number: 2,
        title: "B",
        labels: [],
        html_url: "https://github.com/a/b/issues/2",
      },
      {
        number: 3,
        title: "C",
        labels: [],
        html_url: "https://github.com/a/b/issues/3",
      },
    ];
    const node = {
      id: "issues-count",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    currentStepRun = makeStepRun({
      nodeId: "issues-count",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    const succeeded = recordedStepUpdates.find((u) => u.status === "succeeded");
    const output = succeeded?.stepOutput as Record<string, unknown> | undefined;
    const issues = output?.["issues"] as unknown[] | undefined;
    expect(output?.["openIssueCount"]).toBe(issues?.length);
  });
});

// ── REG-NEW-009: invalid *From types never reach the GitHub API ───────────────

describe("REG-009: invalid *From types never reach the GitHub API", () => {
  test("string at prNumberFrom → no API call (would be /pulls/NaN if coerced)", async () => {
    resetMocks();
    const node = {
      id: "pr-type-reg",
      kind: "github_check",
      label: "PR",
      position: { x: 0, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "step.pr" },
    };
    currentStepRun = makeStepRun({
      nodeId: "pr-type-reg",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { step: { pr: "not-a-number" } },
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    expect(result.errorKind).toBe("condition_type_mismatch");
    // Zero GitHub API calls: if this fails, the guard was removed
    expect(githubApiCallCount).toBe(0);
    // Must also not call pulls.get (extra belt-and-suspenders check)
    expect(octokitMock.rest.pulls.get.mock.calls.length).toBe(0);
  });

  test("object at refFrom → no API call (would be /commits/[object Object] if coerced)", async () => {
    resetMocks();
    const node = {
      id: "ci-type-reg",
      kind: "github_check",
      label: "CI",
      position: { x: 0, y: 0 },
      check: { kind: "ci_status", refFrom: "step.sha" },
    };
    currentStepRun = makeStepRun({
      nodeId: "ci-type-reg",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
      context: { step: { sha: { nested: "bad" } } },
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    expect(result.errorKind).toBe("condition_type_mismatch");
    expect(githubApiCallCount).toBe(0);
    expect(octokitMock.rest.checks.listForRef.mock.calls.length).toBe(0);
  });

  test("no-check config guard fires before verifyRepoAccess — access + mint are uncalled", async () => {
    resetMocks();
    // Node with no 'check' field — misconfigured
    const node = {
      id: "no-check-reg",
      kind: "github_check",
      label: "Bad",
      position: { x: 0, y: 0 },
    };
    currentStepRun = makeStepRun({
      nodeId: "no-check-reg",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    expect(result.errorKind).toBe("loop_invalid");
    // If the guard ordering was reverted, these would be non-zero
    expect(verifyRepoAccessMock.mock.calls.length).toBe(0);
    expect(mintInstallationTokenMock.mock.calls.length).toBe(0);
  });
});

// ── REG-008: token not in stepOutput for any check kind ──────────────────────

describe("REG-008: installation token absent from step output", () => {
  test("list_issues step output does not contain the minted token string", async () => {
    resetMocks();
    issueListResult = [
      {
        number: 1,
        title: "Issue 1",
        labels: [],
        html_url: "https://github.com/acme/reg-repo/issues/1",
      },
    ];
    const node = {
      id: "check-token",
      kind: "github_check",
      label: "Issues",
      position: { x: 0, y: 0 },
      check: { kind: "list_issues" },
    };
    currentStepRun = makeStepRun({
      nodeId: "check-token",
      nodeKind: "github_check",
    });
    currentLoopRun = makeLoopRun({
      definitionSnapshot: { nodes: [node], edges: [] } as unknown as Record<
        string,
        unknown
      >,
    });
    currentLoop = makeLoop();

    const { executeAgentLoopStep } = await executorPromise;
    await executeAgentLoopStep({
      stepRunId: "step-run-reg",
      workflowRunId: "wf-reg",
    });

    const tokenValue = "ghs_reg_token";
    for (const update of recordedStepUpdates) {
      const serialized = JSON.stringify(update.stepOutput ?? {});
      expect(serialized).not.toContain(tokenValue);
    }
  });
});
