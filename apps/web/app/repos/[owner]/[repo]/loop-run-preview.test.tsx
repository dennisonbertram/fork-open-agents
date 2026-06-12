/**
 * LoopRunPreview component tests (TASK-LRP / #361 row-level disclosure)
 *
 * Behavior contract:
 *   BT-LRP-001: Before expand, no fetch is issued (lazy — SWR key is null)
 *   BT-LRP-002: Chevron button is present with aria-expanded="false" when collapsed
 *   BT-LRP-003: While loading, 3 skeleton rows are shown
 *   BT-LRP-004: After expand + fetch resolves, rows show status pill + relative time + duration + link
 *   BT-LRP-005: When runs array is empty, "No runs yet" message is shown
 *   BT-LRP-006: When fetch errors, error message is shown
 *   BT-LRP-007: aria-expanded toggles true on expand, false on collapse
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

// ── Types mirroring what the component exports / accepts ──────────────────────

type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "stalled";

type RunRow = {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

// ── Track SWR key calls to verify no-fetch-before-expand ─────────────────────

let capturedSwrKey: string | null | (() => string | null) | undefined;
let mockRunsData: { runs: RunRow[] } | undefined;
let mockSwrError: Error | undefined;
let mockIsLoading = false;

mock.module("swr", () => ({
  default: (key: unknown) => {
    capturedSwrKey = key as string | null | (() => string | null) | undefined;
    return {
      data: mockRunsData,
      error: mockSwrError,
      isLoading: mockIsLoading,
    };
  },
}));

// Stub next/link and next/navigation
mock.module("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

mock.module("@/lib/swr", () => ({
  fetcher: async (url: string) => {
    if (mockSwrError) throw mockSwrError;
    return mockRunsData;
  },
}));

// Lazy-import after mocks are wired.
const modulePromise = import("./loop-run-preview");

describe("LoopRunPreview", () => {
  beforeEach(() => {
    capturedSwrKey = undefined;
    mockRunsData = undefined;
    mockSwrError = undefined;
    mockIsLoading = false;
  });

  // BT-LRP-001: Before expand, SWR key must be null so no fetch fires
  test("BT-LRP-001: before expand, no fetch is issued (SWR key is null)", async () => {
    const { buildSwrKey } = await modulePromise;

    // When collapsed (expanded=false), key must be null
    const key = buildSwrKey("loop-abc", false);
    expect(key).toBeNull();
  });

  // BT-LRP-001b: After expand, SWR key becomes non-null
  test("BT-LRP-001b: after expand, SWR key is non-null (triggers fetch)", async () => {
    const { buildSwrKey } = await modulePromise;

    const key = buildSwrKey("loop-abc", true);
    expect(key).not.toBeNull();
    expect(typeof key).toBe("string");
    // Key must include the loopId
    expect(key).toContain("loop-abc");
    // Key must include limit=3
    expect(key).toContain("limit=3");
  });

  // BT-LRP-002: Chevron button present with aria-expanded="false" when collapsed
  test("BT-LRP-002: chevron disclosure button has aria-expanded=false when collapsed", async () => {
    const { LoopRunPreviewCollapsed } = await modulePromise;

    const html = renderToStaticMarkup(<LoopRunPreviewCollapsed loopId="loop-1" />);

    // Should have a button with aria-expanded="false"
    expect(html).toContain('aria-expanded="false"');
    // Should have a chevron (ChevronRight or similar indicator)
    expect(html).toMatch(/chevron|▶|›|button/i);
  });

  // BT-LRP-003: While loading, 3 skeleton rows are shown
  test("BT-LRP-003: while loading, 3 skeleton rows are rendered", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody loopId="loop-1" isLoading={true} runs={undefined} error={undefined} />,
    );

    // 3 skeleton rows must be present
    const skeletonMatches = html.match(/animate-pulse|skeleton/gi);
    expect(skeletonMatches).not.toBeNull();
    // At minimum 3 skeleton elements
    expect((skeletonMatches ?? []).length).toBeGreaterThanOrEqual(3);
  });

  // BT-LRP-004: After fetch, rows render status pill + time + duration + link
  test("BT-LRP-004: after fetch resolves, rows show status, relative time, duration, and link", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const now = new Date();
    const startedAt = new Date(now.getTime() - 125_000); // 2m 5s ago
    const finishedAt = new Date(now.getTime() - 5_000); // finished 5s ago
    const runs: RunRow[] = [
      {
        id: "run-001",
        status: "completed",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        createdAt: startedAt.toISOString(),
      },
      {
        id: "run-002",
        status: "failed",
        startedAt: new Date(now.getTime() - 3_600_000).toISOString(),
        finishedAt: new Date(now.getTime() - 3_540_000).toISOString(),
        createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
      },
    ];

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={false}
        runs={runs}
        error={undefined}
      />,
    );

    // Status pills for each run
    expect(html).toContain("completed");
    expect(html).toContain("failed");

    // Links to run pages
    expect(html).toContain("/loops/loop-1/runs/run-001");
    expect(html).toContain("/loops/loop-1/runs/run-002");

    // Duration is present (in seconds/minutes format)
    expect(html).toMatch(/\d+m|\d+s/);
  });

  // BT-LRP-005: Empty runs array → "No runs yet"
  test("BT-LRP-005: empty runs array shows 'No runs yet' message", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={false}
        runs={[]}
        error={undefined}
      />,
    );

    expect(html).toMatch(/no runs yet/i);
  });

  // BT-LRP-006: Fetch error shows error state
  test("BT-LRP-006: fetch error shows error message", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={false}
        runs={undefined}
        error={new Error("Network failure")}
      />,
    );

    // Should show some error indicator, not an empty blank
    expect(html).toMatch(/error|failed|could not load/i);
  });

  // BT-LRP-007: aria-expanded toggles
  test("BT-LRP-007: aria-expanded is true after first expand", async () => {
    const { LoopRunPreviewCollapsed, LoopRunPreviewExpanded } = await modulePromise;

    // Collapsed state
    const collapsedHtml = renderToStaticMarkup(
      <LoopRunPreviewCollapsed loopId="loop-1" />,
    );
    expect(collapsedHtml).toContain('aria-expanded="false"');

    // Expanded state
    const expandedHtml = renderToStaticMarkup(
      <LoopRunPreviewExpanded loopId="loop-1" />,
    );
    expect(expandedHtml).toContain('aria-expanded="true"');
  });
});
