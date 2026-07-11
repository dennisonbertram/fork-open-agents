import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((href: string): never => {
  throw new Error(`redirect:${href}`);
});
const notFound = mock((): never => {
  throw new Error("not-found");
});
let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

const loadOwnedBackgroundRunDetail = mock(
  async (): Promise<unknown | null> => null,
);
const loadOwnedLoopRunDetail = mock(async (): Promise<unknown | null> => null);

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));
mock.module("@/lib/runs/detail-loaders", () => ({
  loadOwnedBackgroundRunDetail,
  loadOwnedLoopRunDetail,
}));
mock.module("@/app/background-runs/[runId]/background-run-detail", () => ({
  BackgroundRunDetail: ({ variant }: { variant?: string }) => (
    <div>background:{variant ?? "legacy"}</div>
  ),
}));
mock.module("@/app/loops/[loopId]/runs/[runId]/run-detail", () => ({
  RunDetail: ({ variant }: { variant?: string }) => (
    <div>loop:{variant ?? "legacy"}</div>
  ),
}));

const backgroundPageModule = import("./background-agent/[runId]/page");
const loopPageModule = import("./loop/[runId]/page");
const legacyBackgroundPageModule = import("../background-runs/[runId]/page");
const legacyLoopPageModule = import("../loops/[loopId]/runs/[runId]/page");

beforeEach(() => {
  currentSession = { user: { id: "user-1" } };
  redirect.mockClear();
  notFound.mockClear();
  loadOwnedBackgroundRunDetail.mockReset();
  loadOwnedBackgroundRunDetail.mockResolvedValue(null);
  loadOwnedLoopRunDetail.mockReset();
  loadOwnedLoopRunDetail.mockResolvedValue(null);
});

describe("canonical Run detail pages", () => {
  test("both sources redirect signed-out users before probing a run id", async () => {
    currentSession = null;
    const { default: BackgroundPage } = await backgroundPageModule;
    const { default: LoopPage } = await loopPageModule;

    await expect(
      BackgroundPage({ params: Promise.resolve({ runId: "private-bg" }) }),
    ).rejects.toThrow("redirect:/");
    await expect(
      LoopPage({ params: Promise.resolve({ runId: "private-loop" }) }),
    ).rejects.toThrow("redirect:/");
    expect(loadOwnedBackgroundRunDetail).not.toHaveBeenCalled();
    expect(loadOwnedLoopRunDetail).not.toHaveBeenCalled();
  });

  test("missing or wrong-owner ids produce the same non-probing 404 for each source", async () => {
    const { default: BackgroundPage } = await backgroundPageModule;
    const { default: LoopPage } = await loopPageModule;

    await expect(
      BackgroundPage({ params: Promise.resolve({ runId: "private-bg" }) }),
    ).rejects.toThrow("not-found");
    expect(loadOwnedBackgroundRunDetail).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "private-bg",
    });
    expect(loadOwnedLoopRunDetail).not.toHaveBeenCalled();

    await expect(
      LoopPage({ params: Promise.resolve({ runId: "private-loop" }) }),
    ).rejects.toThrow("not-found");
    expect(loadOwnedLoopRunDetail).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "private-loop",
    });
  });

  test("owned source data is composed through the canonical detail variant", async () => {
    loadOwnedBackgroundRunDetail.mockResolvedValue({ marker: "background" });
    loadOwnedLoopRunDetail.mockResolvedValue({ marker: "loop" });
    const { default: BackgroundPage } = await backgroundPageModule;
    const { default: LoopPage } = await loopPageModule;

    const background = await BackgroundPage({
      params: Promise.resolve({ runId: "bg-1" }),
    });
    const loop = await LoopPage({
      params: Promise.resolve({ runId: "loop-1" }),
    });

    expect(renderToStaticMarkup(background)).toContain("background:canonical");
    expect(renderToStaticMarkup(loop)).toContain("loop:canonical");
  });

  test("legacy deep-link pages still render the source-native legacy variant", async () => {
    loadOwnedBackgroundRunDetail.mockResolvedValue({ marker: "background" });
    loadOwnedLoopRunDetail.mockResolvedValue({ marker: "loop" });
    const { default: BackgroundPage } = await legacyBackgroundPageModule;
    const { default: LoopPage } = await legacyLoopPageModule;

    const background = await BackgroundPage({
      params: Promise.resolve({ runId: "bg-1" }),
    });
    const loop = await LoopPage({
      params: Promise.resolve({ loopId: "loop-parent", runId: "loop-run-1" }),
    });

    expect(renderToStaticMarkup(background)).toContain("background:legacy");
    expect(renderToStaticMarkup(loop)).toContain("loop:legacy");
  });
});
