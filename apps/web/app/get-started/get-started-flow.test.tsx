import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Issue #781: any `github=<status>` param present on load must auto-open
// step 2 ("Connect GitHub") regardless of the `step` param state.

let searchParamValues: Record<string, string | null> = {};
let sessionState = {
  hasGitHubAccount: false,
  hasGitHubInstallations: false,
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
  useSearchParams: () => ({
    get: (key: string) => searchParamValues[key] ?? null,
  }),
}));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: { user: { id: "user-1", name: "Alice" } },
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    hasGitHub: false,
    hasGitHubAccount: sessionState.hasGitHubAccount,
    hasGitHubInstallations: sessionState.hasGitHubInstallations,
  }),
}));

mock.module("@/lib/auth/client", () => ({
  authClient: { linkSocial: async () => undefined },
}));

const flowModulePromise = import("./get-started-flow");

describe("GetStartedFlow - github status auto-open", () => {
  test("auto-opens step 2 when github param present and step param absent", async () => {
    searchParamValues = { github: "not_linked" };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    // Step 2's panel must be the one in the expanded (grid-rows-[1fr]) state,
    // not collapsed (grid-rows-[0fr]), even though `step` is absent.
    const lowerHtml = html.toLowerCase();
    const step2PanelStart = lowerHtml.indexOf(">connect github<");
    expect(step2PanelStart).toBeGreaterThan(-1);
    const panelStart = lowerHtml.lastIndexOf(
      '<div class="border-b border-white/10">',
      step2PanelStart,
    );
    const panelSection = html.slice(panelStart);
    const gridDivStart = panelSection.indexOf(
      '<div class="grid transition-all',
    );
    expect(panelSection.slice(gridDivStart, gridDivStart + 200)).toContain(
      "grid-rows-[1fr]",
    );
  });

  test("renders the GitHubStatusNotice inline state for the given status", async () => {
    searchParamValues = { github: "request_sent" };
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("approval");
  });
});

describe("GetStartedFlow - reconnect intent is explicit (#781)", () => {
  test("a) successful install (github=app_installed&step=github) for a connected user renders the connected card, not the reconnect flow", async () => {
    searchParamValues = { github: "app_installed", step: "github" };
    sessionState = { hasGitHubAccount: true, hasGitHubInstallations: true };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("github connected");
    expect(html.toLowerCase()).not.toContain("reconnect your github account");
  });

  test("b) reconnect=1 forces the reconnect flow even for a connected user", async () => {
    searchParamValues = { reconnect: "1", next: "/sessions" };
    sessionState = { hasGitHubAccount: true, hasGitHubInstallations: true };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("reconnect your github account");
    expect(html.toLowerCase()).not.toContain("github connected");
  });

  test("c) step=github without reconnect=1 does not force reconnect copy for a not-yet-linked user", async () => {
    searchParamValues = { step: "github" };
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).not.toContain("reconnect your github account");
    expect(html.toLowerCase()).not.toContain("reconnect github");
    expect(html.toLowerCase()).toContain("connect your github account");
  });
});
