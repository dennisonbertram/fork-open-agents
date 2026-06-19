import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { parseAnthropicModelsResponse } = await import("./fetch-profile-models");

describe("parseAnthropicModelsResponse", () => {
  test("parses the ZAI/Anthropic-compatible models listing", () => {
    const body = {
      data: [
        { id: "glm-4.6", display_name: "GLM-4.6", type: "model" },
        { id: "glm-4.5-air", display_name: "GLM-4.5-Air", type: "model" },
      ],
    };

    expect(parseAnthropicModelsResponse(body)).toEqual([
      { id: "glm-4.6", displayName: "GLM-4.6" },
      { id: "glm-4.5-air", displayName: "GLM-4.5-Air" },
    ]);
  });

  test("falls back to the id when display_name is missing", () => {
    expect(parseAnthropicModelsResponse({ data: [{ id: "glm-5" }] })).toEqual([
      { id: "glm-5", displayName: "glm-5" },
    ]);
  });

  test("drops malformed and duplicate entries without throwing", () => {
    const body = {
      data: [
        { id: "glm-4.6", display_name: "GLM-4.6" },
        { id: "", display_name: "blank" },
        { id: "glm-4.6", display_name: "dupe" },
        null,
        "garbage",
        { display_name: "no-id" },
      ],
    };

    expect(parseAnthropicModelsResponse(body)).toEqual([
      { id: "glm-4.6", displayName: "GLM-4.6" },
    ]);
  });

  test("returns an empty list for non-listing shapes", () => {
    expect(parseAnthropicModelsResponse(null)).toEqual([]);
    expect(parseAnthropicModelsResponse({})).toEqual([]);
    expect(parseAnthropicModelsResponse({ data: "nope" })).toEqual([]);
    expect(
      parseAnthropicModelsResponse({ error: { type: "rate_limit_error" } }),
    ).toEqual([]);
  });
});
