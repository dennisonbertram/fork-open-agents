import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGitHubReconnectUrl } from "@/lib/github/urls";

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

describe("GetStartedFlow - regression: buildGitHubReconnectUrl integration (#781)", () => {
  test("a real reconnect surface's generated URL (via buildGitHubReconnectUrl) forces the reconnect flow for a connected user", async () => {
    // Regression guard: if a future change removes `reconnect=1` from
    // buildGitHubReconnectUrl (or reintroduces deriving forceReconnect from
    // `step=github` alone), this test fails because the *actual* reconnect
    // helper's output would stop forcing the reconnect copy.
    const reconnectUrl = buildGitHubReconnectUrl("/sessions");
    const parsed = new URL(reconnectUrl, "http://localhost");
    searchParamValues = Object.fromEntries(parsed.searchParams.entries());
    sessionState = { hasGitHubAccount: true, hasGitHubInstallations: true };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(searchParamValues.step).toBe("github");
    expect(html.toLowerCase()).toContain("reconnect your github account");
    expect(html.toLowerCase()).not.toContain("github connected");
  });
});

describe("GitHubConnectStep — pending/error/retry (#786)", () => {
  // This repo's test setup has no DOM/testing-library (see
  // repo-selector-compact.test.tsx docstring), so the interactive
  // try/catch/finally contract is verified as pure async logic mirroring the
  // component's shape via the shared `runAuthCta` helper, while idle-state
  // markup is verified via renderToStaticMarkup.

  test("BT-786-040: rejection resets isLinking to false and sets a visible error (mirrors runAuthCta contract)", async () => {
    const { runAuthCta } = await import("@/lib/auth/run-auth-cta");
    const state: { isLinking: boolean; error: string | null } = {
      isLinking: false,
      error: null,
    };

    await runAuthCta({
      cta: "github_link_get_started",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => Promise.reject(new Error("network down")),
      setPending: (value) => {
        state.isLinking = value;
      },
      setError: (value) => {
        state.error = value;
      },
    });

    expect(state.isLinking).toBe(false);
    expect(state.error).toBe("Couldn't connect GitHub. Try again.");
  });

  test("BT-786-041: retrying re-invokes the action and clears a prior error on success", async () => {
    const { retryAuthCta } = await import("@/lib/auth/run-auth-cta");
    let calls = 0;
    const state: { isLinking: boolean; error: string | null } = {
      isLinking: false,
      error: "Couldn't connect GitHub. Try again.",
    };

    await retryAuthCta({
      cta: "github_link_get_started",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => {
        calls += 1;
        return Promise.resolve();
      },
      setPending: (value) => {
        state.isLinking = value;
      },
      setError: (value) => {
        state.error = value;
      },
    });

    expect(calls).toBe(1);
    expect(state.error).toBeNull();
  });

  test("BT-786-042: not-linked idle markup renders Connect GitHub with no error text", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html).toContain("Connect GitHub");
    expect(html).not.toContain("Try again");
  });

  test("BT-786-043: the module exports the shared GITHUB_LINK_ERROR_MESSAGE (implementation marker)", async () => {
    const flowModule = await flowModulePromise;
    expect(flowModule.GITHUB_LINK_ERROR_MESSAGE).toBe(
      "Couldn't connect GitHub. Try again.",
    );
  });
});
