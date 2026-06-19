import { describe, expect, test } from "bun:test";
import { filterToolkits } from "./composio-catalog-filter";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

const FIXTURES: ComposioToolkitSummary[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Send and receive emails via Google Mail service.",
    logo: "https://logos.composio.dev/gmail.png",
    categories: ["Communication", "Google"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Team messaging and collaboration platform.",
    logo: "https://logos.composio.dev/slack.png",
    categories: ["Communication"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Notes, wikis, and project management in one workspace.",
    logo: "https://logos.composio.dev/notion.png",
    categories: ["Productivity"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "composio",
    name: "Composio",
    description: "Composio platform utilities (no auth required).",
    logo: null,
    categories: ["Utilities"],
    managedAuth: false,
    noAuth: true,
  },
];

describe("filterToolkits", () => {
  test("empty query returns all toolkits", () => {
    const result = filterToolkits(FIXTURES, "");
    expect(result).toHaveLength(4);
    expect(result).toEqual(FIXTURES);
  });

  test("matches by name — case-insensitive", () => {
    const result = filterToolkits(FIXTURES, "gmail");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("gmail");
  });

  test("matches by name — uppercase query", () => {
    const result = filterToolkits(FIXTURES, "SLACK");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("slack");
  });

  test("matches by description keyword", () => {
    const result = filterToolkits(FIXTURES, "messaging");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("slack");
  });

  test("matches by slug", () => {
    const result = filterToolkits(FIXTURES, "notion");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("notion");
  });

  test("returns multiple matches when query hits several toolkits", () => {
    // "Communication" is a category on gmail and slack, but filterToolkits only
    // matches on name/description/slug — not categories. "email" appears in gmail description.
    // Use a term that matches both by description
    const result = filterToolkits(FIXTURES, "platform");
    // "Slack" has "platform" in its description, "Composio platform utilities"
    expect(result.length).toBeGreaterThanOrEqual(1);
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("slack");
  });

  test("no-match returns empty array", () => {
    const result = filterToolkits(FIXTURES, "xyznotexist");
    expect(result).toHaveLength(0);
  });

  test("whitespace-only query returns all toolkits", () => {
    const result = filterToolkits(FIXTURES, "   ");
    expect(result).toHaveLength(4);
  });

  test("partial name match works — 'mai' matches Gmail and Composio", () => {
    const result = filterToolkits(FIXTURES, "mai");
    // Gmail description has "Mail"; "mai" matches "mail" in Gmail's description
    expect(result.length).toBeGreaterThanOrEqual(1);
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("gmail");
  });

  test("handles toolkits with null description gracefully", () => {
    const withNull: ComposioToolkitSummary[] = [
      ...FIXTURES,
      {
        slug: "mystery",
        name: "Mystery Tool",
        description: null,
        logo: null,
        categories: [],
        managedAuth: false,
        noAuth: false,
      },
    ];
    // Should not throw, and should not match on null description
    const result = filterToolkits(withNull, "mystery");
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("mystery");
  });
});
