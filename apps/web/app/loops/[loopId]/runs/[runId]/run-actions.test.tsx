/**
 * RunActions component tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-018: Pause button renders for running runs
 *   BT-LOOPS-019: Resume button renders for paused runs
 *   BT-LOOPS-020: Cancel button renders for non-terminal runs with AlertDialog text
 *   BT-LOOPS-021: Retry button renders for terminal runs
 *   BT-LOOPS-022: 409 active_run response renders non-destructive notice
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock sonner
mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
    promise: (_p: Promise<unknown>, _opts: unknown) => undefined,
  },
}));

const runActionsModulePromise = import("./run-actions");

describe("RunActions", () => {
  // BT-LOOPS-018: pause button for running run
  test("BT-LOOPS-018: shows pause button when run is running", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="running" loopId="loop_1" />,
    );

    expect(html.toLowerCase()).toContain("pause");
  });

  // BT-LOOPS-019: resume button for paused run
  test("BT-LOOPS-019: shows resume button when run is paused", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="paused" loopId="loop_1" />,
    );

    expect(html.toLowerCase()).toContain("resume");
  });

  // BT-LOOPS-020: cancel renders with AlertDialog message
  test("BT-LOOPS-020: shows cancel option with AlertDialog text for non-terminal run", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="running" loopId="loop_1" />,
    );

    expect(html.toLowerCase()).toContain("cancel");
    // AlertDialog cancel confirmation text
    expect(html).toContain("Cancel run");
  });

  // BT-LOOPS-021: retry button for terminal run
  test("BT-LOOPS-021: shows retry button when run has failed", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="failed" loopId="loop_1" />,
    );

    expect(html.toLowerCase()).toContain("retry");
  });

  // BT-LOOPS-022: 409 notice props
  test("BT-LOOPS-022: renders active-run notice when activeRunId passed (409 scenario)", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions
        runId="run_1"
        status="queued"
        loopId="loop_1"
        activeRunId="run_existing"
      />,
    );

    // Should surface a non-destructive notice about the active run
    expect(html).toContain("run_existing");
  });
});
