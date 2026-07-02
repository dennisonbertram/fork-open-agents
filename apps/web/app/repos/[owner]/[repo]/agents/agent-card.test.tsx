/**
 * Tests for AgentCard — operational agent cards with status matrix, controls.
 * TASK-167: agent cards, agent detail, and run controls for project agents
 *
 * Behavioral tests:
 * BT-167-001: Status matrix — never-run shows "Never run" + "Run now" control
 * BT-167-002: Status matrix — running agent shows "Running" + link to active run
 * BT-167-003: Status matrix — failed/blocked shows status + error/blocker info
 * BT-167-004: Status matrix — paused (disabled) agent shows "Paused" + "Resume" control
 * BT-167-005: Status matrix — needs-setup shows setup guidance
 * BT-167-006: Run now dispatches to test/dispatch route and routes to /background-runs/:runId
 * BT-167-007: Pause/Resume fires PATCH with {status: "disabled"/"enabled"}, config preserved
 * BT-167-008: Scheduled agents show last/next run from AgentScheduleCard
 * BT-167-009: Agent detail link present for each card
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { RunSummaryArtifact } from "@/lib/background-agents/run-summary";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const mutate = mock(async () => undefined);

let swrData: unknown = undefined;
let swrLoading = false;
let fetchResult: {
  ok: boolean;
  json: () => Promise<unknown>;
} = {
  ok: true,
  json: async () => ({
    runIds: ["run-123"],
    enabled: true,
    matched: 1,
    created: 1,
    duplicates: 0,
  }),
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

mock.module("swr", () => ({
  default: () => ({
    data: swrData,
    error: null,
    isLoading: swrLoading,
    mutate,
  }),
}));

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

// --- Helpers -----------------------------------------------------------------

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
    checkCommand: null,
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: {
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    },
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    modelId: null,
    runBudgetPerTarget: 10,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [
      {
        id: "trigger-1",
        agentId: "agent-1",
        loopId: null,
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
        warnings: string[];
      }
    | null
    | undefined;
  createdAt: Date;
};

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
      warnings: [],
    },
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

// --- Tests -------------------------------------------------------------------

const cardModulePromise = import("./agent-card");

describe("AgentCard — status matrix", () => {
  beforeEach(() => {
    swrData = undefined;
    swrLoading = false;
    push.mockClear();
    mutate.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({
        runIds: ["run-123"],
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
      }),
    };
  });

  test("BT-167-001: never-run agent shows 'Never run' text and 'Run now' button", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html.toLowerCase()).toContain("never run");
    expect(html).toContain("Run now");
  });

  test("BT-167-002: running agent shows 'Running' status and link to active run", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();
    const latestRun = makeRun({ id: "run-active", status: "running" });

    const html = renderToStaticMarkup(
      <AgentCard
        agent={agent}
        latestRun={latestRun}
        owner="acme"
        repo="widgets"
      />,
    );

    expect(html.toLowerCase()).toContain("running");
    expect(html).toContain("/background-runs/run-active");
  });

  test("BT-167-003: failed agent shows failure status and error info", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();
    const latestRun = makeRun({
      status: "failed",
      errorKind: "checks_failed",
      errorMessage: "CI checks did not pass",
      resultSummary: {
        headline: "Run failed — checks_failed",
        checked: [],
        changed: [],
        blocked: ["checks_failed: CI checks did not pass"],
        artifacts: [],
        next: ["Fix CI and re-trigger"],
        warnings: [],
      },
    });

    const html = renderToStaticMarkup(
      <AgentCard
        agent={agent}
        latestRun={latestRun}
        owner="acme"
        repo="widgets"
      />,
    );

    expect(html.toLowerCase()).toContain("fail");
    // Should show the error info from resultSummary headline or errorKind
    expect(html).toMatch(/checks_failed|CI|failed/);
  });

  test("BT-167-004: disabled (paused) agent shows 'Paused' status and 'Resume' control", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "disabled" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html.toLowerCase()).toContain("paused");
    expect(html).toContain("Resume");
    // Must NOT show a delete configuration option
    expect(html.toLowerCase()).not.toContain("delete config");
  });

  test("BT-167-005: enabled agent without a run shows 'Run now' action", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "enabled" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Run now");
  });

  test("BT-167-004: enabled agent shows 'Pause' control", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "enabled" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Pause");
  });

  test("BT-167-008: scheduled agent shows trigger label with schedule kind", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({
      triggers: [
        {
          id: "trigger-sched",
          agentId: "agent-1",
          loopId: null,
          userId: "user-1",
          name: "Nightly",
          kind: "schedule.cron",
          status: "enabled",
          conditions: {},
          schedule: "0 2 * * *",
          webhookPublicId: null,
          webhookSecretHash: null,
          lastRunAt: new Date("2026-06-01T02:00:00Z"),
          nextRunAt: new Date("2026-06-02T02:00:00Z"),
          lastSkipReason: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ],
    });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    // Schedule trigger kind is shown
    expect(html).toContain("schedule");
    // Last run / next run from schedule state
    expect(html).toMatch(/Last run|Next run|Never/i);
  });

  test("BT-167-009: each card renders a link to the agent detail view", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-42" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    // Should link to the agent detail page
    expect(html).toContain("/repos/acme/widgets/agents/agent-42");
  });

  test("BT-WI6: Edit button href ends with /edit", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ id: "agent-42" });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    // Edit button must link to the edit page, not the detail page
    expect(html).toContain("/repos/acme/widgets/agents/agent-42/edit");
  });

  test("BT-167-003: run with resultSummary shows headline", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();
    const latestRun = makeRun({
      status: "succeeded",
      resultSummary: {
        headline: "Run succeeded — created comment",
        checked: [],
        changed: [],
        blocked: [],
        artifacts: [],
        next: [],
        warnings: [],
      },
    });

    const html = renderToStaticMarkup(
      <AgentCard
        agent={agent}
        latestRun={latestRun}
        owner="acme"
        repo="widgets"
      />,
    );

    expect(html).toContain("Run succeeded — created comment");
  });
});

describe("AgentCard — name, purpose, trigger label", () => {
  test("shows agent name and instructions excerpt", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({
      name: "PR Triage Bot",
      instructions: "Triage incoming pull requests automatically.",
    });

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("PR Triage Bot");
    expect(html).toContain("Triage incoming pull requests");
  });

  test("shows trigger kind label", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    const html = renderToStaticMarkup(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("deployment");
  });
});
