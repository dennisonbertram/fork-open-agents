import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((href: string): never => {
  throw new Error(`redirect:${href}`);
});
let sessionUserId: string | null = "user-1";
let loopsEnabled = true;

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => loopsEnabled,
}));
mock.module("@/app/loops/loop-create-experience", () => ({
  LoopCreateExperience: (props: {
    initialRepoOwner?: string;
    initialRepoName?: string;
    surface?: string;
  }) => (
    <div
      data-testid="loop-create-experience"
      data-repository={`${props.initialRepoOwner}/${props.initialRepoName}`}
      data-surface={props.surface}
    />
  ),
}));

const pageModulePromise = import("./page");

describe("canonical multi-step Automation create page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    loopsEnabled = true;
    redirect.mockClear();
  });

  test("authenticates before rendering repository context", async () => {
    sessionUserId = null;
    const { default: NewLoopAutomationPage } = await pageModulePromise;
    await expect(
      NewLoopAutomationPage({
        searchParams: Promise.resolve({ repoOwner: "acme", repoName: "shop" }),
      }),
    ).rejects.toThrow("redirect:/");
  });

  test("truthfully surfaces a disabled deployment without the creator", async () => {
    loopsEnabled = false;
    const { default: NewLoopAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopAutomationPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Multi-step Automations are disabled");
    expect(html).not.toContain("loop-create-experience");
  });

  test("reuses the mature create experience with canonical presentation and query context", async () => {
    const { default: NewLoopAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewLoopAutomationPage({
        searchParams: Promise.resolve({ repoOwner: "acme", repoName: "shop" }),
      }),
    );
    expect(html).toContain("New multi-step Automation");
    expect(html).toContain('data-repository="acme/shop"');
    expect(html).toContain('data-surface="automation"');
    expect(html).toContain('href="/automations"');
  });
});
