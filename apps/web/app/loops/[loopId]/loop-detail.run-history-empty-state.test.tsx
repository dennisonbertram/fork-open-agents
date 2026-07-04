/**
 * loop-detail.tsx run-history empty-state + section-anchor tests (#867)
 *
 * Behavior contract:
 *   LD-RHE-001: draft loops' run-history empty state does not tell the user
 *               to click a disabled "Run now" button.
 *   LD-RHE-002: active loops keep the existing "Click Run now" instruction.
 *   LD-RHE-003: the loop detail page exposes stable #-fragment anchors for
 *               the builder note's four steps to link to.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopResponse } from "@/app/api/agent-loops/types";

mock.module("swr", () => ({
  default: <T,>(
    _key: string,
    _fetcher?: unknown,
    opts?: { fallbackData?: T },
  ) => ({
    data: opts?.fallbackData,
    mutate: mock(() => Promise.resolve()),
  }),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => undefined) }),
}));

mock.module("sonner", () => ({
  toast: { success: mock(() => undefined), error: mock(() => undefined) },
}));

const loopDetailModulePromise = import("./loop-detail");

function makeLoopData(
  overrides: Partial<GetAgentLoopResponse["loop"]> = {},
): GetAgentLoopResponse {
  return {
    loop: {
      id: "loop_clarity",
      name: "Review PRs and comment",
      repoOwner: "acme",
      repoName: "widgets",
      status: "draft",
      description: null,
      guardrails: null,
      definition: {
        nodes: [
          {
            id: "start",
            kind: "start",
            label: "Start",
            position: { x: 0, y: 0 },
          },
          { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
        ],
        edges: [],
      },
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      userId: "user_1",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      ...overrides,
    },
    triggers: [],
  } as GetAgentLoopResponse;
}

describe("LoopDetail — run-history empty state (#867)", () => {
  test("LD-RHE-001: draft loop empty state does not say Click Run now", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop_clarity"
        initialLoopData={makeLoopData({ status: "draft" })}
      />,
    );

    expect(html).toContain("No runs yet");
    expect(html).not.toContain("Click “Run now”");
  });

  test("LD-RHE-002: active loop empty state keeps Click Run now instruction", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop_clarity"
        initialLoopData={makeLoopData({ status: "active" })}
      />,
    );

    expect(html).toContain("Click “Run now” to start the first run.");
  });

  test("LD-RHE-003: section anchors exist for the builder note's steps", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop_clarity"
        initialLoopData={makeLoopData({ status: "draft" })}
      />,
    );

    expect(html).toContain('id="loop-run-history"');
    expect(html).toContain('id="loop-status-section"');
    expect(html).toContain('id="loop-triggers-section"');
    expect(html).toContain('id="loop-run-now"');
  });
});
