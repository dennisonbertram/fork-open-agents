/**
 * Unit tests for profileRowSummary — the pure helper that derives the
 * compact logo-strip + overflow count for a collapsed profile list row.
 *
 * RED commit: these tests fail because profileRowSummary doesn't exist yet.
 */
import { describe, expect, test } from "bun:test";
import {
  profileRowSummary,
  MAX_VISIBLE_LOGOS,
} from "./composio-section-helpers";

// Minimal toolkit stub matching the fields used by the helper
interface StubToolkit {
  slug: string;
  name: string;
  logo: string | null;
}

function toolkit(slug: string, logo: string | null = null): StubToolkit {
  return { slug, name: slug.charAt(0).toUpperCase() + slug.slice(1), logo };
}

describe("profileRowSummary", () => {
  test("BT-001 returns empty logos and zero overflow when profile has no toolkits", () => {
    const result = profileRowSummary([], []);
    expect(result.logos).toHaveLength(0);
    expect(result.overflow).toBe(0);
  });

  test("BT-002 returns matched logo entries for toolkits present in catalog", () => {
    const catalog = [toolkit("github", "https://cdn/github.png"), toolkit("slack", "https://cdn/slack.png")];
    const result = profileRowSummary(["github", "slack"], catalog);
    expect(result.logos).toHaveLength(2);
    expect(result.logos[0]).toMatchObject({ slug: "github", logo: "https://cdn/github.png" });
    expect(result.logos[1]).toMatchObject({ slug: "slack", logo: "https://cdn/slack.png" });
    expect(result.overflow).toBe(0);
  });

  test("BT-003 caps visible logos at MAX_VISIBLE_LOGOS (5) and sets overflow to remainder", () => {
    const catalog = ["a", "b", "c", "d", "e", "f", "g"].map((s) => toolkit(s, `https://cdn/${s}.png`));
    const slugs = ["a", "b", "c", "d", "e", "f", "g"];
    const result = profileRowSummary(slugs, catalog);
    expect(result.logos).toHaveLength(MAX_VISIBLE_LOGOS);
    expect(result.overflow).toBe(slugs.length - MAX_VISIBLE_LOGOS);
  });

  test("BT-004 handles a toolkit slug absent from the catalog (logo is null, name is slug)", () => {
    const catalog = [toolkit("github", "https://cdn/github.png")];
    // "legacy-tool" not in catalog — still appears in logos up to the cap
    const result = profileRowSummary(["github", "legacy-tool"], catalog);
    expect(result.logos).toHaveLength(2);
    const legacy = result.logos.find((l) => l.slug === "legacy-tool");
    expect(legacy).toBeDefined();
    expect(legacy?.logo).toBeNull();
  });

  test("BT-005 exactly MAX_VISIBLE_LOGOS toolkits → overflow is zero", () => {
    const catalog = ["a", "b", "c", "d", "e"].map((s) => toolkit(s, `https://cdn/${s}.png`));
    const result = profileRowSummary(["a", "b", "c", "d", "e"], catalog);
    expect(result.logos).toHaveLength(MAX_VISIBLE_LOGOS);
    expect(result.overflow).toBe(0);
  });

  test("BT-006 single toolkit with null logo still appears in logos list", () => {
    const catalog = [toolkit("mytool", null)];
    const result = profileRowSummary(["mytool"], catalog);
    expect(result.logos).toHaveLength(1);
    expect(result.logos[0].logo).toBeNull();
    expect(result.logos[0].slug).toBe("mytool");
  });
});
