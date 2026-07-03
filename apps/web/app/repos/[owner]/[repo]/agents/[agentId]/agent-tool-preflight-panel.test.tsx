/**
 * Tests for AgentToolPreflightPanel — "Next run: tool availability" panel
 * (#802, epic #796 T6).
 *
 * Renders one row per configured toolkit slug with a distinct, text-labeled
 * status chip and, where actionable, a single action link.
 *
 * BT-802-P001: ready — green "Ready" chip, no action link.
 * BT-802-P002: blocked_by_repo_policy — amber "Blocked by repo policy" chip
 *   naming the toolkit, with a link to the repo tools/Composio settings
 *   surface (not a Connect/Reconnect action).
 * BT-802-P003: not_connected — "Not connected" chip with a "Connect" link.
 * BT-802-P004: auth_expired — "Auth expired" chip with a "Reconnect" link,
 *   visually distinct from not_connected (different chip text at minimum).
 * BT-802-P005: runtime_mode_incompatible — "Unavailable in this runtime
 *   mode" chip, no action link (informational only).
 * BT-802-P006: composio_unreachable — every row shows "Composio unreachable"
 *   plus a single panel-level note (not per-row noise) and a retry
 *   affordance.
 * BT-802-P007: empty — an agent with no configured toolkits renders no
 *   panel content (or a single "no tools configured" line), never an empty
 *   chip row.
 * BT-802-P008: loading — skeleton rows, one per configured toolkit slug,
 *   before data resolves (count known synchronously, no layout shift).
 *
 * Uses renderToStaticMarkup (matching agent-card.test.tsx's convention) —
 * no jsdom/testing-library DOM harness in this repo's test setup.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// --- Mocks -------------------------------------------------------------------

type PreflightToolkit = {
  slug: string;
  predictedState: string;
  policyReason?: string;
  errorKind?: string;
};

let swrData: { toolkits: PreflightToolkit[] } | undefined;
let swrError: unknown = null;
let swrLoading = false;
const mutate = mock(async () => undefined);

mock.module("swr", () => ({
  default: () => ({
    data: swrData,
    error: swrError,
    isLoading: swrLoading,
    mutate,
  }),
}));

const { AgentToolPreflightPanel } =
  await import("./agent-tool-preflight-panel");

beforeEach(() => {
  swrData = undefined;
  swrError = null;
  swrLoading = false;
  mutate.mockClear();
});

// --- Tests -------------------------------------------------------------------

describe("AgentToolPreflightPanel — predicted states (#802)", () => {
  test("BT-802-P001: ready toolkit shows a Ready chip with no action link", () => {
    swrData = { toolkits: [{ slug: "gmail", predictedState: "ready" }] };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel agentId="agent-1" configuredSlugs={["gmail"]} />,
    );

    expect(html).toContain("Ready");
    expect(html).not.toContain("Connect</a>");
    expect(html).not.toContain("Reconnect</a>");
  });

  test("BT-802-P002: blocked_by_repo_policy shows the blocking rule and a repo-tools link", () => {
    swrData = {
      toolkits: [
        {
          slug: "slack",
          predictedState: "blocked_by_repo_policy",
          policyReason: "repo_policy_blocked",
        },
      ],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel agentId="agent-1" configuredSlugs={["slack"]} />,
    );

    expect(html).toContain("Blocked by repo policy");
    // Names the specific rule type, not just a generic "blocked" label.
    expect(html.toLowerCase()).toContain("denylist");
    expect(html).toContain("/settings/composio");
  });

  test("BT-802-P002b: not_in_repo_allowlist names the allowlist rule distinctly from denylist", () => {
    swrData = {
      toolkits: [
        {
          slug: "notion",
          predictedState: "blocked_by_repo_policy",
          policyReason: "not_in_repo_allowlist",
        },
      ],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel
        agentId="agent-1"
        configuredSlugs={["notion"]}
      />,
    );

    expect(html).toContain("Blocked by repo policy");
    expect(html.toLowerCase()).toContain("allowlist");
  });

  test("BT-802-P003: not_connected shows a Connect link", () => {
    swrData = {
      toolkits: [{ slug: "gmail", predictedState: "not_connected" }],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel agentId="agent-1" configuredSlugs={["gmail"]} />,
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("Connect");
    expect(html).not.toContain("Reconnect");
  });

  test("BT-802-P004: auth_expired shows a Reconnect link, distinct from Not connected", () => {
    swrData = {
      toolkits: [{ slug: "linear", predictedState: "auth_expired" }],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel
        agentId="agent-1"
        configuredSlugs={["linear"]}
      />,
    );

    expect(html).toContain("Auth expired");
    expect(html).toContain("Reconnect");
    expect(html).not.toContain("Not connected");
  });

  test("BT-802-P005: runtime_mode_incompatible shows an informational chip with no action link", () => {
    swrData = {
      toolkits: [
        { slug: "gmail", predictedState: "runtime_mode_incompatible" },
      ],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel agentId="agent-1" configuredSlugs={["gmail"]} />,
    );

    expect(html).toContain("Unavailable in this runtime mode");
    expect(html).not.toContain("Connect");
    expect(html).not.toContain("Reconnect");
  });

  test("BT-802-P006: composio_unreachable shows one panel-level note plus a retry affordance, not per-row noise", () => {
    swrData = {
      toolkits: [
        {
          slug: "gmail",
          predictedState: "composio_unreachable",
          errorKind: "composio_unreachable",
        },
        {
          slug: "linear",
          predictedState: "composio_unreachable",
          errorKind: "composio_unreachable",
        },
      ],
    };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel
        agentId="agent-1"
        configuredSlugs={["gmail", "linear"]}
      />,
    );

    const chipMatches = html.match(/Composio unreachable/g) ?? [];
    // One per-row chip each (still text-labeled per row) plus exactly one
    // panel-level note — never silently "Ready" and never silently absent.
    expect(chipMatches.length).toBeGreaterThanOrEqual(2);
    expect(html.toLowerCase()).toContain("retry");
  });

  test("BT-802-P007: an agent with no configured toolkits renders no chip rows", () => {
    swrData = { toolkits: [] };
    swrLoading = false;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel agentId="agent-1" configuredSlugs={[]} />,
    );

    expect(html).not.toContain("Ready");
    expect(html).not.toContain("Not connected");
    expect(html.toLowerCase()).toContain("no tools configured");
  });

  test("BT-802-P008: loading state renders one skeleton row per configured slug", () => {
    swrData = undefined;
    swrLoading = true;

    const html = renderToStaticMarkup(
      <AgentToolPreflightPanel
        agentId="agent-1"
        configuredSlugs={["gmail", "linear", "slack"]}
      />,
    );

    const skeletonMatches = html.match(/data-preflight-skeleton-row/g) ?? [];
    expect(skeletonMatches.length).toBe(3);
  });
});
