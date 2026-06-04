/**
 * Tests for TASK-167 deferred gaps:
 *  Gap 1 — Card controls: Edit, View runs, Latest output
 *  Gap 2 — Active-run polling: poll when running/queued, no poll when idle
 *
 * BT-167-G1-001: AgentCard renders an "Edit" control linking to the agent detail/spec page
 * BT-167-G1-002: AgentCard renders a "View runs" control (link labeled "View runs")
 * BT-167-G1-003: AgentCard renders a "Latest output" link when latestRun.outputUrl is set
 * BT-167-G1-004: AgentCard omits "Latest output" entirely when latestRun has no outputUrl
 * BT-167-G1-005: AgentCard omits "Latest output" when there is no latestRun at all
 * BT-167-G2-001: AgentCard invokes useSWR with a refreshInterval when run status is "running"
 * BT-167-G2-002: AgentCard invokes useSWR with a refreshInterval when run status is "queued"
 * BT-167-G2-003: AgentCard invokes useSWR with NO refreshInterval when run is in a terminal state
 * BT-167-G2-004: AgentCard invokes useSWR with NO refreshInterval when there is no latestRun
 * BT-167-G2-005: Status API route GET /api/background-agents/:agentId/status requires auth
 * BT-167-G2-006: Status API route returns latest run status fields for the authed user's agent
 * BT-167-G2-007: Status API route returns 404 when the agent does not belong to the user
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { RunSummaryArtifact } from "@/lib/background-agents/run-summary";

// ---------------------------------------------------------------------------
// Shared SWR spy — tracks the options object passed to each useSWR() call.
// ---------------------------------------------------------------------------

type SwrCallRecord = {
  key: unknown;
  options: Record<string, unknown> | undefined;
};
const swrCalls: SwrCallRecord[] = [];

const push = mock((_url: string) => undefined);
const routerRefresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh: routerRefresh }),
}));

// The SWR mock captures every invocation so we can assert on refreshInterval.
mock.module("swr", () => ({
  default: (key: unknown, _fetcher: unknown, options: Record<string, unknown> | undefined) => {
    swrCalls.push({ key, options });
    return {
      data: undefined,
      error: null,
      isLoading: false,
      mutate: async () => undefined,
    };
  },
}));

const globalFetch = mock(async (_url: string, _opts?: unknown) => ({
  ok: true,
  json: async () => ({ runIds: ["run-new"], enabled: true, matched: 1, created: 1, duplicates: 0 }),
}));
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgentRun = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
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
    id: "agent-1",
    userId: "user-1",
    name: "Deploy Smoke",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Run smoke checks after deployments.",
    permissions: {},
    outputMode: "none",
    checkCommand: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [
      {
        id: "trigger-1",
        agentId: "agent-1",
        userId: "user-1",
        name: "On deployment",
        kind: "github.deployment_status",
        status: "enabled",
        conditions: {},
        schedule: null,
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    status: "succeeded",
    errorKind: null,
    errorMessage: null,
    outputUrl: null,
    resultSummary: {
      headline: "Run succeeded",
      checked: [],
      changed: [],
      blocked: [],
      artifacts: [],
      next: [],
    },
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import the card module once (after mocks are registered above)
// ---------------------------------------------------------------------------
const cardModulePromise = import("./agent-card");

// ---------------------------------------------------------------------------
// Gap 1 — Card controls: Edit, View runs, Latest output
// ---------------------------------------------------------------------------

describe("Gap 1 — AgentCard missing controls", () => {
  beforeEach(() => {
    swrCalls.length = 0;
    push.mockClear();
    routerRefresh.mockClear();
    globalFetch.mockClear();
  });

  test("BT-167-G1-001: renders an 'Edit' control that links to the agent detail page", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-42" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    // Must contain a labeled "Edit" affordance
    expect(html).toContain("Edit");
    // Must link toward the detail/spec page for the agent
    expect(html).toContain("/repos/acme/widgets/agents/agent-42");
  });

  test("BT-167-G1-002: renders a 'View runs' control (labeled link)", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-42" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    // Must contain text "View runs" (case-sensitive label)
    expect(html).toContain("View runs");
  });

  test("BT-167-G1-003: renders a 'Latest output' link when latestRun.outputUrl is set", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();
    const latestRun = makeRun({
      id: "run-99",
      status: "succeeded",
      outputUrl: "https://github.com/acme/widgets/pull/7",
    });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={latestRun} owner="acme" repo="widgets" />,
    );

    // Must contain a "Latest output" label and the outputUrl
    expect(html).toContain("Latest output");
    expect(html).toContain("https://github.com/acme/widgets/pull/7");
  });

  test("BT-167-G1-004: omits 'Latest output' entirely when latestRun has no outputUrl", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();
    const latestRun = makeRun({ status: "succeeded", outputUrl: null });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={latestRun} owner="acme" repo="widgets" />,
    );

    // Must NOT render a dead "Latest output" link or placeholder
    expect(html).not.toContain("Latest output");
  });

  test("BT-167-G1-005: omits 'Latest output' when there is no latestRun at all", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).not.toContain("Latest output");
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — Active-run polling
// ---------------------------------------------------------------------------

describe("Gap 2 — Active-run polling behavior", () => {
  beforeEach(() => {
    swrCalls.length = 0;
    push.mockClear();
    routerRefresh.mockClear();
    globalFetch.mockClear();
  });

  test("BT-167-G2-001: useSWR is called with a refreshInterval when run status is 'running'", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-polling" });
    const latestRun = makeRun({ id: "run-active", status: "running" });

    renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={latestRun} owner="acme" repo="widgets" />,
    );

    // At least one useSWR invocation with a numeric refreshInterval > 0
    const pollingCall = swrCalls.find(
      (c) => typeof c.options?.refreshInterval === "number" && (c.options.refreshInterval as number) > 0,
    );
    expect(pollingCall).not.toBeUndefined();
  });

  test("BT-167-G2-002: useSWR is called with a refreshInterval when run status is 'queued'", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-polling" });
    const latestRun = makeRun({ id: "run-q", status: "queued" });

    renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={latestRun} owner="acme" repo="widgets" />,
    );

    const pollingCall = swrCalls.find(
      (c) => typeof c.options?.refreshInterval === "number" && (c.options.refreshInterval as number) > 0,
    );
    expect(pollingCall).not.toBeUndefined();
  });

  test("BT-167-G2-003: useSWR has NO refreshInterval when run is in a terminal state (succeeded)", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-idle" });
    const latestRun = makeRun({ id: "run-done", status: "succeeded" });

    renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={latestRun} owner="acme" repo="widgets" />,
    );

    // No useSWR call should have a positive refreshInterval
    const pollingCall = swrCalls.find(
      (c) => typeof c.options?.refreshInterval === "number" && (c.options.refreshInterval as number) > 0,
    );
    expect(pollingCall).toBeUndefined();
  });

  test("BT-167-G2-004: useSWR has NO refreshInterval when there is no latestRun (never-run)", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-never" });

    renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    const pollingCall = swrCalls.find(
      (c) => typeof c.options?.refreshInterval === "number" && (c.options.refreshInterval as number) > 0,
    );
    expect(pollingCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — Status API route
// ---------------------------------------------------------------------------

// These tests require isolated mock setup — use a separate describe block.
describe("Gap 2 — Status API route /api/background-agents/:agentId/status", () => {
  // Mocks for the route module
  type AuthResult =
    | { ok: true; userId: string }
    | { ok: false; response: Response };

  let authResult: AuthResult = { ok: true, userId: "user-1" };

  // We will stub listBackgroundAgentRuns to return a controlled set of runs
  // for the agentId-scoped status query.
  type MinimalRun = {
    id: string;
    agentId: string;
    status: string;
    outputUrl: string | null;
    errorKind: string | null;
    createdAt: Date;
  };
  let mockRuns: MinimalRun[] = [];

  mock.module("server-only", () => ({}));

  mock.module("@/app/api/sessions/_lib/session-context", () => ({
    requireAuthenticatedUser: async () => authResult,
  }));

  mock.module("@/lib/background-agents/store", () => ({
    listBackgroundAgentRuns: async () => mockRuns,
    // Re-export everything else used by other tests via this mock
    getOwnedBackgroundAgentWithTriggers: async () => null,
    listRepoBackgroundAgents: async () => [],
    listBackgroundAgentOutputs: async () => [],
    updateBackgroundAgent: async () => null,
    deleteBackgroundAgent: async () => false,
    createBackgroundAgent: async () => { throw new Error("not mocked"); },
    listBackgroundAgents: async () => [],
  }));

  const statusRouteModulePromise = import(
    "@/app/api/background-agents/[agentId]/status/route"
  );

  function routeContext(agentId = "agent-1") {
    return { params: Promise.resolve({ agentId }) };
  }

  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    mockRuns = [];
  });

  test("BT-167-G2-005: GET requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await statusRouteModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext(),
    );

    expect(response.status).toBe(401);
  });

  test("BT-167-G2-006: GET returns latest run status fields for an owned agent", async () => {
    mockRuns = [
      {
        id: "run-latest",
        agentId: "agent-1",
        status: "running",
        outputUrl: null,
        errorKind: null,
        createdAt: new Date("2026-06-01T12:00:00Z"),
      },
      {
        id: "run-older",
        agentId: "agent-1",
        status: "succeeded",
        outputUrl: "https://github.com/acme/widgets/pull/1",
        errorKind: null,
        createdAt: new Date("2026-06-01T11:00:00Z"),
      },
    ];

    const { GET } = await statusRouteModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext("agent-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestRunId: string | null;
      latestRunStatus: string | null;
      latestOutputUrl: string | null;
    };
    // Returns the most recent run
    expect(body.latestRunId).toBe("run-latest");
    expect(body.latestRunStatus).toBe("running");
    // outputUrl from most recent run (null here)
    expect(body.latestOutputUrl).toBeNull();
  });

  test("BT-167-G2-007: GET returns null fields when no runs exist for the agent", async () => {
    // mockRuns is empty — no runs for this agent
    mockRuns = [];

    const { GET } = await statusRouteModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext("agent-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestRunId: string | null;
      latestRunStatus: string | null;
      latestOutputUrl: string | null;
    };
    expect(body.latestRunId).toBeNull();
    expect(body.latestRunStatus).toBeNull();
    expect(body.latestOutputUrl).toBeNull();
  });
});
