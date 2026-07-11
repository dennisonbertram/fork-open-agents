import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((href: string): never => {
  throw new Error(`redirect:${href}`);
});
const notFound = mock((): never => {
  throw new Error("not-found");
});
let sessionUserId: string | null = "user-1";
let ownedLoop: Record<string, unknown> | null;
const getOwnedAgentLoop = mock(async () => ownedLoop);

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));
mock.module("@/lib/agent-loops/store", () => ({ getOwnedAgentLoop }));
mock.module("@/app/loops/[loopId]/builder/builder-canvas", () => ({
  BuilderCanvas: (props: { loopId: string; surface?: string }) => (
    <div data-loop-id={props.loopId} data-surface={props.surface} />
  ),
}));

const pageModulePromise = import("./page");

describe("canonical multi-step Automation edit page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    ownedLoop = {
      id: "loop-1",
      name: "Release safely",
      description: null,
      status: "draft",
      definition: { nodes: [], edges: [] },
      guardrails: null,
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
    };
    redirect.mockClear();
    notFound.mockClear();
    getOwnedAgentLoop.mockClear();
  });

  test("authenticates before ownership lookup", async () => {
    sessionUserId = null;
    const { default: EditLoopAutomationPage } = await pageModulePromise;
    await expect(
      EditLoopAutomationPage({
        params: Promise.resolve({ loopId: "private" }),
      }),
    ).rejects.toThrow("redirect:/");
    expect(getOwnedAgentLoop).not.toHaveBeenCalled();
  });

  test("fails closed for missing or foreign ids", async () => {
    ownedLoop = null;
    const { default: EditLoopAutomationPage } = await pageModulePromise;
    await expect(
      EditLoopAutomationPage({
        params: Promise.resolve({ loopId: "foreign" }),
      }),
    ).rejects.toThrow("not-found");
  });

  test("reuses BuilderCanvas with canonical presentation", async () => {
    const { default: EditLoopAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await EditLoopAutomationPage({
        params: Promise.resolve({ loopId: "loop-1" }),
      }),
    );
    expect(html).toContain('data-loop-id="loop-1"');
    expect(html).toContain('data-surface="automation"');
  });
});
