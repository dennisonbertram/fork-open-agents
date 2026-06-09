import { describe, expect, test } from "bun:test";
import { prettifyToolkitSlug, summarizeChatTools } from "./chat-tool-summary";

describe("prettifyToolkitSlug", () => {
  test("capitalizes and humanizes slugs", () => {
    expect(prettifyToolkitSlug("github")).toBe("Github");
    expect(prettifyToolkitSlug("web_search")).toBe("Web search");
    expect(prettifyToolkitSlug("hacker-news")).toBe("Hacker news");
  });
});

describe("summarizeChatTools", () => {
  test("says 'No tools' when empty", () => {
    expect(summarizeChatTools([])).toBe("No tools");
  });

  test("lists names when within the limit", () => {
    expect(summarizeChatTools(["gmail"])).toBe("Gmail");
    expect(summarizeChatTools(["gmail", "web_search"])).toBe(
      "Gmail, Web search",
    );
  });

  test("truncates with a +N more suffix", () => {
    expect(summarizeChatTools(["gmail", "linear", "slack", "notion"], 2)).toBe(
      "Gmail, Linear +2 more",
    );
  });
});
