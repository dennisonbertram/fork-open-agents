import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});
let sessionUserId: string | null = "user-1";

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId, name: "Ada" } } : null,
}));
mock.module("@/app/repos/[owner]/[repo]/agents/new/new-agent-builder", () => ({
  NewAgentBuilder: (props: {
    owner: string;
    repo: string;
    surface?: string;
  }) => (
    <div
      data-testid="new-agent-builder"
      data-repository={`${props.owner}/${props.repo}`}
      data-surface={props.surface}
    />
  ),
}));
mock.module("./repository-picker", () => ({
  AutomationRepositoryPicker: () => (
    <div data-testid="automation-repository-picker" />
  ),
}));

const pageModulePromise = import("./page");

describe("canonical new single-step Automation page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    redirect.mockClear();
  });

  test("redirects signed-out users before rendering repository context", async () => {
    sessionUserId = null;
    const { default: NewAutomationPage } = await pageModulePromise;

    await expect(
      NewAutomationPage({
        searchParams: Promise.resolve({
          repoOwner: "acme",
          repoName: "widgets",
        }),
      }),
    ).rejects.toThrow("redirect:/");
  });

  test("renders repository selection when canonical create is unscoped", async () => {
    const { default: NewAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewAutomationPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("New single-step Automation");
    expect(html).toContain("automation-repository-picker");
    expect(html).not.toContain("new-agent-builder");
  });

  test("reuses the mature builder with fixed repository and Automation presentation", async () => {
    const { default: NewAutomationPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await NewAutomationPage({
        searchParams: Promise.resolve({
          repoOwner: "Acme Org",
          repoName: "widgets/api",
        }),
      }),
    );

    expect(html).toContain('data-repository="Acme Org/widgets/api"');
    expect(html).toContain('data-surface="automation"');
    expect(html).toContain('href="/automations"');
    expect(html).not.toContain("New agent");
  });
});
