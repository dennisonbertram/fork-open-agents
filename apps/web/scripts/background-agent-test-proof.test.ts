import { describe, expect, test } from "bun:test";
import {
  assertTestDispatch,
  BackgroundAgentTestProofError,
  getProofConfig,
  isTerminalStatus,
  parseRunSnapshot,
  parseTestDispatchResult,
  summarizeRun,
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

  test("parses a run snapshot and exposes status/errorKind/outputUrl", () => {
    const snapshot = parseRunSnapshot({
      run: {
        id: "run-1",
        status: "failed",
        errorKind: "sandbox_unavailable",
        outputUrl: null,
      },
      events: [{ id: 1 }, { id: 2 }],
      outputs: [],
    });

    expect(snapshot.run.id).toBe("run-1");
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.errorKind).toBe("sandbox_unavailable");
    expect(snapshot.events).toHaveLength(2);
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
      outputs: [],
    };

    const summary = summarizeRun(snapshot, 5_000);
    expect(summary).toContain("failed");
    expect(summary).toContain("checks_failed");
  });
});
