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
const listTriggersForLoop = mock(async () => []);

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));
mock.module("@/lib/agent-loops/store", () => ({ getOwnedAgentLoop }));
mock.module("@/lib/background-agents/store", () => ({ listTriggersForLoop }));
mock.module("@/app/loops/[loopId]/loop-detail", () => ({
  LoopDetail: (props: { loopId: string; surface?: string }) => (
    <div data-loop-id={props.loopId} data-surface={props.surface} />
  ),
}));

const pageModulePromise = import("./page");

describe("canonical multi-step Automation detail page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    ownedLoop = { id: "loop-1", name: "Release safely" };
    redirect.mockClear();
    notFound.mockClear();
    getOwnedAgentLoop.mockClear();
    listTriggersForLoop.mockClear();
  });

  test("authenticates before loading source data", async () => {
    sessionUserId = null;
    const { default: LoopAutomationPage } = await pageModulePromise;
    await expect(
      LoopAutomationPage({ params: Promise.resolve({ loopId: "private" }) }),
    ).rejects.toThrow("redirect:/");
    expect(getOwnedAgentLoop).not.toHaveBeenCalled();
  });

  test("uses ownership before child evidence and returns the same 404 for missing or foreign ids", async () => {
    ownedLoop = null;
    const { default: LoopAutomationPage } = await pageModulePromise;
    await expect(
      LoopAutomationPage({ params: Promise.resolve({ loopId: "foreign" }) }),
    ).rejects.toThrow("not-found");
    expect(getOwnedAgentLoop).toHaveBeenCalledWith({
      userId: "user-1",
      loopId: "foreign",
    });
    expect(listTriggersForLoop).not.toHaveBeenCalled();
  });

  test("reuses source detail with canonical Automation presentation", async () => {
    const { default: LoopAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await LoopAutomationPage({
        params: Promise.resolve({ loopId: "loop-1" }),
      }),
    );
    expect(listTriggersForLoop).toHaveBeenCalledWith("loop-1");
    expect(html).toContain('data-loop-id="loop-1"');
    expect(html).toContain('data-surface="automation"');
  });
});
