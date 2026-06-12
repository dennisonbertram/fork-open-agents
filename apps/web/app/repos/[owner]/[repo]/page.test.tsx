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

// Agent Loops mutable state — controlled per test
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
let loopsFetchShouldThrow = false;

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

// Agent Loops — controlled via mutable state per test.
// Default: flag off + no loops so existing tests are unaffected.
const listAgentLoops = mock(async () => {
  if (loopsFetchShouldThrow) throw new Error("DB failed");
  return mockLoops;
});

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

// Lazy-import the page after mocks are wired.
const pageModulePromise = import("./page");

describe("RepoDashboardPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    agentLoopsEnabled = false;
    mockLoops = [];
    loopsFetchShouldThrow = false;
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listBackgroundAgentRuns.mockClear();
    listAgentLoops.mockClear();
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

  // BT-003: all six window region labels are present
  test("BT-003: dashboard shell renders all six window region labels", async () => {
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
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
  });

  // BT-004: agents and activity windows show local store data
  test("BT-004: Agents and Activity windows show local background-agent store data", async () => {
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

    // Agent data visible
    expect(html).toContain("Deploy smoke");
    // Short instruction is under the 140-char cap — rendered as-is (no ellipsis)
    expect(html).toContain("Run smoke checks after deployments.");
    // Run data visible — short title is under the 120-char cap
    expect(html).toContain("Production deployment succeeded");
    expect(html).toContain("/background-runs/run-1");
  });

  // REDACT-001: long agent instructions must be server-side truncated — full body must NOT reach the DOM
  test("REDACT-001: agent instructions beyond 140 chars are truncated server-side and secret marker is not in DOM", async () => {
    const secretSuffix = "SECRET_MARKER_DO_NOT_RENDER";
    // Build a 200-char instruction with the secret marker placed after the 140-char cap
    const longInstructions = "A".repeat(150) + secretSuffix + "B".repeat(24);
    repoAgents = [
      {
        id: "agent-secret",
        name: "Secret agent",
        status: "enabled",
        instructions: longInstructions,
        triggers: [],
      },
    ];
    repoRuns = [];
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // The secret marker lives past position 140 — it must not appear in rendered HTML
    expect(html).not.toContain(secretSuffix);
    // The truncated preview (first 140 chars + ellipsis) must be present
    expect(html).toContain("A".repeat(140) + "…");
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

  // BT-005: empty states when no agents or runs
  test("BT-005: shows useful empty states when no agents or runs exist", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("No agents configured");
    expect(html).toContain("No runs recorded");
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

  // BT-008: link to settings/agents page present
  test("BT-008: header contains a link to the settings/agents page", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("/settings/background-agents");
  });

  // REGRESSION-001: dashboard still renders when an agent has multiple triggers
  test("REGRESSION-001: dashboard renders correctly with multiple agents and triggers", async () => {
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

    // All agents rendered
    expect(html).toContain("CI watcher");
    expect(html).toContain("PR reviewer");
    // Disabled status chip text
    expect(html).toContain("disabled");
    // All triggers rendered
    expect(html).toContain("github.check_run");
    expect(html).toContain("github.push");
    expect(html).toContain("schedule.cron");
    expect(html).toContain("github.pull_request");
    // Both runs rendered
    expect(html).toContain("/background-runs/run-x");
    expect(html).toContain("/background-runs/run-y");
    expect(html).toContain("CI check run");
    expect(html).toContain("Push to feature branch");
    // Status chips are text-based, not color-only
    expect(html).toContain("running");
    expect(html).toContain("failed");
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

  // BT-PAGE-WF-001: flag off → Workflows window absent, other windows intact
  test("BT-PAGE-WF-001: when AGENT_LOOPS_ENABLED=false, Workflows window is absent but other windows render", async () => {
    agentLoopsEnabled = false;
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Repo dashboard");
    expect(html).toContain("Overview");
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
    // Workflows window MUST NOT appear when flag is off
    expect(html).not.toContain('aria-label="Workflows window"');
    // listAgentLoops MUST NOT be called when flag is off
    expect(listAgentLoops).not.toHaveBeenCalled();
  });

  // BT-PAGE-WF-002: flag on + loops → Workflows window present with loop data
  test("BT-PAGE-WF-002: when flag on and loops exist, Workflows window appears with loop names", async () => {
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

    expect(html).toContain("Workflows");
    expect(html).toContain("CI pipeline loop");
    expect(html).toContain("/loops/loop-abc");
  });

  // BT-PAGE-WF-003: loops fetch error → dashboard still renders
  test("BT-PAGE-WF-003: loops fetch failure does not crash the dashboard (Promise.allSettled isolation)", async () => {
    agentLoopsEnabled = true;
    loopsFetchShouldThrow = true;

    const { default: RepoDashboardPage } = await pageModulePromise;

    let html: string;
    try {
      html = renderToStaticMarkup(
        await RepoDashboardPage({
          params: Promise.resolve({ owner: "acme", repo: "widgets" }),
        }),
      );
    } catch {
      throw new Error(
        "Dashboard page crashed when loops fetch failed — Promise.allSettled isolation broken",
      );
    }

    expect(html).toContain("Repo dashboard");
    expect(html).toContain("Overview");
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
  });

  // BT-PAGE-WF-004: listAgentLoops called with correct params
  test("BT-PAGE-WF-004: when flag on, listAgentLoops is called with userId, repoOwner, repoName", async () => {
    agentLoopsEnabled = true;
    mockLoops = [];

    const { default: RepoDashboardPage } = await pageModulePromise;

    await RepoDashboardPage({
      params: Promise.resolve({ owner: "myorg", repo: "myrepo" }),
    });

    expect(listAgentLoops).toHaveBeenCalledWith("user-1", {
      repoOwner: "myorg",
      repoName: "myrepo",
    });
  });
});
