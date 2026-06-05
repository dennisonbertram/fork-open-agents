/**
 * Tests for the deterministic run-summary builder (#163).
 * Tests are intentionally RED before implementation.
 */
import { describe, expect, test } from "bun:test";

// Import the builder — this module does not exist yet, so all tests fail.
import {
  buildRunSummary,
  type RunSummaryArtifact,
  type RunSummary,
} from "./run-summary";

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

type MinimalRun = {
  id: string;
  status: "succeeded" | "failed" | "skipped" | "cancelled";
  repoOwner: string;
  repoName: string;
  outputKind: string | null;
  outputUrl: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  errorKind: string | null;
  errorMessage: string | null;
};

type MinimalEvent = {
  id: string;
  eventName: string;
  status: string;
  level: string;
  summary: string | null;
  errorKind: string | null;
  payload: Record<string, unknown>;
};

type MinimalOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  prNumber: number | null;
};

function makeRun(overrides: Partial<MinimalRun> = {}): MinimalRun {
  return {
    id: "run-1",
    status: "succeeded",
    repoOwner: "acme",
    repoName: "widgets",
    outputKind: null,
    outputUrl: null,
    prNumber: null,
    issueNumber: null,
    errorKind: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeCheckEvent(success: boolean): MinimalEvent {
  return {
    id: "ev-check",
    eventName: success
      ? "background-agent.check.completed"
      : "background-agent.check.completed",
    status: success ? "succeeded" : "failed",
    level: success ? "info" : "warn",
    summary: success
      ? "Command passed: bun --bun run ci"
      : "Command failed: bun --bun run ci",
    errorKind: success ? null : "checks_failed",
    payload: { command: "bun --bun run ci" },
  };
}

// ---------------------------------------------------------------------------
// BT-001: Success run with check event and PR output
// ---------------------------------------------------------------------------

describe("buildRunSummary", () => {
  test("BT-001: success run — headline says succeeded, artifacts include PR", () => {
    const run = makeRun({
      status: "succeeded",
      outputKind: "ready_pr",
      outputUrl: "https://github.com/acme/widgets/pull/42",
      prNumber: null,
    });
    const events: MinimalEvent[] = [makeCheckEvent(true)];
    const outputs: MinimalOutput[] = [
      {
        id: "out-1",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
        prNumber: 42,
      },
    ];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.headline).toContain("succeeded");
    expect(summary.artifacts.length).toBe(1);
    const artifact: RunSummaryArtifact = summary.artifacts[0]!;
    expect(artifact.kind).toBe("ready_pr");
    expect(artifact.prNumber).toBe(42);
    expect(artifact.url).toBe("https://github.com/acme/widgets/pull/42");
  });

  // ---------------------------------------------------------------------------
  // BT-002: Failure run — summary explains failure and preserves errorKind
  // ---------------------------------------------------------------------------

  test("BT-002: failure run — headline says failed, blocked lists errorKind", () => {
    const run = makeRun({
      status: "failed",
      errorKind: "checks_failed",
      errorMessage: "Required background-agent check failed.",
    });
    const events: MinimalEvent[] = [makeCheckEvent(false)];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.headline).toContain("failed");
    expect(summary.blocked.length).toBeGreaterThan(0);
    expect(summary.blocked.some((b) => b.includes("checks_failed"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // BT-003: Blocked/checks-failed run
  // ---------------------------------------------------------------------------

  test("BT-003: checks-failed run — blocked array references the error kind", () => {
    const run = makeRun({
      status: "failed",
      errorKind: "checks_failed",
      errorMessage: "Required background-agent check failed.",
    });
    const events: MinimalEvent[] = [
      {
        id: "ev-fail",
        eventName: "background-agent.run.failed",
        status: "failed",
        level: "warn",
        summary: "Required background-agent check failed.",
        errorKind: "checks_failed",
        payload: {},
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.blocked.length).toBeGreaterThan(0);
    expect(summary.artifacts).toHaveLength(0);
    expect(summary.next).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // BT-004: No-output run — summary explicitly says no output created
  // ---------------------------------------------------------------------------

  test("BT-004: no-output run — summary is not blank and states no output", () => {
    const run = makeRun({ status: "succeeded", outputKind: "none" });
    const events: MinimalEvent[] = [makeCheckEvent(true)];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.headline.length).toBeGreaterThan(0);
    // Headline or checked/changed must explicitly communicate no output
    const combined = [
      summary.headline,
      ...summary.changed,
      ...summary.next,
    ].join(" ");
    expect(combined.toLowerCase()).toMatch(/no output|no changes/);
  });

  // ---------------------------------------------------------------------------
  // BT-005: Artifact-output run — artifacts include the output link/PR number
  // ---------------------------------------------------------------------------

  test("BT-005: artifact-output run — artifacts contain url and label", () => {
    const run = makeRun({
      status: "succeeded",
      outputKind: "ready_pr",
      outputUrl: "https://github.com/acme/widgets/pull/7",
    });
    const events: MinimalEvent[] = [];
    const outputs: MinimalOutput[] = [
      {
        id: "out-2",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/7",
        prNumber: 7,
      },
    ];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.artifacts.length).toBe(1);
    const artifact = summary.artifacts[0]!;
    expect(artifact.url).toBe("https://github.com/acme/widgets/pull/7");
    expect(artifact.label).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // BT-006: REDACTION — raw prompt / unbounded stdout NOT present in summary
  // ---------------------------------------------------------------------------

  test("BT-006: redaction — raw prompt content does not appear in summary", () => {
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = [
      {
        id: "ev-prompt",
        eventName: "background-agent.agent.started",
        status: "running",
        level: "info",
        summary: "Background mutation agent started.",
        errorKind: null,
        // Raw instructions / prompt content — must NOT leak into summary
        payload: {
          instructions: "SECRET_PROMPT_CONTENT keep this private",
          token: "ghp_deadbeef1234secret",
        },
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    const allText = JSON.stringify(summary);
    expect(allText).not.toContain("SECRET_PROMPT_CONTENT");
    expect(allText).not.toContain("ghp_deadbeef1234secret");
  });

  test("BT-006b: redaction — long unbounded stdout is not in the summary", () => {
    const longStdout = "x".repeat(5000);
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = [
      {
        id: "ev-stdout",
        eventName: "background-agent.check.completed",
        status: "succeeded",
        level: "info",
        summary: "Command passed: bun --bun run ci",
        errorKind: null,
        payload: { command: "bun --bun run ci", stdout: longStdout },
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    const allText = JSON.stringify(summary);
    // Summary must never include raw stdout of unbounded length
    expect(allText).not.toContain(longStdout);
    // Individual strings within summary must be bounded
    const allStrings: string[] = [
      summary.headline,
      ...summary.checked,
      ...summary.changed,
      ...summary.blocked,
      ...summary.next,
      ...summary.artifacts.map((a) => a.label),
    ];
    for (const s of allStrings) {
      expect(s.length).toBeLessThanOrEqual(300);
    }
  });

  // ---------------------------------------------------------------------------
  // BT-007: Array lengths are bounded
  // ---------------------------------------------------------------------------

  test("BT-007: bounded arrays — no array in summary exceeds 20 items", () => {
    const run = makeRun({ status: "succeeded" });
    // Produce many events
    const events: MinimalEvent[] = Array.from({ length: 50 }, (_, i) => ({
      id: `ev-${i}`,
      eventName: "background-agent.check.completed",
      status: "succeeded",
      level: "info",
      summary: `Check ${i} passed`,
      errorKind: null,
      payload: { command: `check-${i}` },
    }));
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.checked.length).toBeLessThanOrEqual(20);
    expect(summary.changed.length).toBeLessThanOrEqual(20);
    expect(summary.blocked.length).toBeLessThanOrEqual(20);
    expect(summary.artifacts.length).toBeLessThanOrEqual(20);
    expect(summary.next.length).toBeLessThanOrEqual(20);
  });
});
