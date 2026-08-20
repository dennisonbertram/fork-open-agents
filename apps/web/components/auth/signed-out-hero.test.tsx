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
import { PRODUCT_JOURNEY } from "@/lib/product-journey";

let searchParamValue: string | null = null;
let nextParamValue: string | null = null;

mock.module("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "error") {
        return searchParamValue;
      }
      return key === "next" ? nextParamValue : null;
    },
  }),
}));
mock.module("@/components/auth/sign-in-button", () => ({
  SignInButton: ({
    callbackUrl,
    size,
  }: {
    callbackUrl?: string;
    size?: string;
  }) => (
    <div data-sign-in-callback-url={callbackUrl} data-sign-in-size={size} />
  ),
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

describe("SignedOutHero - mobile deep-link callback (#793)", () => {
  function callbackUrlFromHero(html: string): string | undefined {
    return /data-sign-in-callback-url="([^"]+)" data-sign-in-size="lg"/
      .exec(html)?.[1]
      ?.replaceAll("&amp;", "&");
  }

  test("uses the product journey default when no next parameter is present", async () => {
    searchParamValue = null;
    nextParamValue = null;
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(callbackUrlFromHero(html)).toBe(PRODUCT_JOURNEY[0].href);
  });

  test("uses a safe mobile deep link as the sign-in callback", async () => {
    searchParamValue = null;
    nextParamValue = "/m/chat/abc";
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(callbackUrlFromHero(html)).toBe("/m/chat/abc");
  });

  test("rejects protocol-relative next parameters", async () => {
    searchParamValue = null;
    nextParamValue = "//evil.com";
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(callbackUrlFromHero(html)).toBe(PRODUCT_JOURNEY[0].href);
  });

  test("rejects absolute next parameters", async () => {
    searchParamValue = null;
    nextParamValue = "https://evil.com";
    const { SignedOutHero } = await signedOutHeroModulePromise;

    const html = renderToStaticMarkup(<SignedOutHero />);

    expect(callbackUrlFromHero(html)).toBe(PRODUCT_JOURNEY[0].href);
  });
});
