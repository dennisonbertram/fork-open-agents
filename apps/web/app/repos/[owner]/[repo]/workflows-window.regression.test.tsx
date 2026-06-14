/**
 * Workflows window regression tests (M2-05 / #361)
 *
 * These tests catch future breakage of the key behaviors introduced by #361.
 * Each test would FAIL if the feature were reverted or the behavior were broken.
 *
 * Regression scenarios:
 *   REG-WF-001: flag-off renders null — if guard is removed, the window appears
 *   REG-WF-002: single workflow uses "workflow" (singular), not "workflows"
 *   REG-WF-003: loop row produces a deep link to /loops/[id]
 *   REG-WF-004: active status → emerald; paused → amber (pill extension pinned)
 *   REG-WF-005: empty state CTA encodes repoOwner and repoName in query params
 *   REG-WF-006: fetch failure degrades to empty state (does not propagate throw)
 *   REG-WF-007: (in loop-create-form-params.test.tsx) initialRepoOwner/initialRepoName props
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardStatusPill } from "./dashboard-status-pill";

// ── Mocks for WorkflowsWindow ─────────────────────────────────────────────────

let agentLoopsEnabled = false;
let mockLoops: Array<{
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  repoOwner: string;
  repoName: string;
  updatedAt: Date;
  description: string | null;
}> = [];
let loopsFetchShouldThrow = false;

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => agentLoopsEnabled,
}));

mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoops: async () => {
    if (loopsFetchShouldThrow) throw new Error("DB error");
    return mockLoops;
  },
}));

const windowModulePromise = import("./workflows-window");

// ── Regression tests ──────────────────────────────────────────────────────────

describe("WorkflowsWindow regressions", () => {
  // REG-WF-001: flag-off guard — if isAgentLoopsEnabled returns false, null
  test("REG-WF-001: flag-off guard — renders null when flag is off", async () => {
    agentLoopsEnabled = false;
    mockLoops = [];
    loopsFetchShouldThrow = false;

    const { WorkflowsWindow } = await windowModulePromise;
    const result = await WorkflowsWindow({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    // Must be null — NOT a rendered element
    expect(result).toBeNull();
  });

  // REG-WF-002: singular "workflow" for exactly 1 loop
  test("REG-WF-002: buildWorkflowsSummary uses singular 'workflow' for count=1", async () => {
    const { buildWorkflowsSummary } = await windowModulePromise;

    const summary = buildWorkflowsSummary([{ status: "active" }]);
    expect(summary).toContain("1 loop");
    expect(summary).not.toContain("1 loops");
  });

  // REG-WF-003: loop row renders /loops/[id] deep link
  test("REG-WF-003: loop rows contain deep links to /loops/[id]", async () => {
    agentLoopsEnabled = true;
    mockLoops = [
      {
        id: "loop-deeplink",
        name: "Deep link test",
        status: "draft",
        repoOwner: "acme",
        repoName: "widgets",
        updatedAt: new Date(),
        description: null,
      },
    ];
    loopsFetchShouldThrow = false;

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );

    expect(html).toContain("/loops/loop-deeplink");
  });

  // REG-WF-004: pill extension pinned — active must be emerald, paused amber
  test("REG-WF-004: DashboardStatusPill active→emerald, paused→amber (pill extension pinned)", () => {
    const activeHtml = renderToStaticMarkup(
      <DashboardStatusPill status="active" />,
    );
    const pausedHtml = renderToStaticMarkup(
      <DashboardStatusPill status="paused" />,
    );

    expect(activeHtml).toContain("emerald");
    expect(pausedHtml).toContain("amber");
    // Sanity: these would fail if the extension were reverted
    expect(activeHtml).not.toContain("bg-muted/40");
    expect(pausedHtml).not.toContain("bg-muted/40");
  });

  // REG-WF-005: empty state CTA encodes repo params in query string
  test("REG-WF-005: empty state CTA encodes repoOwner and repoName in the /loops/new URL", async () => {
    agentLoopsEnabled = true;
    mockLoops = [];
    loopsFetchShouldThrow = false;

    const { WorkflowsWindow } = await windowModulePromise;
    const html = renderToStaticMarkup(
      await WorkflowsWindow({
        userId: "user-1",
        repoOwner: "my org",
        repoName: "my repo",
      }),
    );

    // Encodes spaces as %20 in the URL
    expect(html).toContain("repoOwner=my%20org");
    expect(html).toContain("repoName=my%20repo");
  });

  // REG-WF-006: fetch failure degrades to empty state (no propagation)
  test("REG-WF-006: fetch failure renders empty state — does not propagate the error", async () => {
    agentLoopsEnabled = true;
    loopsFetchShouldThrow = true;

    const { WorkflowsWindow } = await windowModulePromise;

    let html: string;
    try {
      html = renderToStaticMarkup(
        await WorkflowsWindow({
          userId: "user-1",
          repoOwner: "acme",
          repoName: "widgets",
        }),
      );
    } catch {
      throw new Error(
        "REG-WF-006 FAILED: WorkflowsWindow propagated fetch error instead of degrading gracefully",
      );
    }

    // Renders the Workflows section, not an exception
    expect(html).toContain("Loops");
    // Empty state copy
    expect(html).toMatch(/no loops|create.*loop/i);
  });
});
