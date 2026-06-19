/**
 * Regression tests for ComposioToolkitPicker helpers.
 * These would fail if the implementation in 94fdfe4a were reverted.
 */
import { describe, expect, test } from "bun:test";
import {
  toggleSlug,
  mergeSelectedWithCatalog,
} from "./composio-toolkit-picker-helpers";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

// Regression: the "webseerch" real-world typo that existed in a saved profile.
// mergeSelectedWithCatalog must surface it so the user can remove it.
describe("regression: legacy typo slug (webseerch) remains removable", () => {
  const catalog: ComposioToolkitSummary[] = [
    {
      slug: "github",
      name: "GitHub",
      description: "GitHub integration.",
      logo: "https://logos.composio.dev/github.png",
      categories: ["Developer Tools"],
      managedAuth: true,
      noAuth: false,
    },
  ];

  test("typo slug appears in result even though it is not in the catalog", () => {
    const result = mergeSelectedWithCatalog(["webseerch", "github"], catalog);
    const typo = result.find((e) => e.slug === "webseerch");
    expect(typo).toBeDefined();
    expect(typo?.selected).toBe(true);
    expect(typo?.unknown).toBe(true);
  });

  test("typo slug entry has null logo — does not throw when rendered", () => {
    const result = mergeSelectedWithCatalog(["webseerch"], catalog);
    const typo = result.find((e) => e.slug === "webseerch");
    expect(typo?.logo).toBeNull();
  });

  test("removing typo slug via toggleSlug produces clean list", () => {
    const after = toggleSlug(["webseerch", "github"], "webseerch");
    expect(after).toEqual(["github"]);
  });
});

// Regression: toggleSlug must not mutate the caller's array (React state immutability).
describe("regression: toggleSlug immutability", () => {
  test("input array is not modified when adding", () => {
    const original = Object.freeze(["gmail", "slack"]) as string[];
    expect(() => toggleSlug(original as string[], "linear")).not.toThrow();
    expect(original).toHaveLength(2);
  });

  test("input array is not modified when removing", () => {
    const original = Object.freeze(["gmail", "slack"]) as string[];
    expect(() => toggleSlug(original as string[], "gmail")).not.toThrow();
    expect(original).toHaveLength(2);
  });
});

// Regression: mergeSelectedWithCatalog must correctly separate unknown slugs
// from catalog entries so the UI can render different styling for each group.
describe("regression: unknown vs catalog entry distinction", () => {
  const catalog: ComposioToolkitSummary[] = [
    {
      slug: "linear",
      name: "Linear",
      description: "Issue tracking.",
      logo: null,
      categories: ["Productivity"],
      managedAuth: true,
      noAuth: false,
    },
  ];

  test("catalog entry has unknown === false", () => {
    const result = mergeSelectedWithCatalog(["linear"], catalog);
    const entry = result.find((e) => e.slug === "linear");
    expect(entry?.unknown).toBe(false);
  });

  test("unknown entries appear before catalog entries in result", () => {
    const result = mergeSelectedWithCatalog(["bad-slug", "linear"], catalog);
    const firstEntry = result[0];
    expect(firstEntry?.slug).toBe("bad-slug");
    expect(firstEntry?.unknown).toBe(true);
  });
});

// Regression: the Add-profile button was previously gated on newToolkits.trim(),
// meaning an empty string would keep it disabled. Now it's gated on
// newToolkitSlugs.length === 0. Verify toggleSlug always produces a non-empty
// result when adding a slug to an empty list.
describe("regression: Add button enable condition via toggleSlug", () => {
  test("toggling a slug into an empty selection produces length > 0", () => {
    const result = toggleSlug([], "gmail");
    expect(result.length).toBeGreaterThan(0);
  });

  test("toggling all slugs out produces length === 0 (disabling Add)", () => {
    const result = toggleSlug(["gmail"], "gmail");
    expect(result.length).toBe(0);
  });
});
