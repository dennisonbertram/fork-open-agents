/**
 * Regression tests for profileRowSummary.
 *
 * These tests catch future breakage if the helper is reverted, renamed,
 * or its overflow / logo-strip semantics are silently changed.
 *
 * Regression commit: linked to green e3e6813d.
 */
import { describe, expect, test } from "bun:test";
import {
  profileRowSummary,
  MAX_VISIBLE_LOGOS,
} from "./composio-section-helpers";

describe("profileRowSummary — regression", () => {
  test("REGRESSION-001 MAX_VISIBLE_LOGOS is exactly 5 (changing it breaks the row cap contract)", () => {
    // If someone changes this constant accidentally, the logo strip either
    // shows too many avatars or truncates too aggressively.
    expect(MAX_VISIBLE_LOGOS).toBe(5);
  });

  test("REGRESSION-002 overflow is never negative — even when slugs < MAX_VISIBLE_LOGOS", () => {
    const result = profileRowSummary(["a", "b"], [
      { slug: "a", name: "A", logo: null },
      { slug: "b", name: "B", logo: null },
    ]);
    expect(result.overflow).toBeGreaterThanOrEqual(0);
  });

  test("REGRESSION-003 total visible + overflow always equals total slugs length", () => {
    const slugs = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const catalog = slugs.map((s) => ({ slug: s, name: s, logo: null }));
    const result = profileRowSummary(slugs, catalog);
    expect(result.logos.length + result.overflow).toBe(slugs.length);
  });

  test("REGRESSION-004 a toolkit with logo URL present in catalog exposes the logo URL in logos", () => {
    // Ensures the logo field is not accidentally dropped or nulled by the helper.
    const logo = "https://cdn.example.com/github.png";
    const result = profileRowSummary(["github"], [
      { slug: "github", name: "GitHub", logo },
    ]);
    expect(result.logos[0]?.logo).toBe(logo);
  });

  test("REGRESSION-005 helper returns a stable shape — logos is an array and overflow is a number", () => {
    const result = profileRowSummary([], []);
    expect(Array.isArray(result.logos)).toBe(true);
    expect(typeof result.overflow).toBe("number");
  });

  test("REGRESSION-006 logos order matches slug order (first slug → first logo)", () => {
    const catalog = [
      { slug: "alpha", name: "Alpha", logo: "https://cdn/alpha.png" },
      { slug: "beta", name: "Beta", logo: "https://cdn/beta.png" },
    ];
    const result = profileRowSummary(["beta", "alpha"], catalog);
    // Slugs are given in beta→alpha order; logos must respect that order.
    expect(result.logos[0]?.slug).toBe("beta");
    expect(result.logos[1]?.slug).toBe("alpha");
  });
});
