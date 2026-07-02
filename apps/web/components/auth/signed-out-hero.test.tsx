import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignedOutHero } from "./signed-out-hero";

// Issue #787: the hero subhead must describe what the product does in plain
// language, without leaning on unexplained proper nouns or an "infinitely"
// uptime claim the product doesn't back.

describe("SignedOutHero - honest first-run copy (#787)", () => {
  test("hero subhead does not claim agents run infinitely", () => {
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html).not.toContain("run infinitely");
  });

  test("hero subhead does not list unexplained platform jargon as one string", () => {
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html).not.toContain(
      "AI SDK, Gateway, Sandbox, and Workflow SDK",
    );
  });

  test("a short 'why Vercel' explainer appears near the Sign in with Vercel CTA", () => {
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html.toLowerCase()).toContain("vercel");
    expect(html).toContain("Why Vercel");
  });
});
