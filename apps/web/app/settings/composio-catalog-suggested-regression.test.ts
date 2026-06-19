/**
 * Regression tests for composio-catalog-suggested.ts.
 * Would fail if the implementation in 9bdfd467 were reverted to the stub.
 *
 * Scenarios covered:
 * 1. Reverting to stub (returns []) would break all positivity assertions
 * 2. Removing connected-slug filter would break exclusion test
 * 3. Ignoring `max` param would break the limit test
 * 4. Ignoring popular order would break the ordering test
 */
import { describe, expect, test } from "bun:test";
import {
  selectSuggestedToolkits,
  POPULAR_TOOLKIT_SLUGS,
} from "./composio-catalog-suggested";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

function makeToolkit(slug: string): ComposioToolkitSummary {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    description: `${slug} description`,
    logo: `https://logos.composio.dev/${slug}.png`,
    categories: [],
    managedAuth: true,
    noAuth: false,
  };
}

const FULL_CATALOG: ComposioToolkitSummary[] = POPULAR_TOOLKIT_SLUGS.map((s) =>
  makeToolkit(s),
);

describe("regression: selectSuggestedToolkits correctly filters connected + respects max", () => {
  test("connected slugs are never returned, even if they are popular", () => {
    // If the filter were removed, github would appear in results
    const connected = new Set(["github", "gmail", "slack"]);
    const result = selectSuggestedToolkits(
      FULL_CATALOG,
      connected,
      POPULAR_TOOLKIT_SLUGS,
      4,
    );
    const slugs = result.map((t) => t.slug);
    expect(slugs).not.toContain("github");
    expect(slugs).not.toContain("gmail");
    expect(slugs).not.toContain("slack");
  });

  test("result length never exceeds max even when more are available", () => {
    // If the max param were ignored, result.length would be 5 (all popular)
    const result = selectSuggestedToolkits(
      FULL_CATALOG,
      new Set(),
      POPULAR_TOOLKIT_SLUGS,
      2,
    );
    expect(result.length).toBe(2);
  });

  test("result follows POPULAR_TOOLKIT_SLUGS order, not catalog insertion order", () => {
    // Catalog in reverse popular order — if we sort by catalog order, result is reversed
    const reversedCatalog = [...FULL_CATALOG].toReversed();
    const result = selectSuggestedToolkits(
      reversedCatalog,
      new Set(),
      POPULAR_TOOLKIT_SLUGS,
      5,
    );
    const slugs = result.map((t) => t.slug);
    // First popular slug must be first in result
    expect(slugs[0]).toBe(POPULAR_TOOLKIT_SLUGS[0]);
    expect(slugs[1]).toBe(POPULAR_TOOLKIT_SLUGS[1]);
  });

  test("POPULAR_TOOLKIT_SLUGS has exactly the 5 expected default entries", () => {
    // If the constant were accidentally changed or truncated, this catches it
    expect(POPULAR_TOOLKIT_SLUGS).toHaveLength(5);
    expect([...POPULAR_TOOLKIT_SLUGS]).toEqual([
      "github",
      "gmail",
      "slack",
      "linear",
      "notion",
    ]);
  });

  test("when catalog is missing some popular slugs, only catalog entries are returned", () => {
    // Only github + linear are in catalog; slack/gmail/notion are missing
    const partialCatalog = [makeToolkit("github"), makeToolkit("linear")];
    const result = selectSuggestedToolkits(
      partialCatalog,
      new Set(),
      POPULAR_TOOLKIT_SLUGS,
      4,
    );
    // Must not return slugs absent from catalog
    const slugs = result.map((t) => t.slug);
    expect(slugs).not.toContain("gmail");
    expect(slugs).not.toContain("slack");
    expect(slugs).not.toContain("notion");
    // But catalog entries that ARE popular should appear
    expect(slugs).toContain("github");
    expect(slugs).toContain("linear");
  });
});
