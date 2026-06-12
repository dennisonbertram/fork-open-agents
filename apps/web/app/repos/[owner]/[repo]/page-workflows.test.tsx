/**
 * Dashboard page integration tests for WorkflowsWindow (M2-05 / #361)
 *
 * Behavior contract:
 *   BT-PAGE-WF-001: flag off → dashboard renders without Workflows window, other windows intact
 *   BT-PAGE-WF-002: flag on + loops → Workflows window inserted between Agents and Activity
 *   BT-PAGE-WF-003: loops fetch error → dashboard still renders (Promise.allSettled isolation)
 *   BT-PAGE-WF-004: flag on → listAgentLoops called with correct userId + repo params
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Mutable state for mocks ───────────────────────────────────────────────────
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
let agentLoopsEnabled = false;
let mockLoops: Array<{
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  repoOwner: string;
  repoName: string;
  updatedAt: Date;
}> = [];
let loopsFetchShouldThrow = false;

// ── Mocks ─────────────────────────────────────────────────────────────────────

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const listRepoBackgroundAgents = mock(async () => repoAgents);
const listBackgroundAgentRuns = mock(async () => repoRuns);
const listAgentLoops = mock(async () => {
  if (loopsFetchShouldThrow) throw new Error("DB failed");
  return mockLoops;
});

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents,
  listBackgroundAgentRuns,
}));

mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async () => ({
    prSummary: { ok: true, prs: [] },
    issueSummary: { ok: true, totalOpen: 0, recent: [] },
    actionsSummary: { ok: true, latestStatus: "passing", recentRuns: [] },
  }),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => agentLoopsEnabled,
}));

mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoops,
}));

const pageModulePromise = import("./page");

describe("Dashboard page — WorkflowsWindow integration", () => {
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

  // BT-PAGE-WF-001: flag off → Workflows window absent, other windows intact
  test("BT-PAGE-WF-001: when AGENT_LOOPS_ENABLED=false, Workflows window is absent but other windows render", async () => {
    agentLoopsEnabled = false;
    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Dashboard still renders with all existing windows
    expect(html).toContain("Repo dashboard");
    expect(html).toContain("Overview");
    expect(html).toContain("Project agents");
    expect(html).toContain("Activity");
    // Workflows window MUST NOT appear when flag is off
    expect(html).not.toContain("aria-label=\"Workflows window\"");
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

  // BT-PAGE-WF-003: loops fetch error → dashboard still renders (Promise.allSettled isolation)
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

    // Other windows must still render
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
