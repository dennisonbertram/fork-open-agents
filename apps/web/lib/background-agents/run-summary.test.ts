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
    const run = makeRun({ status: "succeeded" });
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

  // ---------------------------------------------------------------------------
  // #798: warnings[] populated from warn-level Composio events, independent
  // of run.status — the gap this ticket closes: a succeeded run with a
  // silently-off Composio tool previously showed no evidence at all.
  // ---------------------------------------------------------------------------

  test("BT-008 (#798): succeeded run with a warn-level composio.off event → warnings[] non-empty", () => {
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = [
      {
        id: "ev-composio-off",
        eventName: "background-agent.composio.off",
        status: "succeeded",
        level: "warn",
        summary: null,
        errorKind: null,
        payload: { reason: "no_slugs_selected" },
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.warnings[0]).toBeTruthy();
  });

  test("BT-009 (#798): succeeded run with a composio.not_connected event → warning names the disconnected toolkits", () => {
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = [
      {
        id: "ev-composio-not-connected",
        eventName: "background-agent.composio.not_connected",
        status: "succeeded",
        level: "warn",
        summary: null,
        errorKind: null,
        payload: { disconnectedToolkits: ["slack", "gmail"] },
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.warnings.some((w) => w.includes("slack"))).toBe(true);
    expect(summary.warnings.some((w) => w.includes("gmail"))).toBe(true);
  });

  test("BT-010 (#798): failed run with a composio.error event (errorKind) → warnings[] includes the errorKind regardless of run.status", () => {
    const run = makeRun({
      status: "failed",
      errorKind: "checks_failed",
      errorMessage: "Required background-agent check failed.",
    });
    const events: MinimalEvent[] = [
      {
        id: "ev-composio-error",
        eventName: "background-agent.composio.error",
        status: "failed",
        level: "warn",
        summary: "Composio tool resolution failed.",
        errorKind: "composio_missing_api_key",
        payload: {},
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(
      summary.warnings.some((w) => w.includes("composio_missing_api_key")),
    ).toBe(true);
  });

  test("BT-011 (#798): non-Composio warn-level events do not populate warnings[] (scope guard)", () => {
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = [
      {
        id: "ev-unrelated-warn",
        eventName: "background-agent.git.branch.resolved",
        status: "succeeded",
        level: "warn",
        summary: "Some unrelated warning",
        errorKind: null,
        payload: {},
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.warnings).toHaveLength(0);
  });

  test("BT-012 (#798): run failed before any Composio event was ever recorded → next[] states tools were never resolved, not that they failed", () => {
    const run = makeRun({
      status: "failed",
      errorKind: "sandbox_unavailable",
      errorMessage: "Sandbox failed to start.",
    });
    const events: MinimalEvent[] = [];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    // No composio-prefixed event exists, so summary must not claim tools failed.
    const combined = [...summary.warnings, ...summary.next].join(" ");
    expect(combined.toLowerCase()).toContain("never");
  });

  test("BT-013 (#798): warnings[] respects the 20-item cap and 300-char truncation like every other summary array", () => {
    const run = makeRun({ status: "succeeded" });
    const events: MinimalEvent[] = Array.from({ length: 30 }, (_, i) => ({
      id: `ev-warn-${i}`,
      eventName: "background-agent.composio.off",
      status: "succeeded",
      level: "warn",
      summary: null,
      errorKind: null,
      payload: { reason: "no_slugs_selected" as const },
    }));
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    expect(summary.warnings.length).toBeLessThanOrEqual(20);
    for (const w of summary.warnings) {
      expect(w.length).toBeLessThanOrEqual(300);
    }
  });

  // ---------------------------------------------------------------------------
  // Regression (#798): warnings[] and blocked[] must stay independent arrays.
  // A failed run with BOTH a genuine failure errorKind event AND a Composio
  // warn event must not cross-contaminate: the Composio warning belongs only
  // in warnings[], the failure errorKind belongs only in blocked[]. This is
  // a different angle from BT-008..BT-011 (which test each array alone) —
  // it catches a future change that merges the two computations into one
  // loop and forgets the level/eventName filter on one side.
  // ---------------------------------------------------------------------------
  test("REGRESSION (#798): failed run with both a failure event and a composio warning keeps warnings[] and blocked[] independent", () => {
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
      {
        id: "ev-composio-off",
        eventName: "background-agent.composio.off",
        status: "succeeded",
        level: "warn",
        summary: null,
        errorKind: null,
        payload: { reason: "no_slugs_selected" },
      },
    ];
    const outputs: MinimalOutput[] = [];

    const summary: RunSummary = buildRunSummary({ run, events, outputs });

    // blocked[] carries the real failure reason, not the composio warning.
    expect(summary.blocked.some((b) => b.includes("checks_failed"))).toBe(true);
    expect(
      summary.blocked.some((b) => b.toLowerCase().includes("composio")),
    ).toBe(false);

    // warnings[] carries the composio degradation, not the run failure.
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(
      summary.warnings.some((w) => w.toLowerCase().includes("checks_failed")),
    ).toBe(false);
  });
});
