import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let sessionUserId: string | null = "user-1";
let repoAgents: Array<{
  id: string;
  name: string;
  status: "enabled" | "disabled";
  instructions: string;
  triggers: Array<{
    id: string;
    kind: string;
  }>;
}> = [];
let repoRuns: Array<{
  id: string;
  agentId: string;
  triggerKind: string;
  status: string;
  payloadSummary: {
    title?: string;
    message?: string;
  };
  externalId: string;
  sha: string | null;
  ref: string | null;
  branch: string | null;
  createdAt: Date;
}> = [];

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const push = mock((_url: string) => undefined);
const listRepoBackgroundAgents = mock(async () => repoAgents);
const listBackgroundAgentRuns = mock(async () => repoRuns);

mock.module("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push }),
}));

// swr is used by RepoAgentsDashboard (client component imported by page)
mock.module("swr", () => ({
  default: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId
      ? {
          user: {
            id: sessionUserId,
          },
        }
      : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents,
  listBackgroundAgentRuns,
}));

const pageModulePromise = import("./page");

describe("RepoAgentsPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listBackgroundAgentRuns.mockClear();
  });

  test("renders configured agents and recent run history for a repository", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [
          {
            id: "trigger-1",
            kind: "github.deployment_status",
          },
        ],
      },
    ];
    repoRuns = [
      {
        id: "run-1",
        agentId: "agent-1",
        triggerKind: "github.deployment_status",
        status: "succeeded",
        payloadSummary: {
          title: "Production deployment succeeded",
        },
        externalId: "delivery-1",
        sha: "abc123",
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ];
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(listRepoBackgroundAgents).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });
    expect(listBackgroundAgentRuns).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      limit: 50,
    });
    expect(html).toContain("Background agents");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("Deploy smoke");
    expect(html).toContain("Run smoke checks after deployments.");
    expect(html).toContain("github.deployment_status");
    expect(html).toContain("Production deployment succeeded");
    expect(html).toContain("abc123");
    expect(html).toContain("/background-runs/run-1");
    // Prerequisites link — now a quiet text link instead of the Settings button
    expect(html).toContain("/settings/background-agents");
    // New agent link goes to /agents/new
    expect(html).toContain("/repos/acme/widgets/agents/new");
  });

  test("renders repo-scoped empty states", async () => {
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("No agents configured for this repository.");
    expect(html).toContain("No runs recorded for this repository.");
  });

  test("renders roster only without builder form copy", async () => {
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Configured agents");
    expect(html).toContain("Recent runs");
    expect(html).toContain("/repos/acme/widgets/agents/new");
    expect(html).not.toContain("What should this agent do?");
    expect(html).not.toContain("Run a test");
    expect(html).not.toContain("Verification command");
  });

  test("recent runs section shows at most 5 runs", async () => {
    // Create 7 runs
    repoRuns = Array.from({ length: 7 }, (_, i) => ({
      id: `run-${i + 1}`,
      agentId: "agent-1",
      triggerKind: "schedule.cron",
      status: "succeeded",
      payloadSummary: { title: `Run ${i + 1}` },
      externalId: `ext-${i + 1}`,
      sha: null,
      ref: null,
      branch: null,
      createdAt: new Date("2026-05-27T12:00:00.000Z"),
    }));
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // First 5 runs should be present
    expect(html).toContain("/background-runs/run-1");
    expect(html).toContain("/background-runs/run-5");
    // Run 6 and 7 should NOT be in the recent runs section
    expect(html).not.toContain("/background-runs/run-6");
    expect(html).not.toContain("/background-runs/run-7");
    // A "more exist" affordance should appear when there are more than 5
    expect(html).toContain("Showing latest 5");
  });

  // #803 item 9 (W11): when multiple agents have run in the same repo, each
  // "Recent runs" row must show the agent's name, not just a run id/timestamp.
  test("BT-803-009: recent-runs rows show each run's agent name", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [],
      },
      {
        id: "agent-2",
        name: "Issue triage",
        status: "enabled",
        instructions: "Label and route new issues.",
        triggers: [],
      },
    ];
    repoRuns = [
      {
        id: "run-1",
        agentId: "agent-1",
        triggerKind: "github.deployment_status",
        status: "succeeded",
        payloadSummary: { title: "Production deployment succeeded" },
        externalId: "delivery-1",
        sha: "abc123",
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
      {
        id: "run-2",
        agentId: "agent-2",
        triggerKind: "github.issue",
        status: "succeeded",
        payloadSummary: { title: "Issue #42 triaged" },
        externalId: "delivery-2",
        sha: null,
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T13:00:00.000Z"),
      },
    ];
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Isolate the "Recent runs" section so this test fails if the agent name
    // only appears in the "Configured agents" cards above — it must appear
    // in the actual per-run row.
    const recentRunsHtml = html.slice(html.indexOf("Recent runs"));
    expect(recentRunsHtml).toContain("Production deployment succeeded");
    expect(recentRunsHtml).toContain("Deploy smoke");
    expect(recentRunsHtml).toContain("Issue #42 triaged");
    expect(recentRunsHtml).toContain("Issue triage");
  });

  // Regression: a run referencing an agent that no longer appears in the
  // roster (deleted agent, or agentId null on an older/loop-owned run) must
  // not crash the page render — it should fall back to an honest label
  // instead of an unhandled Map lookup failure.
  test("REGRESSION-803-009: a run with an unknown or missing agentId renders a fallback label instead of crashing", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [],
      },
    ];
    repoRuns = [
      {
        id: "run-orphaned",
        agentId: "agent-deleted",
        triggerKind: "schedule.cron",
        status: "succeeded",
        payloadSummary: { title: "Orphaned run" },
        externalId: "delivery-orphan",
        sha: null,
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ];
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    const recentRunsHtml = html.slice(html.indexOf("Recent runs"));
    expect(recentRunsHtml).toContain("Orphaned run");
    expect(recentRunsHtml).toContain("Unknown agent");
  });

  // #863: the run list must render the same instant in the same explicit,
  // labeled UTC treatment as the schedule card and agent detail page.
  test("BT-863: recent-runs row renders createdAt via the shared UTC-labeled formatter", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [],
      },
    ];
    repoRuns = [
      {
        id: "run-863",
        agentId: "agent-1",
        triggerKind: "schedule.cron",
        status: "succeeded",
        payloadSummary: { title: "Timezone parity run" },
        externalId: "delivery-863",
        sha: null,
        ref: null,
        branch: null,
        createdAt: new Date("2026-07-03T21:20:00Z"),
      },
    ];
    const { default: RepoAgentsPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Jul 3, 2026 at 9:20 PM UTC");
  });
});
