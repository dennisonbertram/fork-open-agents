/**
 * RepoProjectPage tests
 *
 * The Project page is the new home for AgentsWindow and WorkflowsWindowView
 * after they were moved off the repo dashboard (page.tsx). These tests mirror
 * the mocking style of the sibling ../page.test.tsx and cover the behavioral
 * contracts that were relocated from the dashboard.
 *
 * Covered:
 *   BT-004 (agents half): AgentsWindow renders background-agent store data
 *   REDACT-001: agent instructions beyond 140 chars truncated server-side
 *   BT-005 (agents half): empty state when no agents
 *   REGRESSION-001: multiple agents with multiple triggers rendered correctly
 *   BT-PAGE-WF-002: flag on + loops exist → Workflows window with loop names
 *   BT-PAGE-WF-004: listAgentLoops called with userId, repoOwner, repoName
 *   BT-PAGE-WF-FLAG-OFF: flag off → Workflows window absent, listAgentLoops not called
 *   BT-PROJECT-HEADER: header links back to dashboard and to Agents settings
 *   BT-PROJECT-UNAUTH: unauthenticated visitors are redirected
 */

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

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents,
  // listBackgroundAgentRuns not used by project page but kept for module shape
  listBackgroundAgentRuns: async () => [],
}));

// Agent Loops — controlled via mutable state per test.
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

// Lazy-import the project page after mocks are wired.
const pageModulePromise = import("./page");

describe("RepoProjectPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    agentLoopsEnabled = false;
    mockLoops = [];
    loopsFetchShouldThrow = false;
    redirect.mockClear();
    listRepoBackgroundAgents.mockClear();
    listAgentLoops.mockClear();
  });

  // BT-PROJECT-UNAUTH: unauthenticated visitor is redirected
  test("BT-PROJECT-UNAUTH: redirects unauthenticated visitors", async () => {
    sessionUserId = null;
    const { default: RepoProjectPage } = await pageModulePromise;

    await expect(
      RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalled();
  });

  // BT-PROJECT-HEADER: page header contains back link to dashboard and Agents settings
  test("BT-PROJECT-HEADER: header links back to repo dashboard and to Agents settings", async () => {
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Page heading
    expect(html).toContain("Project");
    // owner/repo label
    expect(html).toContain("acme/widgets");
    // Back link to repo dashboard
    expect(html).toContain("/repos/acme/widgets");
    // Link to agents settings
    expect(html).toContain("/settings/background-agents");
  });

  // BT-004 (agents half): AgentsWindow renders background-agent store data
  test("BT-004: AgentsWindow renders background-agent data from the store", async () => {
    repoAgents = [
      {
        id: "agent-1",
        name: "Deploy smoke",
        status: "enabled",
        instructions: "Run smoke checks after deployments.",
        triggers: [{ id: "trigger-1", kind: "github.deployment_status" }],
      },
    ];
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Store called with the right args
    expect(listRepoBackgroundAgents).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    // Agent data visible
    expect(html).toContain("Deploy smoke");
    // Short instruction is under the 140-char cap — rendered as-is (no ellipsis)
    expect(html).toContain("Run smoke checks after deployments.");
    // Trigger chip visible
    expect(html).toContain("github.deployment_status");
  });

  // REDACT-001: long agent instructions must be server-side truncated
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
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // The secret marker lives past position 140 — it must not appear in rendered HTML
    expect(html).not.toContain(secretSuffix);
    // The truncated preview (first 140 chars + ellipsis) must be present
    expect(html).toContain("A".repeat(140) + "…");
  });

  // BT-005 (agents half): empty state when no agents configured
  test("BT-005: shows 'No agents configured' empty state when no agents exist", async () => {
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("No agents configured");
  });

  // REGRESSION-001: multiple agents with multiple triggers rendered correctly
  test("REGRESSION-001: project page renders correctly with multiple agents and triggers", async () => {
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
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
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
  });

  // BT-PAGE-WF-FLAG-OFF: flag off → Workflows window absent, listAgentLoops not called
  test("BT-PAGE-WF-FLAG-OFF: when AGENT_LOOPS_ENABLED=false, Workflows window is absent", async () => {
    agentLoopsEnabled = false;
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // Project page renders without Workflows window
    expect(html).toContain("Project");
    // Workflows window MUST NOT appear when flag is off
    expect(html).not.toContain('aria-label="Loops window"');
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
    const { default: RepoProjectPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoProjectPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Loops");
    expect(html).toContain("CI pipeline loop");
    expect(html).toContain("/loops/loop-abc");
  });

  // BT-PAGE-WF-004: listAgentLoops called with correct params when flag on
  test("BT-PAGE-WF-004: when flag on, listAgentLoops is called with userId, repoOwner, repoName", async () => {
    agentLoopsEnabled = true;
    mockLoops = [];
    const { default: RepoProjectPage } = await pageModulePromise;

    await RepoProjectPage({
      params: Promise.resolve({ owner: "myorg", repo: "myrepo" }),
    });

    expect(listAgentLoops).toHaveBeenCalledWith("user-1", {
      repoOwner: "myorg",
      repoName: "myrepo",
    });
  });

  // BT-PROJECT-LOOPS-ISOLATION: loops fetch error → page still renders
  test("BT-PROJECT-LOOPS-ISOLATION: loops fetch failure does not crash the project page", async () => {
    agentLoopsEnabled = true;
    loopsFetchShouldThrow = true;
    const { default: RepoProjectPage } = await pageModulePromise;

    let html: string;
    try {
      html = renderToStaticMarkup(
        await RepoProjectPage({
          params: Promise.resolve({ owner: "acme", repo: "widgets" }),
        }),
      );
    } catch {
      throw new Error(
        "Project page crashed when loops fetch failed — Promise.allSettled isolation broken",
      );
    }

    expect(html).toContain("Project");
    expect(html).toContain("Project agents");
  });
});
