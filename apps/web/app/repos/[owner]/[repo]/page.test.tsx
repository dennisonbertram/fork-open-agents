import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// --- mutable state for mocks ---
let sessionUserId: string | null = "user-1";
let repoAgents: Array<{
  id: string;
  name: string;
  status: "enabled" | "disabled";
  instructions: string;
  triggers: Array<{ id: string; kind: string }>;
}> = [];
let repoRuns: Array<{
  id: string;
  triggerKind: string;
  status: string;
  payloadSummary: { title?: string; message?: string };
  externalId: string;
  sha: string | null;
  ref: string | null;
  branch: string | null;
  createdAt: Date;
}> = [];

// Agent Loops mutable state — dashboard no longer calls listAgentLoops, but
// the mock module must still be registered so the project test (in the same
// isolate group) does not hit an unresolved import.
let agentLoopsEnabled = false;
let mockLoops: Array<{
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  repoOwner: string;
  repoName: string;
  updatedAt: Date;
  description: null;
}> = [];

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const listRepoBackgroundAgents = mock(async () => repoAgents);
const listBackgroundAgentRuns = mock(async () => repoRuns);

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents,
  listBackgroundAgentRuns,
}));

// Agent Loops — kept for module resolution; dashboard does NOT call these.
const listAgentLoops = mock(async () => mockLoops);

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => agentLoopsEnabled,
}));

mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoops,
}));

// Mock GitHub repo-dashboard helper — returns empty/connected defaults so
// the existing #161 tests remain focused on local data and shell rendering.
mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async () => ({
    prSummary: { ok: true, prs: [] },
    issueSummary: { ok: true, totalOpen: 0, recent: [] },
    actionsSummary: { ok: true, latestStatus: "passing", recentRuns: [] },
  }),
}));

// #805: repo Tools tab data loader — empty list by default so existing tests
// stay focused on their own assertions.
let repoToolStatuses: Array<{
  slug: string;
  name: string;
  status: "allowed" | "blocked" | "selected" | "default_on" | "not_connected";
  blockReason?: "not_in_repo_allowlist" | "repo_policy_blocked";
}> = [];
const getRepoToolsEffectiveStatuses = mock(async () => repoToolStatuses);

mock.module("@/lib/composio/repo-tools-page-data", () => ({
  getRepoToolsEffectiveStatuses,
}));

// Lazy-import the page after mocks are wired.
const pageModulePromise = import("./page");

describe("RepoDashboardPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    agentLoopsEnabled = false;
    mockLoops = [];
    repoToolStatuses = [];
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listBackgroundAgentRuns.mockClear();
    listAgentLoops.mockClear();
    getRepoToolsEffectiveStatuses.mockClear();
  });

  // BT-001: unauthenticated visitor is redirected
  test("BT-001: redirects unauthenticated visitors", async () => {
    sessionUserId = null;
    const { default: RepoDashboardPage } = await pageModulePromise;

    await expect(
      RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalled();
  });

  // BT-002: authenticated user sees repo header with owner/repo
  test("BT-002: authenticated user sees repo header with owner/repo identity", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Repo dashboard heading
    expect(html).toContain("Repo dashboard");
    // owner/repo mono label
    expect(html).toContain("acme/widgets");
  });

  // BT-003: all window region labels present on the dashboard
  // (AgentsWindow and WorkflowsWindowView are now on the Project page, not here)
  test("BT-003: dashboard shell renders all window region labels present on the dashboard", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Pull Requests");
    expect(html).toContain("Issues");
    expect(html).toContain("Actions");
    // #805: Tools tab is now part of the dashboard's tab set (deliberate
    // update — not a silent pass; see REGRESSION-003 for the dedicated test).
    expect(html).toContain("Tools");
    // "Project agents" still appears as the Overview counter label
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
  });

  // REGRESSION-003 (#805): the repo dashboard must expose a discoverable
  // "Tools" tab reachable without opening a chat session (finding W8 — the
  // gmail-block journey). Tab content renders unconditionally under Radix
  // Tabs + renderToStaticMarkup (same pattern as the other tab assertions
  // in this file), so this is directly observable here.
  test("REGRESSION-003: dashboard renders a discoverable Tools tab with toolkit statuses", async () => {
    repoToolStatuses = [
      { slug: "github", name: "GitHub", status: "default_on" },
      {
        slug: "gmail",
        name: "Gmail",
        status: "blocked",
        blockReason: "repo_policy_blocked",
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Tools");
    expect(html).toContain("Gmail");
    expect(getRepoToolsEffectiveStatuses).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });
  });

  // BT-004: Activity window shows run data; Overview shows counts
  // (Agent detail listing moved to project page; only counts remain here)
  test("BT-004: Activity window shows run data and Overview shows agent/run counts", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [{ id: "trigger-1", kind: "github.deployment_status" }],
      },
    ];
    repoRuns = [
      {
        id: "run-1",
        triggerKind: "github.deployment_status",
        status: "succeeded",
        payloadSummary: { title: "Production deployment succeeded" },
        externalId: "delivery-1",
        sha: "abc123",
        ref: null,
        branch: null,
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // store helpers called with the right args
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

    // Run data visible in Activity window
    expect(html).toContain("Production deployment succeeded");
    expect(html).toContain("/background-runs/run-1");

    // Overview still shows counts (agent detail listing is on project page)
    expect(html).toContain(">1<"); // 1 agent
  });

  // REDACT-002: long run payload summaries must be server-side truncated — full body must NOT reach the DOM
  test("REDACT-002: run payload summary beyond 120 chars is truncated server-side and secret marker is not in DOM", async () => {
    const secretSuffix = "SECRET_MARKER_DO_NOT_RENDER";
    // Build a 200-char title with the secret marker placed after the 120-char cap
    const longTitle = "B".repeat(130) + secretSuffix + "C".repeat(40);
    repoAgents = [];
    repoRuns = [
      {
        id: "run-secret",
        triggerKind: "github.push",
        status: "running",
        payloadSummary: { title: longTitle },
        externalId: "ext-secret",
        sha: null,
        ref: null,
        branch: null,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // The secret marker lives past position 120 — it must not appear in rendered HTML
    expect(html).not.toContain(secretSuffix);
    // The truncated preview (first 120 chars + ellipsis) must be present
    expect(html).toContain("B".repeat(120) + "…");
  });

  // BT-005: empty states on dashboard
  // "No agents configured" is on the Project page (AgentsWindow); dashboard shows
  // only the Activity empty state when no runs exist.
  test("BT-005: shows Activity empty state when no runs exist", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("No runs recorded");
    // AgentsWindow is gone from the dashboard — its empty state must not appear here
    expect(html).not.toContain("No agents configured");
  });

  // BT-006: GitHub signal windows are rendered (PR/Issues/Actions)
  // Updated in #162: the windows now render live GitHub data (or empty/error states)
  // rather than placeholder messages. With the mock returning empty connected state,
  // each window shows its empty state copy.
  test("BT-006: PR, Issues, and Actions windows are rendered in the dashboard", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // All three window headings must be present
    expect(html).toContain("Pull Requests");
    expect(html).toContain("Issues");
    expect(html).toContain("Actions");
    // With empty connected mock, each window shows an empty state
    expect(html).toMatch(/no open|no workflow|no runs/i);
  });

  // BT-007: link to GitHub repo present in header
  test("BT-007: header contains a link to the GitHub repository", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("https://github.com/acme/widgets");
  });

  // BT-008: header's second button now links to the Project page (not settings/agents)
  test("BT-008: header contains a link to the Project page with label 'Project'", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Second header button now points to /repos/{owner}/{repo}/project
    expect(html).toContain("/repos/acme/widgets/project");
    expect(html).toContain("Project");
    // The old settings link must NOT appear in the dashboard header
    expect(html).not.toContain("/settings/background-agents");
  });

  // REGRESSION-001: dashboard renders correctly with multiple agents and runs
  // (agent detail — names, triggers — is now on the project page; only run Activity
  //  and Overview counts remain on the dashboard)
  test("REGRESSION-001: dashboard renders correctly with multiple runs (Activity window)", async () => {
    repoAgents = [
      {
        id: "agent-a",
        name: "CI watcher",
        status: "enabled",
        instructions: "Watch CI runs.",
        triggers: [
          { id: "t-1", kind: "github.check_run" },
          { id: "t-2", kind: "github.push" },
          { id: "t-3", kind: "schedule.cron" },
        ],
      },
      {
        id: "agent-b",
        name: "PR reviewer",
        status: "disabled",
        instructions: "Review PRs automatically.",
        triggers: [{ id: "t-4", kind: "github.pull_request" }],
      },
    ];
    repoRuns = [
      {
        id: "run-x",
        triggerKind: "github.check_run",
        status: "running",
        payloadSummary: { title: "CI check run" },
        externalId: "ext-x",
        sha: "deadbeef",
        ref: null,
        branch: "main",
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      },
      {
        id: "run-y",
        triggerKind: "github.push",
        status: "failed",
        payloadSummary: { message: "Push to feature branch" },
        externalId: "ext-y",
        sha: null,
        ref: null,
        branch: "feature/xyz",
        createdAt: new Date("2026-06-01T09:00:00.000Z"),
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "org", repo: "myrepo" }),
      }),
    );

    // Both runs rendered in the Activity window
    expect(html).toContain("/background-runs/run-x");
    expect(html).toContain("/background-runs/run-y");
    expect(html).toContain("CI check run");
    expect(html).toContain("Push to feature branch");
    // Status chips are text-based, not color-only
    expect(html).toContain("running");
    expect(html).toContain("failed");
    // Overview counts reflect actual agent and run totals
    expect(html).toContain(">2<"); // 2 agents
  });

  // REGRESSION-002: overview counts reflect actual agent and run totals
  test("REGRESSION-002: Overview window shows correct agent and run counts", async () => {
    repoAgents = [
      {
        id: "a1",
        name: "Agent 1",
        status: "enabled",
        instructions: "instructions",
        triggers: [],
      },
      {
        id: "a2",
        name: "Agent 2",
        status: "disabled",
        instructions: "instructions",
        triggers: [],
      },
    ];
    repoRuns = [
      {
        id: "r1",
        triggerKind: "schedule.cron",
        status: "succeeded",
        payloadSummary: {},
        externalId: "e1",
        sha: null,
        ref: null,
        branch: null,
        createdAt: new Date(),
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "myorg", repo: "myrepo" }),
      }),
    );

    // Count 2 agents and 1 run — these numbers should appear in the Overview window
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
  });

  // ── M2-05 Workflows window integration ─────────────────────────────────────
  // The Workflows window is now on the Project page, not the dashboard.
  // The dashboard must NOT render the Workflows window regardless of flag state,
  // and must NOT call listAgentLoops.

  // BT-PAGE-WF-001: dashboard never shows Workflows window; listAgentLoops not called
  test("BT-PAGE-WF-001: dashboard never renders the Workflows window and never calls listAgentLoops", async () => {
    agentLoopsEnabled = false;
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Repo dashboard");
    expect(html).toContain("Overview");
    // "Project agents" label is still in OverviewWindow counter
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
    // Workflows window must NOT appear on the dashboard regardless of flag
    expect(html).not.toContain('aria-label="Loops window"');
    // listAgentLoops must NOT be called by the dashboard page
    expect(listAgentLoops).not.toHaveBeenCalled();
  });

  // BT-PAGE-WF-001b: Workflows window stays absent even when flag is on
  test("BT-PAGE-WF-001b: Workflows window absent from dashboard even when agent loops flag is on", async () => {
    agentLoopsEnabled = true;
    mockLoops = [
      {
        id: "loop-abc",
        name: "CI pipeline loop",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date("2026-06-01T00:00:00Z"),
        description: null,
      },
    ];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Dashboard never shows the Workflows/Loops window
    expect(html).not.toContain('aria-label="Loops window"');
    // listAgentLoops must NOT be called by the dashboard
    expect(listAgentLoops).not.toHaveBeenCalled();
  });
});
