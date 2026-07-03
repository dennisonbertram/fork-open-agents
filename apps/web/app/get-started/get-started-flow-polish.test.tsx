import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Issue #842: Phase 4 re-walk polish for the guided get-started flow.
//
// Findings covered here:
// 1. Step numbering contradiction — the card numbered "2. Connect GitHub"
//    must not carry sub-step copy that reads like a bare "step 1 of 2"
//    ordinal collision.
// 2. Accordion progress must not depend solely on client click-state — step 1
//    (Vercel account) is derived-complete whenever a session exists, so
//    remounting after navigating away does not re-lock/re-collapse it.
// 4. Arrival context — landing on /get-started via the onboarding gate
//    redirect (which always sets an explicit `next` param) must show a
//    one-line reason banner.
// 5. Duplicate "Connect GitHub" labels — step title, description, and button
//    must not all repeat the exact same phrase in close proximity.

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

describe("GetStartedFlow polish (#842) — finding 1: step numbering", () => {
  test("not-linked GitHub copy does not use a bare 'step 1 of 2' ordinal under a card numbered 2", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).not.toContain("step 1 of 2");
  });
});

describe("GetStartedFlow polish (#842) — finding 2: step 1 completion is derived from session", () => {
  test("step 1 (Vercel Account) shows as completed on initial render when a session exists, without clicking Continue", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);
    const lowerHtml = html.toLowerCase();

    // The step-1 row must render its "completed" check affordance even
    // though no click has happened yet in this render.
    const step1RowStart = lowerHtml.indexOf(">vercel account<");
    expect(step1RowStart).toBeGreaterThan(-1);
    const rowSectionEnd = lowerHtml.indexOf("</button>", step1RowStart);
    const rowSection = html.slice(0, rowSectionEnd);
    const rowStart = rowSection.lastIndexOf('<div class="border-b');
    expect(rowSection.slice(rowStart)).toContain("lucide-check");
  });

  test("step 2 remains reachable (not locked) on a fresh remount for a signed-in user", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);
    const lowerHtml = html.toLowerCase();
    const step2Start = lowerHtml.indexOf(">connect github<");
    expect(step2Start).toBeGreaterThan(-1);
    const rowStart = lowerHtml.lastIndexOf("<button", step2Start);
    const rowEnd = lowerHtml.indexOf("</button>", step2Start);
    expect(lowerHtml.slice(rowStart, rowEnd)).not.toContain('disabled=""');
  });
});

describe("GetStartedFlow polish (#842) — finding 3: step-1 Continue semantics", () => {
  test("step 1's Continue button clarifies what continuing does (does not read as a bare 'Continue')", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html).not.toContain(">Continue<");
  });
});

describe("GetStartedFlow polish (#842) — finding 4: gate arrival context", () => {
  test("shows a one-line reason banner when arriving with an explicit next param (gate redirect)", async () => {
    searchParamValues = { next: "/sessions" };
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).toContain("finish setup to continue");
  });

  test("does not show the arrival banner when there is no next param (direct visit)", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);

    expect(html.toLowerCase()).not.toContain("finish setup to continue");
  });
});

describe("GetStartedFlow polish (#842) — finding 5: no duplicate 'Connect GitHub' labels", () => {
  test("the not-linked GitHub step does not repeat the exact phrase 'Connect GitHub' in the title, description, and button", async () => {
    searchParamValues = {};
    sessionState = { hasGitHubAccount: false, hasGitHubInstallations: false };
    const { GetStartedFlow } = await flowModulePromise;

    const html = renderToStaticMarkup(<GetStartedFlow />);
    const occurrences = html.split("Connect GitHub").length - 1;

    expect(occurrences).toBeLessThan(2);
  });
});
