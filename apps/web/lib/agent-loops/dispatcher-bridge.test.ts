/**
 * Tests for the agent-loops dispatcher bridge (TASK-326 / M1-07).
 *
 * BT-326-01: loop trigger matches + dispatches (start node step created, workflow dispatched, events recorded)
 * BT-326-02: duplicate delivery dedupes (created:false → no dispatch)
 * BT-326-03: active-run skip (loop has queued/running/paused run → skip event)
 * BT-326-04: flag-off skip (AGENT_LOOPS_ENABLED=false → no run)
 * BT-326-05: allowlist skip (repo not in AGENT_LOOPS_ALLOWED_REPOS → no run)
 * BT-326-06: inactive-loop skip (loop.status !== "active" → no run)
 * BT-326-07: invalid-definition skip (validateLoopDefinition fails → no run)
 * BT-326-08: manual start happy path
 * BT-326-09: manual start ownership fail
 * BT-326-10: manual start active-run signal (409-style)
 * BT-326-11: dispatch-throw marks the run failed with errorKind=dispatch_failed
 *             and returns a typed dispatchFailed result (issue #763 — no false success)
 * BT-326-12: cron sweep includes due loop trigger + updates nextRunAt
 * BT-326-13: agent-trigger path unchanged (existing suite behavior)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Store mocks ────────────────────────────────────────────────────────────────

let createAgentLoopRunResult: {
  run: { id: string; status: string };
  created: boolean;
} | null = { run: { id: "loop-run-1", status: "queued" }, created: true };

let hasActiveRunResult = false;
let ownedLoopResult: {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  status: string;
  definition: Record<string, unknown>;
  guardrails: null;
  permissions: Record<string, unknown>;
  name: string;
  description: null;
  createdAt: Date;
  updatedAt: Date;
} | null = null;

const createAgentLoopRun = mock(async () => createAgentLoopRunResult);
const hasActiveRunForLoop = mock(async () => hasActiveRunResult);
const getOwnedAgentLoop = mock(async () => ownedLoopResult);
const createAgentLoopStepRun = mock(
  async (_input: {
    loopRunId: string;
    nodeId: string;
    nodeKind: string;
    attempt?: number;
  }) => ({
    id: "step-run-1",
    loopRunId: "loop-run-1",
    nodeId: "start-node",
    nodeKind: "start",
    attempt: 1,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
);
const updateAgentLoopRunStatus = mock(async () => null);
const recordAgentLoopEvent = mock(async () => ({
  id: "event-1",
  loopRunId: "loop-run-1",
  eventName: "test",
  status: "info" as const,
  level: "info" as const,
  createdAt: new Date(),
}));
// setInitialStepPointer — new helper called by dispatchLoopRun after step run creation
const setInitialStepPointer = mock(
  async (_params: { runId: string; nodeId: string; stepRunId: string }) => ({
    id: "loop-run-1",
  }),
);
const conditionallyTransitionRunStatus = mock(
  async (_params: {
    runId: string;
    toStatus: string;
    fromStatuses: string[];
    errorKind?: string | null;
    errorMessage?: string | null;
  }) => ({ id: "loop-run-1", status: _params.toStatus }),
);

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoopRun,
  hasActiveRunForLoop,
  getOwnedAgentLoop,
  createAgentLoopStepRun,
  updateAgentLoopRunStatus,
  recordAgentLoopEvent,
  setInitialStepPointer,
  updateAgentLoopRunContext: mock(async () => undefined),
  conditionallyTransitionRunStatus,
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

// ── Workflow mock ─────────────────────────────────────────────────────────────

let workflowStartShouldThrow = false;
const runAgentLoopStepWorkflow = {};
const start = mock(async (_workflow: unknown, _args: unknown) => {
  if (workflowStartShouldThrow) {
    throw new Error("Workflow dispatch failed");
  }
  return { runId: "wf-run-1" };
});

mock.module("workflow/api", () => ({ start }));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow,
}));

// ── Config mocks ──────────────────────────────────────────────────────────────

let loopsEnabled = true;
let allowedRepos: string | undefined = undefined;

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => loopsEnabled,
  isAgentLoopRepoAllowed: (owner: string, repo: string) => {
    if (!allowedRepos) return true;
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    return allowedRepos
      .split(",")
      .map((s) => s.trim())
      .includes(key);
  },
}));

// ── Validation mock ───────────────────────────────────────────────────────────

let validationResult:
  | { ok: true; definition: unknown }
  | { ok: false; errors: unknown[] } = {
  ok: true,
  definition: {
    nodes: [
      {
        id: "start-node",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end-node", kind: "end", label: "End", position: { x: 100, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start-node", target: "end-node", when: "always" },
    ],
  },
};

mock.module("@/lib/agent-loops/validation", () => ({
  validateLoopDefinition: () => validationResult,
}));

// ── Import the module under test ──────────────────────────────────────────────

const bridgeModulePromise = import("./dispatcher-bridge");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validDefinition = {
  nodes: [
    {
      id: "start-node",
      kind: "start",
      label: "Start",
      position: { x: 0, y: 0 },
    },
    { id: "end-node", kind: "end", label: "End", position: { x: 100, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start-node", target: "end-node", when: "always" },
  ],
};

const activeLoop = {
  id: "loop-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: validDefinition as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "My Loop",
  description: null,
  watchdogEnabled: false,
  watchdogInstructions: null,
  watchdogRetryBudget: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const enabledTrigger = {
  id: "trigger-1",
  loopId: "loop-1",
  agentId: null,
  userId: "user-1",
  name: "PR trigger",
  kind: "github.pull_request" as const,
  status: "enabled" as const,
  conditions: {},
  schedule: null,
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const githubEvent = {
  source: "github" as const,
  kind: "github.pull_request" as const,
  externalId: "delivery-123",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "feature/test",
  prNumber: 42,
  occurredAt: "2026-06-01T00:00:00.000Z",
};

function resetMocks() {
  loopsEnabled = true;
  allowedRepos = undefined;
  workflowStartShouldThrow = false;
  hasActiveRunResult = false;
  ownedLoopResult = activeLoop;
  validationResult = {
    ok: true,
    definition: validDefinition,
  };
  createAgentLoopRunResult = {
    run: { id: "loop-run-1", status: "queued" },
    created: true,
  };
  start.mockClear();
  createAgentLoopRun.mockClear();
  hasActiveRunForLoop.mockClear();
  getOwnedAgentLoop.mockClear();
  createAgentLoopStepRun.mockClear();
  updateAgentLoopRunStatus.mockClear();
  recordAgentLoopEvent.mockClear();
  setInitialStepPointer.mockClear();
  conditionallyTransitionRunStatus.mockClear();
}

// ── BT-326-01: happy path — trigger matches, run created, workflow dispatched ──

describe("dispatchLoopRunForTrigger", () => {
  beforeEach(resetMocks);

  test("BT-326-01: loop trigger matches — creates run, step, dispatches workflow, records events", async () => {
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-001",
    });

    // Run was created
    expect(createAgentLoopRun).toHaveBeenCalledTimes(1);
    const createCall = (
      createAgentLoopRun.mock.calls[0] as unknown as [
        { idempotencyKey: string; source: string; triggerId: string },
      ]
    )[0];
    expect(createCall.idempotencyKey).toContain("loop-1");
    expect(createCall.idempotencyKey).toContain("trigger-1");
    expect(createCall.source).toBe("github");
    expect(createCall.triggerId).toBe("trigger-1");

    // Step was created
    expect(createAgentLoopStepRun).toHaveBeenCalledTimes(1);
    const stepCall = (
      createAgentLoopStepRun.mock.calls[0] as unknown as [
        { nodeId: string; nodeKind: string },
      ]
    )[0];
    expect(stepCall.nodeId).toBe("start-node");
    expect(stepCall.nodeKind).toBe("start");

    // Workflow was dispatched
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(runAgentLoopStepWorkflow, [
      { stepRunId: "step-run-1" },
    ]);

    // Events recorded
    const eventNames = (
      recordAgentLoopEvent.mock.calls as unknown as { eventName: string }[][]
    ).map((c) => c[0]!.eventName);
    expect(eventNames).toContain("agent-loop.trigger.received");
    expect(eventNames).toContain("agent-loop.run.created");
    expect(eventNames).toContain("agent-loop.chain.dispatched");

    // Result shape
    expect(result.created).toBe(true);
    expect(result.runId).toBe("loop-run-1");
    expect(result.reason).toBeUndefined();
  });

  // BT-326-02: duplicate delivery dedupes
  test("BT-326-02: duplicate delivery returns existing run without dispatching", async () => {
    createAgentLoopRunResult = {
      run: { id: "loop-run-existing", status: "queued" },
      created: false,
    };
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-002",
    });

    expect(result.created).toBe(false);
    expect(result.runId).toBe("loop-run-existing");
    // No step created, no workflow dispatched
    expect(createAgentLoopStepRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-03: active-run skip
  test("BT-326-03: skips when loop already has an active run (single-active-run rule)", async () => {
    hasActiveRunResult = true;
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-003",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();

    // Skip event recorded
    const eventNames = (
      recordAgentLoopEvent.mock.calls as unknown as { eventName: string }[][]
    ).map((c) => c[0]!.eventName);
    expect(eventNames).toContain("agent-loop.trigger.skipped_active_run");
  });

  // BT-326-04: flag-off skip
  test("BT-326-04: skips when AGENT_LOOPS_ENABLED is false", async () => {
    loopsEnabled = false;
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-004",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("feature_disabled");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-05: allowlist skip
  test("BT-326-05: skips when repo is outside AGENT_LOOPS_ALLOWED_REPOS", async () => {
    allowedRepos = "acme/other-repo";
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-005",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("repo_not_allowed");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-06: inactive-loop skip
  test("BT-326-06: skips when loop.status is not 'active'", async () => {
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: { ...activeLoop, status: "draft" as const },
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-006",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("loop_inactive");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-07: invalid-definition skip (defensive)
  test("BT-326-07: skips when definition snapshot fails validation", async () => {
    validationResult = {
      ok: false,
      errors: [
        { kind: "loop_invalid", rule: "no_start", message: "No start node" },
      ],
    };
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-007",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("loop_invalid");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-11: dispatch-throw marks the run failed (no false success)
  test("BT-326-11: workflow dispatch throws — run marked failed with errorKind=dispatch_failed, typed failure returned", async () => {
    workflowStartShouldThrow = true;
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-011",
    });

    // Result must be a typed dispatch failure, NOT { created: true }
    expect(result.created).toBeUndefined();
    expect((result as { dispatchFailed?: boolean }).dispatchFailed).toBe(true);
    expect((result as { errorKind?: string }).errorKind).toBe(
      "dispatch_failed",
    );
    expect(typeof (result as { errorMessage?: string }).errorMessage).toBe(
      "string",
    );
    expect((result as { runId?: string }).runId).toBe("loop-run-1");

    // Run row transitioned to failed with errorKind/errorMessage set
    expect(conditionallyTransitionRunStatus).toHaveBeenCalledTimes(1);
    const transitionCall = (
      conditionallyTransitionRunStatus.mock.calls[0] as unknown as [
        {
          runId: string;
          toStatus: string;
          errorKind?: string | null;
          errorMessage?: string | null;
        },
      ]
    )[0];
    expect(transitionCall.runId).toBe("loop-run-1");
    expect(transitionCall.toStatus).toBe("failed");
    expect(transitionCall.errorKind).toBe("dispatch_failed");
    expect(typeof transitionCall.errorMessage).toBe("string");

    // dispatch_failed event still fires unconditionally (audit trail)
    const eventNames = (
      recordAgentLoopEvent.mock.calls as unknown as { eventName: string }[][]
    ).map((c) => c[0]!.eventName);
    expect(eventNames).toContain("agent-loop.chain.dispatch_failed");
    expect(eventNames).not.toContain("agent-loop.chain.dispatched");
  });
});

// ── BT-326-08/09/10: manual start ────────────────────────────────────────────

describe("dispatchManualAgentLoopStart", () => {
  beforeEach(resetMocks);

  // BT-326-08: manual start happy path
  test("BT-326-08: manual start creates run with source=manual and dispatches workflow", async () => {
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-008",
    });

    expect(result.created).toBe(true);
    expect(result.runId).toBe("loop-run-1");

    const createCall = (
      createAgentLoopRun.mock.calls[0] as unknown as [
        { source: string; idempotencyKey: string },
      ]
    )[0];
    expect(createCall.source).toBe("manual");
    expect(createCall.idempotencyKey).toContain("manual");

    expect(start).toHaveBeenCalledTimes(1);
  });

  // BT-326-09: manual start ownership fail
  test("BT-326-09: manual start returns ownership_fail when loop is not owned by userId", async () => {
    ownedLoopResult = null;
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-other",
      loopId: "loop-1",
      requestId: "req-009",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("ownership_fail");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-326-10: manual start active-run signal
  test("BT-326-10: manual start returns active_run signal when a run is in progress", async () => {
    hasActiveRunResult = true;
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-010",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
  });
});

// ── BT-326-12: cron sweep includes due loop trigger ───────────────────────────
// This test is in the dispatcher-bridge context — the dispatcher integration
// tests are in dispatcher-loop-integration.test.ts (in background-agents).

// ── Agent path unchanged (BT-326-13) is covered by the existing dispatcher tests
// which must remain green without modification — they are the regression gate.

// ── REGRESSION: allowlist gate must pin to loop repo, not caller-supplied event repo ──

describe("dispatchLoopRunForTrigger — repo-pin regression", () => {
  beforeEach(resetMocks);

  /**
   * REGRESSION-326-repo-pin-001: false-skip scenario.
   *
   * The loop's repo IS in the allowlist. The caller-supplied event carries a
   * DIFFERENT repo that is NOT in the allowlist. A correct implementation gates
   * on loop.repoOwner/loop.repoName and dispatches the run. A regressed
   * implementation that uses event.repoOwner ?? loop.repoOwner would gate on
   * the caller-supplied (disallowed) repo and return repo_not_allowed — a
   * silent no-fire for a loop whose actual repo is allowed.
   */
  test("REGRESSION-326-repo-pin-001: allowlist uses loop repo even when event carries a different (blocked) repo", async () => {
    // Loop is on acme/widgets — in the allowlist.
    // Event carries a different repo (external-org/other-repo) that is NOT allowed.
    allowedRepos = "acme/widgets";
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: { ...activeLoop, repoOwner: "acme", repoName: "widgets" },
      trigger: enabledTrigger,
      event: {
        ...githubEvent,
        // Caller-supplied payload repo differs from the loop's repo
        repoOwner: "external-org",
        repoName: "other-repo",
      },
      requestId: "req-pin-001",
    });

    // Must dispatch — loop repo is allowed
    expect(result.skipped).toBeUndefined();
    expect(result.created).toBe(true);
    expect(createAgentLoopRun).toHaveBeenCalledTimes(1);
  });

  /**
   * REGRESSION-326-repo-pin-002: allowlist bypass scenario.
   *
   * The loop's repo is NOT in the allowlist. The caller supplies an event with
   * an allowlisted repo. A correct implementation gates on loop.repoOwner/
   * loop.repoName and returns repo_not_allowed. A regressed implementation
   * would use the caller-supplied (allowlisted) repo and let the run through —
   * defeating the operator rollout gate.
   */
  test("REGRESSION-326-repo-pin-002: allowlist cannot be bypassed by caller supplying an allowlisted event repo for a blocked loop", async () => {
    // Loop is on blocked-org/secret-repo — NOT in the allowlist.
    // Caller supplies event.repo = acme/widgets (which IS in the allowlist).
    allowedRepos = "acme/widgets";
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: {
        ...activeLoop,
        repoOwner: "blocked-org",
        repoName: "secret-repo",
      },
      trigger: enabledTrigger,
      event: {
        ...githubEvent,
        // Caller-supplied payload repo is allowlisted — must NOT bypass the gate
        repoOwner: "acme",
        repoName: "widgets",
      },
      requestId: "req-pin-002",
    });

    // Must be blocked — the loop's own repo is not in the allowlist
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("repo_not_allowed");
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
