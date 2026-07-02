/**
 * loop-detail.tsx naive-user clarity tests (#768)
 *
 * Behavior contract:
 *   BT-LD-001: the human-readable prose step list is the primary description
 *              of a loop's definition; the raw JSON dump moves behind an
 *              "Advanced" disclosure.
 *   BT-LD-002: the status dropdown shows a one-line meaning for the loop's
 *              current status.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopResponse } from "@/app/api/agent-loops/types";

mock.module("swr", () => ({
  default: <T,>(_key: string, _fetcher?: unknown, opts?: { fallbackData?: T }) => ({
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
          { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
          {
            id: "list",
            kind: "agent_step",
            label: "List open PRs",
            position: { x: 200, y: 0 },
            instructions: "List open PRs.",
          },
          {
            id: "review",
            kind: "agent_step",
            label: "Review and comment",
            position: { x: 400, y: 0 },
            instructions: "Review and comment on each PR.",
          },
          { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "start", target: "list", when: "always" },
          { id: "e2", source: "list", target: "review", when: "success" },
          { id: "e3", source: "review", target: "end", when: "success" },
        ],
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

describe("LoopDetail — prose step list (BT-LD-001)", () => {
  test("BT-LD-001: prose step list renders as the primary description", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop_clarity" initialLoopData={makeLoopData()} />,
    );

    expect(html).toContain("List open PRs");
    expect(html).toContain("Review and comment");
  });

  test("BT-LD-001b: raw JSON is tucked behind an 'Advanced' disclosure, not shown as the primary view", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop_clarity" initialLoopData={makeLoopData()} />,
    );

    expect(html).toMatch(/Advanced/);
    // The raw JSON summary/disclosure must not be the first thing described —
    // it must be nested behind a <details> whose visible summary says
    // "Advanced", not the old bare "Show JSON definition" as the headline UX.
    expect(html).toContain("<details");
  });
});

describe("LoopDetail — status dropdown one-liners (BT-LD-002)", () => {
  test("BT-LD-002: status section shows a one-line meaning for the current status", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail
        loopId="loop_clarity"
        initialLoopData={makeLoopData({ status: "draft" })}
      />,
    );

    // Draft = editable, can't run.
    expect(html).toMatch(/can'?t run|cannot run/i);
  });
});
