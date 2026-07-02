/**
 * TDD RED regression test for #762 — loop-detail.tsx must no longer render
 * the dead-end "Manage triggers in Background agents settings" copy/link,
 * and must show the "runs manually only" status note when active with zero
 * triggers.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopResponse } from "@/app/api/agent-loops/types";

let _swrMutate = mock(() => Promise.resolve());
let _swrLoopData: GetAgentLoopResponse | undefined;

mock.module("swr", () => ({
  default: <T,>(
    _key: string,
    _fetcher?: unknown,
    opts?: { fallbackData?: T },
  ) => ({
    data: (_swrLoopData as T | undefined) ?? opts?.fallbackData,
    mutate: _swrMutate,
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
  status: string,
  triggers: GetAgentLoopResponse["triggers"] = [],
): GetAgentLoopResponse {
  return {
    loop: {
      id: "loop_abc",
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      status: status as GetAgentLoopResponse["loop"]["status"],
      description: null,
      guardrails: null,
      definition: { nodes: [], edges: [] },
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      userId: "user_1",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    triggers,
  };
}

describe("LoopDetail — dead-end trigger copy removed (#762 regression)", () => {
  beforeEach(() => {
    _swrMutate = mock(() => Promise.resolve());
    _swrLoopData = undefined;
  });

  test("no triggers: does not render 'Manage triggers in Background agents settings'", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop_abc" initialLoopData={makeLoopData("active")} />,
    );
    expect(html).not.toContain("Manage triggers in");
    expect(html).not.toContain("Background agents settings");
    expect(html).not.toContain("/settings/background-agents");
  });

  test("active with zero triggers: shows the runs-manually-only status note", async () => {
    const { LoopDetail } = await loopDetailModulePromise;
    const html = renderToStaticMarkup(
      <LoopDetail loopId="loop_abc" initialLoopData={makeLoopData("active")} />,
    );
    expect(html).toContain(
      "Active — runs manually only. Add a trigger to run automatically.",
    );
  });
});
