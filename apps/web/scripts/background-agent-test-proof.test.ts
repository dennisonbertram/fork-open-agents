import { describe, expect, test } from "bun:test";
import {
  assertProofRun,
  assertTestDispatch,
  BackgroundAgentTestProofError,
  getProofConfig,
  isTerminalStatus,
  parseRunSnapshot,
  parseTestDispatchResult,
  summarizeRun,
  WORKFLOW_STARTED_EVENT,
  type TestDispatchResult,
  type RunSnapshot,
} from "./background-agent-test-proof";

describe("background-agent-test-proof", () => {
  test("builds a proof config from environment", () => {
    const config = getProofConfig({
      BACKGROUND_AGENT_PROOF_BASE_URL: "https://open-agents.example",
      BACKGROUND_AGENT_PROOF_AGENT_ID: "agent_123",
      BACKGROUND_AGENT_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
      BACKGROUND_AGENT_PROOF_TIMEOUT_MS: "60000",
    });

    expect(config.baseUrl.origin).toBe("https://open-agents.example");
    expect(config.agentId).toBe("agent_123");
    expect(config.cookie).toBe("open_agents_test_user_id=dev-user");
    expect(config.timeoutMs).toBe(60_000);
    expect(config.bypassSecret).toBeUndefined();
  });

  test("applies sensible defaults for timeout and poll interval", () => {
    const config = getProofConfig({
      BACKGROUND_AGENT_PROOF_BASE_URL: "http://localhost:3002",
      BACKGROUND_AGENT_PROOF_AGENT_ID: "agent_123",
      BACKGROUND_AGENT_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
    });

    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(config.pollIntervalMs).toBeGreaterThan(0);
    expect(config.timeoutMs).toBeGreaterThan(config.pollIntervalMs);
  });

  test("accepts a vercel protection bypass secret", () => {
    const config = getProofConfig({
      BACKGROUND_AGENT_PROOF_BASE_URL: "https://open-agents.example",
      BACKGROUND_AGENT_PROOF_AGENT_ID: "agent_123",
      BACKGROUND_AGENT_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
    });

    expect(config.bypassSecret).toBe("bypass-secret");
  });

  test("fails fast when required proof env is missing", () => {
    expect(() => getProofConfig({})).toThrow(BackgroundAgentTestProofError);
    expect(() =>
      getProofConfig({ BACKGROUND_AGENT_PROOF_BASE_URL: "https://x.example" }),
    ).toThrow(BackgroundAgentTestProofError);
    expect(() =>
      getProofConfig({
        BACKGROUND_AGENT_PROOF_BASE_URL: "https://x.example",
        BACKGROUND_AGENT_PROOF_AGENT_ID: "agent_1",
      }),
    ).toThrow(BackgroundAgentTestProofError);
  });

  test("rejects base URLs that are not http(s)", () => {
    expect(() =>
      getProofConfig({
        BACKGROUND_AGENT_PROOF_BASE_URL: "ftp://open-agents.example",
        BACKGROUND_AGENT_PROOF_AGENT_ID: "agent_1",
        BACKGROUND_AGENT_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
      }),
    ).toThrow(BackgroundAgentTestProofError);
  });

  test("parses a well-formed test dispatch result", () => {
    const result = parseTestDispatchResult({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
      loopRunIds: [],
    });

    expect(result.enabled).toBe(true);
    expect(result.created).toBe(1);
    expect(result.runIds).toEqual(["run-1"]);
  });

  test("rejects a malformed dispatch result", () => {
    expect(() => parseTestDispatchResult(null)).toThrow(
      BackgroundAgentTestProofError,
    );
    expect(() =>
      parseTestDispatchResult({ enabled: true, runIds: "run-1" }),
    ).toThrow(BackgroundAgentTestProofError);
    expect(() =>
      parseTestDispatchResult({
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
        runIds: ["run-1", 2],
      }),
    ).toThrow(BackgroundAgentTestProofError);
  });

  test("asserts a successful test dispatch and rejects disabled/no-work cases", () => {
    const ok: TestDispatchResult = {
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    };
    expect(() => assertTestDispatch(ok)).not.toThrow();

    expect(() => assertTestDispatch({ ...ok, enabled: false })).toThrow(
      BackgroundAgentTestProofError,
    );
    expect(() => assertTestDispatch({ ...ok, created: 0, runIds: [] })).toThrow(
      BackgroundAgentTestProofError,
    );
    expect(() => assertTestDispatch({ ...ok, matched: 0 })).toThrow(
      BackgroundAgentTestProofError,
    );
  });

  test("treats succeeded/failed/skipped/cancelled as terminal", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("skipped")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
  });

  test("parses a run snapshot and exposes status/errorKind/outputUrl + event names", () => {
    const snapshot = parseRunSnapshot({
      run: {
        id: "run-1",
        status: "failed",
        errorKind: "sandbox_unavailable",
        outputUrl: null,
      },
      events: [
        { id: 1, eventName: "background-agent.run.created" },
        { id: 2, eventName: "background-agent.workflow.started" },
        { id: 3 },
      ],
      outputs: [],
    });

    expect(snapshot.run.id).toBe("run-1");
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.errorKind).toBe("sandbox_unavailable");
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.eventNames).toEqual([
      "background-agent.run.created",
      "background-agent.workflow.started",
    ]);
    expect(snapshot.outputs).toHaveLength(0);
  });

  test("summarizeRun never leaks the cookie and includes run id, status, and event count", () => {
    const snapshot: RunSnapshot = {
      run: {
        id: "run-1",
        status: "succeeded",
        errorKind: null,
        outputUrl: "https://github.com/owner/repo/pull/42",
      },
      events: [{}, {}, {}],
      eventNames: [],
      outputs: [{ prUrl: "https://github.com/owner/repo/pull/42" }],
    };

    const summary = summarizeRun(snapshot, 12_000);

    expect(summary).toContain("run-1");
    expect(summary).toContain("succeeded");
    expect(summary).toContain("events=3");
    expect(summary).toContain("https://github.com/owner/repo/pull/42");
    expect(summary).not.toContain("open_agents_test_user_id");
    expect(summary).not.toContain("dev-user");
  });

  test("summarizeRun surfaces errorKind for failed runs", () => {
    const snapshot: RunSnapshot = {
      run: {
        id: "run-2",
        status: "failed",
        errorKind: "checks_failed",
        outputUrl: null,
      },
      events: [],
      eventNames: [],
      outputs: [],
    };

    const summary = summarizeRun(snapshot, 5_000);
    expect(summary).toContain("failed");
    expect(summary).toContain("checks_failed");
  });

  test("assertProofRun rejects workflow_failed even without REQUIRE_SUCCEEDED", () => {
    // The exact false-positive the review flagged: a broken workflow-start
    // records workflow_failed, which must not print "proof passed".
    const workflowFailed: RunSnapshot = {
      run: {
        id: "r1",
        status: "failed",
        errorKind: "workflow_failed",
        outputUrl: null,
      },
      events: [{ eventName: "background-agent.run.created" }],
      eventNames: ["background-agent.run.created"],
      outputs: [],
    };
    expect(() => assertProofRun(workflowFailed)).toThrow(
      BackgroundAgentTestProofError,
    );
  });

  test("assertProofRun rejects a terminal run with no workflow.started event", () => {
    const noStart: RunSnapshot = {
      run: { id: "r2", status: "succeeded", errorKind: null, outputUrl: null },
      events: [{ eventName: "background-agent.run.created" }],
      eventNames: ["background-agent.run.created"],
      outputs: [],
    };
    expect(() => assertProofRun(noStart)).toThrow(
      BackgroundAgentTestProofError,
    );
  });

  test("assertProofRun accepts a typed failure that still started the workflow", () => {
    // A non-workflow_failed failure (e.g. sandbox_unavailable) that recorded
    // workflow.started is real proof the path ran end-to-end.
    const typedFailure: RunSnapshot = {
      run: {
        id: "r3",
        status: "failed",
        errorKind: "sandbox_unavailable",
        outputUrl: null,
      },
      events: [
        { eventName: "background-agent.run.created" },
        { eventName: WORKFLOW_STARTED_EVENT },
      ],
      eventNames: ["background-agent.run.created", WORKFLOW_STARTED_EVENT],
      outputs: [],
    };
    expect(() => assertProofRun(typedFailure)).not.toThrow();
  });

  test("assertProofRun accepts a succeeded run that started the workflow", () => {
    const succeeded: RunSnapshot = {
      run: { id: "r4", status: "succeeded", errorKind: null, outputUrl: null },
      events: [{ eventName: WORKFLOW_STARTED_EVENT }],
      eventNames: [WORKFLOW_STARTED_EVENT],
      outputs: [],
    };
    expect(() => assertProofRun(succeeded)).not.toThrow();
  });

  test("assertProofRun honors requireSucceeded for non-succeeded runs", () => {
    const typedFailure: RunSnapshot = {
      run: {
        id: "r5",
        status: "failed",
        errorKind: "sandbox_unavailable",
        outputUrl: null,
      },
      events: [{ eventName: WORKFLOW_STARTED_EVENT }],
      eventNames: [WORKFLOW_STARTED_EVENT],
      outputs: [],
    };
    expect(() => assertProofRun(typedFailure)).not.toThrow();
    expect(() =>
      assertProofRun(typedFailure, { requireSucceeded: true }),
    ).toThrow(BackgroundAgentTestProofError);
  });

  test("assertProofRun skips the workflow.started check when events are empty", () => {
    // A snapshot with no events (e.g. a stub or partial fetch) does not fail
    // the started-event check — only workflow_failed is rejected.
    const noEvents: RunSnapshot = {
      run: { id: "r6", status: "succeeded", errorKind: null, outputUrl: null },
      events: [],
      eventNames: [],
      outputs: [],
    };
    expect(() => assertProofRun(noEvents)).not.toThrow();
  });
});
