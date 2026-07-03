/**
 * Tests for SignedOutHero's post-redirect "sign-in didn't complete" state
 * (#786) and its honest first-run copy (#787).
 *
 * Behavior contract (#786): when the Vercel OAuth flow errors or is cancelled
 * and the user is redirected back to `/` with an `error=<code>` query param
 * (emitted via better-auth's `errorCallbackURL`), the landing page must
 * render a designed banner instead of silence, with a retry CTA — no false
 * positives on the happy path (no `error` param).
 *
 * BT-786-050: No `error` param — no error banner renders.
 * BT-786-051: `error` param present — a "didn't complete" banner renders
 *             with a retry control.
 * BT-786-052: The banner is rendered regardless of which better-auth error
 *             code is present — copy is generic, not provider-internal jargon.
 *
 * Copy contract (#787): the hero subhead must describe what the product does
 * in plain language, without unexplained proper nouns or an "infinitely"
 * uptime claim the product doesn't back, and a short "why Vercel" explainer
 * must appear near the sign-in CTA.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let searchParamValue: string | null = null;
let nextParamValue: string | null = null;

mock.module("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "error") {
        return searchParamValue;
      }
      if (key === "next") {
        return nextParamValue;
      }
      return null;
    },
  }),
}));

function makeCapture() {
  return { callbackUrl: "" as string | undefined };
}

const heroSignInButtonCapture = makeCapture();

// Resetting via a function call (rather than a direct property assignment)
// keeps TS's control-flow narrowing from collapsing `callbackUrl`'s type to
// literal `undefined` at each call site below.
function resetHeroSignInButtonCapture(): void {
  heroSignInButtonCapture.callbackUrl = undefined;
}

// SignedOutHero renders SignInButton in multiple places (nav, hero, footer);
// only the hero CTA (size="lg") is expected to carry the resolved `next`
// destination, so key on that to avoid a later render overwriting it.
mock.module("@/components/auth/sign-in-button", () => ({
  SignInButton: (props: { size?: string; callbackUrl?: string }) => {
    if (props.size === "lg") {
      heroSignInButtonCapture.callbackUrl = props.callbackUrl;
    }
    return <div data-testid="sign-in-button-stub" />;
  },
}));

const signedOutHeroModulePromise = import("./signed-out-hero");

describe("SignedOutHero — sign-in didn't complete state (#786)", () => {
  test("BT-786-050: no error param renders no error banner", async () => {
    searchParamValue = null;
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(html).not.toContain("didn&#x27;t complete");
  });

  test("BT-786-051: error param present renders a didn't-complete banner with a retry control", async () => {
    searchParamValue = "state_mismatch";
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(html).toContain("didn&#x27;t complete");
    expect(html.toLowerCase()).toContain("try again");
  });

  test("BT-786-052: copy stays generic (no provider-internal error codes leaked) for any error code", async () => {
    searchParamValue = "please_restart_the_process";
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(html).not.toContain("please_restart_the_process");
    expect(html).toContain("didn&#x27;t complete");
  });
});

describe("SignedOutHero - honest first-run copy (#787)", () => {
  test("hero subhead does not claim agents run infinitely", async () => {
    searchParamValue = null;
    const { SignedOutHero } = await signedOutHeroModulePromise;
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html).not.toContain("run infinitely");
  });

  test("hero subhead does not list unexplained platform jargon as one string", async () => {
    searchParamValue = null;
    const { SignedOutHero } = await signedOutHeroModulePromise;
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html).not.toContain("AI SDK, Gateway, Sandbox, and Workflow SDK");
  });

  test("a short 'why Vercel' explainer appears near the Sign in with Vercel CTA", async () => {
    searchParamValue = null;
    const { SignedOutHero } = await signedOutHeroModulePromise;
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html.toLowerCase()).toContain("vercel");
    expect(html).toContain("Why Vercel");
  });
});

describe("SignedOutHero — preserves mobile deep-link destination through sign-in (#793)", () => {
  test("forwards a valid path-only next param into SignInButton's callbackUrl", async () => {
    searchParamValue = null;
    nextParamValue = "/m/chat/some-id";
    resetHeroSignInButtonCapture();
    const { SignedOutHero } = await signedOutHeroModulePromise;

    renderToStaticMarkup(<SignedOutHero />);

    expect(heroSignInButtonCapture.callbackUrl).toBe("/m/chat/some-id");
  });

  test("falls back to the default /get-started next when no next param is present", async () => {
    searchParamValue = null;
    nextParamValue = null;
    resetHeroSignInButtonCapture();
    const { SignedOutHero } = await signedOutHeroModulePromise;

    renderToStaticMarkup(<SignedOutHero />);

    expect(heroSignInButtonCapture.callbackUrl).toBe("/get-started?next=/sessions");
  });

  test("rejects an absolute-URL next param and falls back to the default", async () => {
    searchParamValue = null;
    nextParamValue = "https://evil.example.com/phish";
    resetHeroSignInButtonCapture();
    const { SignedOutHero } = await signedOutHeroModulePromise;

    renderToStaticMarkup(<SignedOutHero />);

    expect(heroSignInButtonCapture.callbackUrl).toBe("/get-started?next=/sessions");
  });

  test("rejects a protocol-relative next param and falls back to the default", async () => {
    searchParamValue = null;
    nextParamValue = "//evil.example.com/phish";
    resetHeroSignInButtonCapture();
    const { SignedOutHero } = await signedOutHeroModulePromise;

    renderToStaticMarkup(<SignedOutHero />);

    expect(heroSignInButtonCapture.callbackUrl).toBe("/get-started?next=/sessions");
  });
});
