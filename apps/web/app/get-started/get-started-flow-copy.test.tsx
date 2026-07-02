import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Issue #787: the GitHub connect step must present the OAuth-link step and
// the App-install step as two distinct actions/permissions, not one
// conflated action ("clone repos, create PRs, and push code"), and mention
// that repository access can be scoped to selected repositories. The
// left-panel tagline must also be visible on mobile (not `hidden md:block`).

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

describe("GetStartedFlow - honest GitHub connect copy (#787)", () => {
  test("not-linked copy does not conflate OAuth link with repo access ('clone repos, create PRs, and push code')", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html).not.toContain("clone repos, create PRs, and push code");
  });

  test("install-step copy mentions that repository access can be scoped to selected repositories", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: true, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("selected repositories");
  });

  test("the left panel tagline is not hidden on mobile (no hidden ... md:block on the explainer)", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html).not.toContain('class="hidden max-w-sm');
  });
});
