/**
 * Loops list page component tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-001: Loop cards render name, repo badge, status when loops loaded
 *   BT-LOOPS-002: Empty state renders when no loops exist
 *   BT-LOOPS-003: Skeleton loading renders when data is undefined
 *   BT-LOOPS-004: Inline error state renders when fetch fails
 *   BT-LOOPS-005: Feature-disabled readiness verdict renders when flag is off
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
      data: { loops: [makeLoop(), makeLoop({ id: "loop_2", name: "Second Loop", status: "paused" })] },
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
});
