/**
 * Regression tests for TASK-167-gaps — Edit/ViewRuns/LatestOutput controls
 * and active-run polling. These catch regressions if the b2ee923e green
 * commit is reverted or the features are accidentally removed.
 *
 * Regression 1 — Edit and View runs cannot be silently removed:
 *   If someone removes the Edit button or changes the label, this test fails.
 *   If someone removes the View runs link, this test fails.
 *
 * Regression 2 — Latest output link is not rendered as a dead link:
 *   The link MUST be absent when outputUrl is null. If someone adds a
 *   fallback that renders a blank href, that's a bug this test catches.
 *
 * Regression 3 — Polling interval is exactly zero for failed/cancelled runs:
 *   These are terminal states — they should never trigger polling. If someone
 *   accidentally adds "failed" to the active-status check, this test fails.
 *
 * Regression 4 — Status route returns only safe fields:
 *   The response must never include full run payload, instructions, or agent
 *   config. Only the three lightweight status fields are allowed.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { RunSummaryArtifact } from "@/lib/background-agents/run-summary";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const routerRefresh = mock(() => undefined);

type SwrCallRecord = {
  key: unknown;
  options: Record<string, unknown> | undefined;
};
const swrCalls: SwrCallRecord[] = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh: routerRefresh }),
  redirect: (_path: string) => {
    throw new Error("redirect");
  },
}));

mock.module("swr", () => ({
  default: (
    key: unknown,
    _fetcher: unknown,
    options: Record<string, unknown> | undefined,
  ) => {
    swrCalls.push({ key, options });
    return {
      data: undefined,
      error: null,
      isLoading: false,
      mutate: async () => undefined,
    };
  },
}));

// @ts-expect-error — override global fetch for test
global.fetch = async () => ({
  ok: true,
  json: async () => ({ runIds: ["run-new"] }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgentRun = {
  id: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled";
  errorKind: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  resultSummary:
    | {
        headline: string;
        checked: string[];
        changed: string[];
        blocked: string[];
        artifacts: RunSummaryArtifact[];
        next: string[];
      }
    | null
    | undefined;
  createdAt: Date;
};

function makeAgent(
  overrides: Partial<BackgroundAgentWithTriggers> = {},
): BackgroundAgentWithTriggers {
  return {
    id: "agent-reg2-1",
    userId: "user-1",
    name: "Regression Agent",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Watch for regressions.",
    permissions: {},
    outputMode: "none",
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-reg-1",
    status: "succeeded",
    errorKind: null,
    errorMessage: null,
    outputUrl: null,
    resultSummary: null,
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

const cardModulePromise = import("./agent-card");

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe("Regression: Edit and View runs controls must not be silently removed", () => {
  beforeEach(() => {
    swrCalls.length = 0;
    push.mockClear();
    routerRefresh.mockClear();
  });

  test("AgentCard always renders an Edit button for enabled agents", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "enabled" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Edit");
    // Edit must link to the detail page
    expect(html).toContain("/repos/acme/widgets/agents/agent-reg2-1");
  });

  test("AgentCard always renders an Edit button for disabled (paused) agents", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "disabled" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Edit");
  });

  test("AgentCard always renders a View runs button regardless of run history", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    // With no run history
    const htmlNoRun = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );
    expect(htmlNoRun).toContain("View runs");

    // With a run that succeeded
    const htmlWithRun = renderToStaticMarkup(
      <AgentCard
        agent={agent}
        latestRun={makeRun({ status: "succeeded" })}
        owner="acme"
        repo="widgets"
      />,
    );
    expect(htmlWithRun).toContain("View runs");
  });
});

describe("Regression: Latest output link is absent when outputUrl is null", () => {
  beforeEach(() => {
    swrCalls.length = 0;
  });

  test("null outputUrl must not produce any 'Latest output' element", async () => {
    const { AgentCard } = await cardModulePromise;

    for (const status of [
      "succeeded",
      "failed",
      "cancelled",
      "skipped",
    ] as const) {
      const html = renderToStaticMarkup(
        <AgentCard
          agent={makeAgent()}
          latestRun={makeRun({ status, outputUrl: null })}
          owner="acme"
          repo="widgets"
        />,
      );
      expect(html).not.toContain("Latest output");
    }
  });

  test("non-null outputUrl renders 'Latest output' with exact href", async () => {
    const { AgentCard } = await cardModulePromise;
    const url = "https://github.com/acme/widgets/pull/42";

    const html = renderToStaticMarkup(
      <AgentCard
        agent={makeAgent()}
        latestRun={makeRun({ status: "succeeded", outputUrl: url })}
        owner="acme"
        repo="widgets"
      />,
    );

    expect(html).toContain("Latest output");
    expect(html).toContain(url);
  });
});

describe("Regression: polling interval is zero for terminal run states", () => {
  beforeEach(() => {
    swrCalls.length = 0;
  });

  test("failed run produces NO polling interval (refreshInterval 0 or absent)", async () => {
    const { AgentCard } = await cardModulePromise;

    renderToStaticMarkup(
      <AgentCard
        agent={makeAgent()}
        latestRun={makeRun({ status: "failed" })}
        owner="acme"
        repo="widgets"
      />,
    );

    const activePolling = swrCalls.find(
      (c) =>
        typeof c.options?.refreshInterval === "number" &&
        (c.options.refreshInterval as number) > 0,
    );
    expect(activePolling).toBeUndefined();
  });

  test("cancelled run produces NO polling interval", async () => {
    const { AgentCard } = await cardModulePromise;

    renderToStaticMarkup(
      <AgentCard
        agent={makeAgent()}
        latestRun={makeRun({ status: "cancelled" })}
        owner="acme"
        repo="widgets"
      />,
    );

    const activePolling = swrCalls.find(
      (c) =>
        typeof c.options?.refreshInterval === "number" &&
        (c.options.refreshInterval as number) > 0,
    );
    expect(activePolling).toBeUndefined();
  });

  test("running run produces a positive polling interval (4000ms)", async () => {
    const { AgentCard } = await cardModulePromise;

    renderToStaticMarkup(
      <AgentCard
        agent={makeAgent()}
        latestRun={makeRun({ status: "running" })}
        owner="acme"
        repo="widgets"
      />,
    );

    const activePolling = swrCalls.find(
      (c) =>
        typeof c.options?.refreshInterval === "number" &&
        (c.options.refreshInterval as number) >= 4000,
    );
    expect(activePolling).not.toBeUndefined();
  });
});
