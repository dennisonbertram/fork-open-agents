/**
 * BT-224A: Tests for selectSuggestedToolkits helper.
 *
 * Behavioral contract:
 * - Returns at most `max` toolkits from the popular list that are NOT connected.
 * - Preserves the order of POPULAR_TOOLKIT_SLUGS (not catalog order).
 * - If a popular slug is not in the catalog, it is silently skipped.
 * - Slugs that ARE in connectedSlugs are excluded.
 * - Returns empty array if all popular slugs are connected.
 *
 * These tests fail until selectSuggestedToolkits is exported from
 * apps/web/app/settings/composio-catalog-suggested.ts with a real implementation.
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
    description: `${slug} integration`,
    logo: `https://logos.composio.dev/${slug}.png`,
    categories: [],
    managedAuth: true,
    noAuth: false,
  };
}

const CATALOG: ComposioToolkitSummary[] = [
  makeToolkit("github"),
  makeToolkit("gmail"),
  makeToolkit("slack"),
  makeToolkit("linear"),
  makeToolkit("notion"),
  makeToolkit("jira"),
  makeToolkit("salesforce"),
];

describe("BT-224A: selectSuggestedToolkits", () => {
  test("BT-224A-001: returns popular toolkits when none are connected (non-empty result)", () => {
    // No connected slugs — the function must return at least 1 and at most max results
    const result = selectSuggestedToolkits(CATALOG, new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  test("BT-224A-002: github appears in suggestions when not connected", () => {
    const result = selectSuggestedToolkits(CATALOG, new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("github");
  });

  test("BT-224A-003: github is excluded when it IS connected", () => {
    const connected = new Set(["github"]);
    const result = selectSuggestedToolkits(CATALOG, connected, POPULAR_TOOLKIT_SLUGS, 4);
    const slugs = result.map((t) => t.slug);
    expect(slugs).not.toContain("github");
    // Other popular slugs should still appear
    expect(slugs.length).toBeGreaterThan(0);
  });

  test("BT-224A-004: max=2 limits to exactly 2 results when catalog has more available", () => {
    const result = selectSuggestedToolkits(CATALOG, new Set(), POPULAR_TOOLKIT_SLUGS, 2);
    expect(result.length).toBe(2);
  });

  test("BT-224A-005: respects POPULAR_TOOLKIT_SLUGS order — github comes before gmail", () => {
    // POPULAR_TOOLKIT_SLUGS has github first, then gmail
    const result = selectSuggestedToolkits(CATALOG, new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    const slugs = result.map((t) => t.slug);
    const githubIdx = slugs.indexOf("github");
    const gmailIdx = slugs.indexOf("gmail");
    // Both must be present
    expect(githubIdx).toBeGreaterThanOrEqual(0);
    expect(gmailIdx).toBeGreaterThanOrEqual(0);
    // github comes before gmail in POPULAR_TOOLKIT_SLUGS, so it must come before gmail in result
    expect(githubIdx).toBeLessThan(gmailIdx);
  });

  test("BT-224A-006: skips popular slugs not in catalog — only returns catalog items", () => {
    // Catalog only has github and gmail; popular list includes slack/linear/notion which are absent
    const smallCatalog = [makeToolkit("github"), makeToolkit("gmail")];
    const result = selectSuggestedToolkits(smallCatalog, new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    // Must not return more than what's available
    expect(result.length).toBeLessThanOrEqual(2);
    // Items must come from the catalog
    for (const item of result) {
      expect(smallCatalog.some((t) => t.slug === item.slug)).toBe(true);
    }
  });

  test("BT-224A-007: returns empty array when all popular slugs are connected", () => {
    const connected = new Set(POPULAR_TOOLKIT_SLUGS);
    const result = selectSuggestedToolkits(CATALOG, connected, POPULAR_TOOLKIT_SLUGS, 4);
    expect(result).toHaveLength(0);
  });

  test("BT-224A-008: returns empty array when catalog is empty", () => {
    const result = selectSuggestedToolkits([], new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    expect(result).toHaveLength(0);
  });

  test("BT-224A-009: POPULAR_TOOLKIT_SLUGS contains expected default slugs", () => {
    expect(POPULAR_TOOLKIT_SLUGS).toContain("github");
    expect(POPULAR_TOOLKIT_SLUGS).toContain("gmail");
    expect(POPULAR_TOOLKIT_SLUGS).toContain("slack");
    expect(POPULAR_TOOLKIT_SLUGS).toContain("linear");
    expect(POPULAR_TOOLKIT_SLUGS).toContain("notion");
  });

  test("BT-224A-010: result items carry catalog name and logo (not stub values)", () => {
    const result = selectSuggestedToolkits(CATALOG, new Set(), POPULAR_TOOLKIT_SLUGS, 4);
    expect(result.length).toBeGreaterThan(0);
    for (const item of result) {
      const catalogEntry = CATALOG.find((t) => t.slug === item.slug);
      expect(catalogEntry).toBeDefined();
      expect(item.name).toBe(catalogEntry?.name);
      expect(item.logo).toBe(catalogEntry?.logo);
    }
  });
});
