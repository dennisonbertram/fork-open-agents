/**
 * Tests for SignedOutHero's post-redirect "sign-in didn't complete" state
 * (#786).
 *
 * Behavior contract: when the Vercel OAuth flow errors or is cancelled and
 * the user is redirected back to `/` with an `error=<code>` query param
 * (emitted via better-auth's `errorCallbackURL`), the landing page must
 * render a designed banner instead of silence, with a retry CTA — no false
 * positives on the happy path (no `error` param).
 *
 * BT-786-050: No `error` param — no error banner renders.
 * BT-786-051: `error` param present — a "didn't complete" banner renders
 *             with a retry control.
 * BT-786-052: The banner is rendered regardless of which better-auth error
 *             code is present (state_mismatch, please_restart_the_process,
 *             internal_server_error, invalid_callback_request) — copy is
 *             generic, not provider-internal jargon.
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let searchParamValue: string | null = null;

mock.module("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "error" ? searchParamValue : null),
  }),
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
