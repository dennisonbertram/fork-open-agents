/**
 * LandingNav hidden-CTA inertness (#779 Phase 4 finding).
 *
 * When `showSignIn` is false the sign-in cluster is visually hidden
 * (opacity-0) but historically stayed in the accessibility tree and tab
 * order — an invisible, keyboard-activatable "Sign in with Vercel" button.
 * Hidden means inert: aria-hidden + visibility hidden.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingNav } from "./nav";

describe("LandingNav hidden sign-in cluster (#779)", () => {
  test("showSignIn=false renders the cluster aria-hidden and invisible", () => {
    const html = renderToStaticMarkup(<LandingNav showSignIn={false} />);
    expect(html).toContain(String.raw`<div aria-hidden="true"`);
    expect(html).toContain("invisible");
  });

  test("showSignIn=true renders the cluster visible and not aria-hidden", () => {
    const html = renderToStaticMarkup(<LandingNav showSignIn={true} />);
    expect(html).not.toContain(String.raw`<div aria-hidden="true"`);
    expect(html).not.toContain("invisible");
  });
});
