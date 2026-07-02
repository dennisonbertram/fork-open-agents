/**
 * Loops list page component tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-001: Loop cards render name, repo badge, status when loops loaded
 *   BT-LOOPS-002: Empty state renders when no loops exist
 *   BT-LOOPS-003: Skeleton loading renders when data is undefined
 *   BT-LOOPS-004: Inline error state renders when fetch fails
 *   BT-LOOPS-005: Feature-disabled readiness verdict renders when flag is off
 *   BT-LOOPS-GATE-005: EmptyState with createEnabled=false renders no /loops/new link (issue #392)
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── SWR mock ──────────────────────────────────────────────────────────────────

type SWRState<T> = { data?: T; error?: Error; isLoading: boolean };
let _swrOverride: SWRState<unknown> = { isLoading: false };

mock.module("swr", () => ({
  default: <T,>(_key: string) => _swrOverride as SWRState<T>,
}));

const loopsListModulePromise = import("./loops-list");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLoop(
  overrides: Partial<{
    id: string;
    name: string;
    repoOwner: string;
    repoName: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> = {},
) {
  return {
    id: "loop_abc123",
    name: "My Test Loop",
    repoOwner: "acme",
    repoName: "widgets",
    status: "active",
    description: null,
    guardrails: null,
    definition: { nodes: [], edges: [] },
    permissions: {},
    userId: "user_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LoopsList", () => {
  // BT-LOOPS-001: cards render name, repo badge, status
  test("BT-LOOPS-001: renders loop cards with name, repo, and status when loops present", async () => {
    _swrOverride = {
      data: {
        loops: [
          makeLoop(),
          makeLoop({ id: "loop_2", name: "Second Loop", status: "paused" }),
        ],
      },
      isLoading: false,
    };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    expect(html).toContain("My Test Loop");
    expect(html).toContain("Second Loop");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("active");
    expect(html).toContain("paused");
  });

  // BT-LOOPS-002: empty state
  test("BT-LOOPS-002: renders empty state when no loops exist", async () => {
    _swrOverride = { data: { loops: [] }, isLoading: false };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    // Should invite creation
    expect(html).toContain("No loops");
  });

  // BT-LOOPS-002c (#768): empty state must define the concept, not just
  // restate the button. A naive user landing here has no idea what a "loop"
  // is; the empty state is the first and only explanation before they must
  // commit to creating one.
  test("BT-LOOPS-002c: empty state explains what a loop is (concept, not just CTA)", async () => {
    _swrOverride = { data: { loops: [] }, isLoading: false };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    // Must define the concept: multi-step agent pipeline against a repo.
    expect(html).toContain("multi-step agent pipeline");
    // Must give a concrete example so "loop" isn't just jargon restated.
    expect(html).toContain("review new PRs and comment");
    // Must mention step ordering / failure handling — the two things a
    // naive user needs to know before building one.
    expect(html).toMatch(/steps run in order/i);
  });

  // BT-LOOPS-003: skeleton loading
  test("BT-LOOPS-003: renders skeleton loading when data is loading", async () => {
    _swrOverride = { data: undefined, isLoading: true };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    // Skeleton has animate-pulse or similar loading indicator
    expect(html).toContain("animate-pulse");
  });

  // BT-LOOPS-004: error state
  test("BT-LOOPS-004: renders error state when fetch fails", async () => {
    _swrOverride = {
      data: undefined,
      error: new Error("Network error"),
      isLoading: false,
    };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    expect(html).toContain("Failed to load");
  });

  // BT-LOOPS-005: feature flag disabled → readiness verdict
  test("BT-LOOPS-005: renders readiness verdict when feature disabled (403 errorKind=feature_disabled)", async () => {
    _swrOverride = {
      data: undefined,
      error: Object.assign(new Error("Feature disabled"), {
        status: 403,
        errorKind: "feature_disabled",
      }),
      isLoading: false,
    };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList />);

    expect(html).toContain("disabled");
  });

  // BT-LOOPS-GATE-005: EmptyState with createEnabled=false has no /loops/new link
  test("BT-LOOPS-GATE-005: EmptyState with createEnabled=false renders no /loops/new link", async () => {
    _swrOverride = { data: { loops: [] }, isLoading: false };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList createEnabled={false} />);

    // Empty state text still renders (explanation present)
    expect(html).toContain("No loops");
    // But no dead-end link to create form
    expect(html).not.toContain("/loops/new");
  });

  // BT-LOOPS-002b: EmptyState with createEnabled=true (default) has /loops/new link
  test("BT-LOOPS-002b: EmptyState with createEnabled=true (default) shows /loops/new link", async () => {
    _swrOverride = { data: { loops: [] }, isLoading: false };
    const { LoopsList } = await loopsListModulePromise;
    const html = renderToStaticMarkup(<LoopsList createEnabled={true} />);

    expect(html).toContain("/loops/new");
  });
});
