/**
 * BT-TW-001: repo dashboard renders a "Tools" tab/trigger.
 * BT-TW-002: selecting the Tools tab shows a list of toolkits with status
 *   chips (rendered via Radix Tabs, all TabsContent render server-side so
 *   this is directly observable under renderToStaticMarkup like the other
 *   dashboard tabs — see page-review-fixes.test.tsx for the same pattern).
 * BT-TW-003: every one of the five effective statuses renders with distinct,
 *   plain-language text (not color/icon alone — findings W3/W5).
 * BT-TW-004: a not-connected toolkit shows a "Connect" link, not a bare
 *   allow/block toggle implying the tool would work if unblocked.
 *
 * #805, epic #796 T9 — red first: ToolsWindow does not exist yet.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolsWindow } from "./tools-window";
import type { RepoToolkitEffectiveStatus } from "@/lib/composio/repo-tools-effective-status";

function makeStatuses(): RepoToolkitEffectiveStatus[] {
  return [
    { slug: "github", name: "GitHub", status: "default_on" },
    { slug: "slack", name: "Slack", status: "selected" },
    { slug: "figma", name: "Figma", status: "allowed" },
    {
      slug: "gmail",
      name: "Gmail",
      status: "blocked",
      blockReason: "repo_policy_blocked",
    },
    {
      slug: "linear",
      name: "Linear",
      status: "blocked",
      blockReason: "not_in_repo_allowlist",
    },
    { slug: "notion", name: "Notion", status: "not_connected" },
  ];
}

describe("ToolsWindow", () => {
  test("BT-TW-001: renders a heading identifying the Tools surface", () => {
    const html = renderToStaticMarkup(
      <ToolsWindow
        repoOwner="acme"
        repoName="widgets"
        toolStatuses={makeStatuses()}
      />,
    );
    expect(html).toContain("Tools");
  });

  test("BT-TW-002: lists every toolkit passed in", () => {
    const html = renderToStaticMarkup(
      <ToolsWindow
        repoOwner="acme"
        repoName="widgets"
        toolStatuses={makeStatuses()}
      />,
    );
    expect(html).toContain("GitHub");
    expect(html).toContain("Slack");
    expect(html).toContain("Gmail");
    expect(html).toContain("Linear");
    expect(html).toContain("Notion");
  });

  test("BT-TW-003: each of the five statuses renders distinct plain-language text", () => {
    const html = renderToStaticMarkup(
      <ToolsWindow
        repoOwner="acme"
        repoName="widgets"
        toolStatuses={makeStatuses()}
      />,
    );
    // Plain language, not raw status vocabulary
    expect(html.toLowerCase()).toContain("allowed");
    expect(html.toLowerCase()).toContain("blocked");
    expect(html.toLowerCase()).toContain("default");
    expect(html.toLowerCase()).toContain("not connected");
    // The two distinct block reasons must not collapse into identical copy
    expect(html).toContain("repo policy");
    expect(html.toLowerCase()).toMatch(/not in .*allowlist|not selected/);
  });

  test("BT-TW-004: not-connected toolkit links to connect, not a bare toggle", () => {
    const html = renderToStaticMarkup(
      <ToolsWindow
        repoOwner="acme"
        repoName="widgets"
        toolStatuses={makeStatuses()}
      />,
    );
    expect(html).toContain("/settings/composio");
    expect(html.toLowerCase()).toContain("connect");
  });

  test("BT-TW-005: empty toolkit list explains what connecting does", () => {
    const html = renderToStaticMarkup(
      <ToolsWindow repoOwner="acme" repoName="widgets" toolStatuses={[]} />,
    );
    expect(html.toLowerCase()).toContain("connect");
  });
});
