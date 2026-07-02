import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Issue #781: any `github=<status>` param present on load must auto-open
// step 2 ("Connect GitHub") regardless of the `step` param state.

let searchParamValues: Record<string, string | null> = {};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
  useSearchParams: () => ({
    get: (key: string) => searchParamValues[key] ?? null,
  }),
}));

mock.module("next/image", () => ({
  default: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: { user: { id: "user-1", name: "Alice" } },
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    hasGitHub: false,
    hasGitHubAccount: false,
    hasGitHubInstallations: false,
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
    const step2PanelStart = lowerHtml.indexOf(
      '<span class="text-sm font-medium">connect github',
    );
    expect(step2PanelStart).toBeGreaterThan(-1);
    const panelStart = lowerHtml.lastIndexOf(
      '<div class="border-b border-white/10">',
      step2PanelStart,
    );
    const panelSection = html.slice(panelStart);
    const gridDivStart = panelSection.indexOf('<div class="grid transition-all');
    expect(panelSection.slice(gridDivStart, gridDivStart + 200)).toContain(
      "grid-rows-[1fr]",
    );
  });

  test("renders the GitHubStatusNotice inline state for the given status", async () => {
    searchParamValues = { github: "request_sent" };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("approval");
  });
});
