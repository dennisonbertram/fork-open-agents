/**
 * Tests for the ComposioToolkitPicker helper utilities.
 * These pure functions are extracted so they can be unit-tested
 * without any DOM / React rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  toggleSlug,
  mergeSelectedWithCatalog,
} from "./composio-toolkit-picker-helpers";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

const FIXTURE_CATALOG: ComposioToolkitSummary[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Send and receive emails.",
    logo: "https://logos.composio.dev/gmail.png",
    categories: ["Communication"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Team messaging platform.",
    logo: "https://logos.composio.dev/slack.png",
    categories: ["Communication"],
    managedAuth: true,
    noAuth: false,
  },
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

// --- toggleSlug ---

describe("toggleSlug", () => {
  test("adds a slug that is not already selected", () => {
    const result = toggleSlug([], "gmail");
    expect(result).toEqual(["gmail"]);
  });

  test("removes a slug that is already selected", () => {
    const result = toggleSlug(["gmail", "slack"], "gmail");
    expect(result).toEqual(["slack"]);
  });

  test("adds to an existing non-empty selection", () => {
    const result = toggleSlug(["gmail"], "linear");
    expect(result).toEqual(["gmail", "linear"]);
  });

  test("preserves order when removing from middle", () => {
    const result = toggleSlug(["gmail", "slack", "linear"], "slack");
    expect(result).toEqual(["gmail", "linear"]);
  });

  test("returns empty array after removing last slug", () => {
    const result = toggleSlug(["gmail"], "gmail");
    expect(result).toEqual([]);
  });

  test("does not mutate the original array", () => {
    const original = ["gmail", "slack"];
    const frozenCopy = [...original];
    toggleSlug(original, "gmail");
    expect(original).toEqual(frozenCopy);
  });
});

// --- mergeSelectedWithCatalog ---

describe("mergeSelectedWithCatalog", () => {
  test("returns an entry for every catalog toolkit", () => {
    const result = mergeSelectedWithCatalog(["gmail"], FIXTURE_CATALOG);
    expect(result).toHaveLength(3);
  });

  test("marks catalog toolkits that are selected", () => {
    const result = mergeSelectedWithCatalog(
      ["gmail", "linear"],
      FIXTURE_CATALOG,
    );
    const gmail = result.find((r) => r.slug === "gmail");
    const slack = result.find((r) => r.slug === "slack");
    const linear = result.find((r) => r.slug === "linear");
    expect(gmail?.selected).toBe(true);
    expect(slack?.selected).toBe(false);
    expect(linear?.selected).toBe(true);
  });

  test("unknown slugs (not in catalog) appear as extra entries at the start", () => {
    const result = mergeSelectedWithCatalog(
      ["webseerch", "gmail"],
      FIXTURE_CATALOG,
    );
    // 'webseerch' is not in catalog — must still appear as an entry
    const unknown = result.find((r) => r.slug === "webseerch");
    expect(unknown).toBeDefined();
    expect(unknown?.selected).toBe(true);
    expect(unknown?.unknown).toBe(true);
  });

  test("unknown slug entry has no logo", () => {
    const result = mergeSelectedWithCatalog(
      ["not-a-real-tool"],
      FIXTURE_CATALOG,
    );
    const entry = result.find((r) => r.slug === "not-a-real-tool");
    expect(entry?.logo).toBeNull();
  });

  test("catalog toolkit entry carries the catalog name and logo", () => {
    const result = mergeSelectedWithCatalog([], FIXTURE_CATALOG);
    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.name).toBe("Gmail");
    expect(gmail?.logo).toBe("https://logos.composio.dev/gmail.png");
  });

  test("empty selectedSlugs returns all catalog entries as not-selected", () => {
    const result = mergeSelectedWithCatalog([], FIXTURE_CATALOG);
    expect(result.every((r) => !r.selected)).toBe(true);
  });

  test("empty catalog with selected slugs returns only the unknown entries", () => {
    const result = mergeSelectedWithCatalog(["github"], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("github");
    expect(result[0]?.unknown).toBe(true);
  });
});
