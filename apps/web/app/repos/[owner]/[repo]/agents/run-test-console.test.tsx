/**
 * Tests for the RunTestConsole inline component.
 * Uses renderToStaticMarkup (react-dom/server) idiom — no browser/JSDOM needed.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the polling hook before importing the component
mock.module("./use-background-run-polling", () => ({
  useBackgroundRunPolling: (runId: string) => {
    // Different return values based on runId for test isolation
    if (runId === "run-terminal") {
      return {
        data: {
          run: {
            id: "run-terminal",
            status: "succeeded",
            repoOwner: "acme",
            repoName: "widgets",
            createdAt: "2026-06-17T10:00:00.000Z",
            startedAt: "2026-06-17T10:00:01.000Z",
            finishedAt: "2026-06-17T10:00:30.000Z",
            errorKind: null,
            errorMessage: null,
            outputKind: null,
            outputUrl: null,
            sandboxName: null,
            requestId: null,
            workflowRunId: null,
          },
          agent: null,
          events: [
            {
              id: "evt-1",
              eventName: "background-agent.check.completed",
              status: "succeeded",
              summary: "done",
              workflowRunId: null,
              sandboxName: null,
              requestId: null,
              errorKind: null,
              redactionStatus: "not_required",
              payload: {},
              createdAt: "2026-06-17T10:00:25.000Z",
            },
          ],
          outputs: [],
        },
        error: undefined,
        isLoading: false,
      };
    }
    if (runId === "run-failed") {
      return {
        data: {
          run: {
            id: "run-failed",
            status: "failed",
            repoOwner: "acme",
            repoName: "widgets",
            createdAt: "2026-06-17T10:00:00.000Z",
            startedAt: "2026-06-17T10:00:01.000Z",
            finishedAt: "2026-06-17T10:00:15.000Z",
            errorKind: "sandbox_quota",
            errorMessage: "Sandbox quota exceeded",
            outputKind: null,
            outputUrl: null,
            sandboxName: null,
            requestId: null,
            workflowRunId: null,
          },
          agent: null,
          events: [],
          outputs: [],
        },
        error: undefined,
        isLoading: false,
      };
    }
    // Default: non-terminal (running)
    return {
      data: {
        run: {
          id: runId,
          status: "running",
          repoOwner: "acme",
          repoName: "widgets",
          createdAt: "2026-06-17T10:00:00.000Z",
          startedAt: "2026-06-17T10:00:01.000Z",
          finishedAt: null,
          errorKind: null,
          errorMessage: null,
          outputKind: null,
          outputUrl: null,
          sandboxName: null,
          requestId: null,
          workflowRunId: null,
        },
        agent: null,
        events: [],
        outputs: [],
      },
      error: undefined,
      isLoading: false,
    };
  },
}));

const modulePromise = import("./run-test-console");

describe("RunTestConsole", () => {
  test("renders event line (eventName + summary) and success indicator for terminal succeeded run", async () => {
    const { RunTestConsole } = await modulePromise;

    const html = renderToStaticMarkup(<RunTestConsole runId="run-terminal" />);

    // event name should appear in the console line
    expect(html).toContain("background-agent.check.completed");
    // summary text should appear
    expect(html).toContain("done");
    // success state indicator
    expect(html.toLowerCase()).toMatch(/succeed|success|succeeded/i);
  });

  test("renders Open full run link pointing to /background-runs/{runId}", async () => {
    const { RunTestConsole } = await modulePromise;

    const html = renderToStaticMarkup(<RunTestConsole runId="run-terminal" />);

    expect(html).toContain("/background-runs/run-terminal");
    expect(html.toLowerCase()).toContain("open full run");
  });

  test("#688 — failed run with errorMessage renders prominent error banner containing the message", async () => {
    const { RunTestConsole } = await modulePromise;

    const html = renderToStaticMarkup(<RunTestConsole runId="run-failed" />);

    // Must show a prominent "Test failed" label
    expect(html.toLowerCase()).toContain("test failed");
    // Must include the specific error message
    expect(html).toContain("Sandbox quota exceeded");
  });

  test("non-terminal running status renders waiting/refreshing affordance and no success state", async () => {
    const { RunTestConsole } = await modulePromise;

    const html = renderToStaticMarkup(<RunTestConsole runId="run-active" />);

    // Should show some kind of active/running indicator (spinner class or text)
    // The component renders "Waiting for events…" when events array is empty during active run
    expect(html).toMatch(/waiting|running|queued|active|spinner|animate/i);
    // Should NOT show success state for a running run
    expect(html.toLowerCase()).not.toMatch(/succeeded/);
  });
});
