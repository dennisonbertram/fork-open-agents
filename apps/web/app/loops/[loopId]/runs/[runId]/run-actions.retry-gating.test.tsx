/**
 * run-actions.retry-gating.test.tsx (#767)
 *
 * The store rejects retry for completed/cancelled runs (store.ts ~986-990),
 * so Retry must render ONLY for failed/stalled runs — never completed or
 * cancelled, even though those are "terminal" statuses too.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
    promise: (_p: Promise<unknown>, _opts: unknown) => undefined,
  },
}));

const runActionsModulePromise = import("./run-actions");

describe("RunActions retry gating (#767)", () => {
  test("shows retry for a failed run", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="failed" loopId="loop_1" />,
    );
    expect(html.toLowerCase()).toContain("retry");
  });

  test("shows retry for a stalled run", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="stalled" loopId="loop_1" />,
    );
    expect(html.toLowerCase()).toContain("retry");
  });

  test("does NOT show retry for a completed run (store rejects it)", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="completed" loopId="loop_1" />,
    );
    expect(html.toLowerCase()).not.toContain("retry");
  });

  test("does NOT show retry for a cancelled run (store rejects it)", async () => {
    const { RunActions } = await runActionsModulePromise;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="cancelled" loopId="loop_1" />,
    );
    expect(html.toLowerCase()).not.toContain("retry");
  });
});
