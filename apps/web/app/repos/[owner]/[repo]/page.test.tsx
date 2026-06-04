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

// Lazy-import the page after mocks are wired.
const pageModulePromise = import("./page");

describe("RepoDashboardPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listBackgroundAgentRuns.mockClear();
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
    expect(html).toContain("Run smoke checks after deployments.");
    // Run data visible
    expect(html).toContain("Production deployment succeeded");
    expect(html).toContain("/background-runs/run-1");
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

  // BT-006: placeholder windows for PR/Issues/Actions indicate not-yet-available
  test("BT-006: PR, Issues, and Actions windows show unavailable placeholder state", async () => {
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Each placeholder window should signal it's not connected yet
    // (exact copy is implementation detail, but all three must be present)
    expect(html).toContain("Pull Requests");
    expect(html).toContain("Issues");
    expect(html).toContain("Actions");
    // At least one unavailability signal
    expect(html).toMatch(
      /not available|coming soon|unavailable|not connected/i,
    );
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
});
