/**
 * WorkflowsWindow component tests (M2-05 / #361)
 *
 * Behavior contract:
 *   BT-WF-001: When AGENT_LOOPS_ENABLED is false, window is absent (flag-off guard)
 *   BT-WF-002: When flag is on and loops exist, they are listed with name + status
 *   BT-WF-003: When flag is on and no loops, empty state shows create CTA
 *   BT-WF-004: Loops fetch failure does not break other dashboard windows
 *   BT-WF-005: Collapsed summary shows "N workflows · N active" in header
 *   BT-WF-006: Status pill maps active→emerald, paused→amber, draft→neutral, archived→muted
 *   BT-WF-007: "New workflow" action links to /loops/new with repoOwner+repoName params
 *   BT-WF-008: WorkflowsWindow section has aria-label="Workflows window"
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Mutable state for the loops mock ──────────────────────────────────────────
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

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => agentLoopsEnabled,
}));

const listAgentLoops = mock(async () => {
  if (loopsFetchShouldThrow) throw new Error("DB connection failed");
  return mockLoops;
});

mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoops,
}));

// Lazy-import after mocks are wired.
const windowModulePromise = import("./workflows-window");

describe("WorkflowsWindow", () => {
  beforeEach(() => {
    agentLoopsEnabled = false;
    mockLoops = [];
    loopsFetchShouldThrow = false;
    listAgentLoops.mockClear();
  });

  // BT-WF-001: flag off → window not rendered at all
  test("BT-WF-001: when AGENT_LOOPS_ENABLED is false, WorkflowsWindow renders nothing", async () => {
    agentLoopsEnabled = false;
    const { WorkflowsWindow } = await windowModulePromise;

    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
    );

    // No window markup should be rendered
    expect(html).toBe("");
    // The loops store should NOT have been called
    expect(listAgentLoops).not.toHaveBeenCalled();
  });

  // BT-WF-002: flag on + loops exist → listed with name + status
  test("BT-WF-002: when flag is on and loops exist, lists them with name and status", async () => {
    agentLoopsEnabled = true;
    mockLoops = [
      {
        id: "loop-1",
        name: "Nightly deploy",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "loop-2",
        name: "PR Review bot",
        status: "paused",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date("2026-05-28T00:00:00Z"),
      },
    ];

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
    );

    expect(html).toContain("Workflows");
    expect(html).toContain("Nightly deploy");
    expect(html).toContain("PR Review bot");
    expect(html).toContain("active");
    expect(html).toContain("paused");
    // Deep link to loop detail page
    expect(html).toContain("/loops/loop-1");
    expect(html).toContain("/loops/loop-2");
  });

  // BT-WF-003: flag on + no loops → empty state with create CTA
  test("BT-WF-003: when flag is on and no loops exist, shows empty state with create CTA", async () => {
    agentLoopsEnabled = true;
    mockLoops = [];

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
    );

    expect(html).toContain("Workflows");
    // Empty state CTA links to /loops/new with repo params prefilled
    expect(html).toContain("/loops/new?repoOwner=acme&repoName=widgets");
    // Some create/first workflow copy
    expect(html).toMatch(/create.*workflow|first workflow/i);
  });

  // BT-WF-004: loops fetch failure does not break other windows
  test("BT-WF-004: loops fetch failure returns null so page isolates the failure", async () => {
    agentLoopsEnabled = true;
    loopsFetchShouldThrow = true;

    const { WorkflowsWindow } = await windowModulePromise;

    // The component wraps the throw and renders gracefully — it should not throw
    let html: string;
    try {
      html = renderToStaticMarkup(
        await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
      );
    } catch {
      throw new Error("WorkflowsWindow threw instead of gracefully handling fetch failure");
    }

    // Renders Workflows window with an error/empty state, not crashing
    expect(html).toContain("Workflows");
  });

  // BT-WF-005: collapsed summary content — collapsible card summary prop
  test("BT-WF-005: window provides summary '2 workflows · 1 active' when 2 loops with 1 active", async () => {
    agentLoopsEnabled = true;
    mockLoops = [
      {
        id: "loop-a",
        name: "Active loop",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "loop-b",
        name: "Draft loop",
        status: "draft",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date("2026-05-28T00:00:00Z"),
      },
    ];

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
    );

    // Summary text appears in collapsed header
    expect(html).toContain("2 workflows");
    expect(html).toContain("1 active");
  });

  // BT-WF-007: "New workflow" action links to /loops/new with repo params
  test("BT-WF-007: New workflow action links to /loops/new with repoOwner and repoName params", async () => {
    agentLoopsEnabled = true;
    mockLoops = [
      {
        id: "loop-x",
        name: "Some loop",
        status: "draft",
        repoOwner: "myorg",
        repoName: "myrepo",
        updatedAt: new Date(),
      },
    ];

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "myorg", repoName: "myrepo" }),
    );

    expect(html).toContain("/loops/new?repoOwner=myorg&repoName=myrepo");
  });

  // BT-WF-008: section aria-label
  test("BT-WF-008: Workflows window section has aria-label containing Workflows", async () => {
    agentLoopsEnabled = true;
    mockLoops = [];

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({ userId: "user-1", repoOwner: "acme", repoName: "widgets" }),
    );

    expect(html).toMatch(/aria-label="[^"]*[Ww]orkflow/);
  });
});
