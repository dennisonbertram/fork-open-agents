/**
 * LoopRunPreview regression tests (TASK-LRP / #361 row-level disclosure)
 *
 * These tests catch future breakage of the key behaviors introduced for the
 * loop-run-preview row disclosure feature. Each test would FAIL if the change
 * in the green commit were reverted.
 *
 * Regression scenarios:
 *   REG-LRP-001: buildSwrKey returns null when not expanded (no pre-expand fetch)
 *   REG-LRP-002: buildSwrKey includes loopId and limit=3 in the URL
 *   REG-LRP-003: LoopRunPreviewBody renders /loops/[loopId]/runs/[runId] deep links
 *   REG-LRP-004: LoopRunPreviewBody shows "No runs yet" for empty array (not blank)
 *   REG-LRP-005: LoopRunPreviewBody shows "could not load" on error (not blank)
 *   REG-LRP-006: Skeleton renders exactly 3 animate-pulse rows while loading
 *   REG-LRP-007: Duration formatting — 120s renders as "2m 0s"
 *   REG-LRP-008: LoopRunPreviewCollapsed renders aria-expanded=false
 *   REG-LRP-009: LoopRunPreviewExpanded renders aria-expanded=true
 *
 * Note: REG-LRP-010 (WorkflowsWindowView wires LoopRunPreview) is covered
 * by workflows-window.regression.test.tsx REG-WF-003 + the smoke evidence.
 * It is not duplicated here to avoid cross-file mock contamination in
 * combined bun test runs (pre-existing Bun mock isolation limitation).
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Stub SWR — regression tests exercise buildSwrKey and sub-components directly
mock.module("swr", () => ({
  default: (_key: unknown) => ({
    data: undefined,
    error: undefined,
    isLoading: false,
  }),
}));

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
  fetcher: async () => ({}),
}));

// Lazy-import after mocks are wired (avoids importing workflows-window which
// transitively loads @/lib/agent-loops/store — subject to pre-existing
// cross-file mock contamination in the Bun test runner).
const modulePromise = import("./loop-run-preview");

type RunRow = {
  id: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "stalled";
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

describe("LoopRunPreview regressions", () => {
  // REG-LRP-001: No fetch before expand — null key is the guard
  test("REG-LRP-001: buildSwrKey returns null when expanded=false", async () => {
    const { buildSwrKey } = await modulePromise;
    expect(buildSwrKey("loop-x", false)).toBeNull();
  });

  // REG-LRP-002: SWR key includes loopId and limit=3
  test("REG-LRP-002: buildSwrKey includes loopId and limit=3 when expanded=true", async () => {
    const { buildSwrKey } = await modulePromise;
    const key = buildSwrKey("loop-abc", true);
    expect(key).not.toBeNull();
    expect(key).toContain("loop-abc");
    expect(key).toContain("limit=3");
  });

  // REG-LRP-003: deep links to /loops/[loopId]/runs/[runId]
  test("REG-LRP-003: run rows contain deep links to /loops/[loopId]/runs/[runId]", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const runs: RunRow[] = [
      {
        id: "run-deeplink",
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-target"
        isLoading={false}
        runs={runs}
        error={undefined}
      />,
    );

    expect(html).toContain("/loops/loop-target/runs/run-deeplink");
  });

  // REG-LRP-004: Empty state must show "No runs yet", not blank
  test("REG-LRP-004: empty runs shows 'No runs yet', not a blank element", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={false}
        runs={[]}
        error={undefined}
      />,
    );

    expect(html).not.toBe("");
    expect(html).toMatch(/no runs yet/i);
  });

  // REG-LRP-005: Error state must show "could not load", not blank
  test("REG-LRP-005: error state shows error message, not a blank element", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={false}
        runs={undefined}
        error={new Error("timeout")}
      />,
    );

    expect(html).not.toBe("");
    expect(html).toMatch(/could not load/i);
  });

  // REG-LRP-006: Skeleton renders exactly 3 animate-pulse rows
  test("REG-LRP-006: loading state renders exactly 3 animate-pulse skeleton rows", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewBody
        loopId="loop-1"
        isLoading={true}
        runs={undefined}
        error={undefined}
      />,
    );

    const pulseCount = (html.match(/animate-pulse/g) ?? []).length;
    expect(pulseCount).toBe(3);
  });

  // REG-LRP-007: Duration formatting — 120s should be "2m 0s"
  test("REG-LRP-007: 2-minute run duration renders as '2m 0s'", async () => {
    const { LoopRunPreviewBody } = await modulePromise;

    const start = new Date("2026-06-12T10:00:00Z");
    const finish = new Date("2026-06-12T10:02:00Z"); // exactly 2 minutes later
    const runs: RunRow[] = [
      {
        id: "run-dur",
        status: "completed",
        startedAt: start.toISOString(),
        finishedAt: finish.toISOString(),
        createdAt: start.toISOString(),
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

    expect(html).toContain("2m 0s");
  });

  // REG-LRP-008: aria-expanded=false in collapsed state
  test("REG-LRP-008: LoopRunPreviewCollapsed has aria-expanded=false", async () => {
    const { LoopRunPreviewCollapsed } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewCollapsed loopId="loop-1" />,
    );
    expect(html).toContain('aria-expanded="false"');
  });

  // REG-LRP-009: aria-expanded=true in expanded state
  test("REG-LRP-009: LoopRunPreviewExpanded has aria-expanded=true", async () => {
    const { LoopRunPreviewExpanded } = await modulePromise;

    const html = renderToStaticMarkup(
      <LoopRunPreviewExpanded loopId="loop-1" />,
    );
    expect(html).toContain('aria-expanded="true"');
  });
});
