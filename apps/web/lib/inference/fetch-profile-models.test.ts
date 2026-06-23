import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const {
  fetchInferenceProfileModels,
  parseAnthropicModelsResponse,
  parseOpenAICompatibleModelsResponse,
} = await import("./fetch-profile-models");

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

describe("parseOpenAICompatibleModelsResponse", () => {
  test("parses OpenAI-compatible models listings", () => {
    const body = {
      data: [
        { id: "gpt-4o-mini", object: "model" },
        {
          id: "custom/reasoning-model",
          name: "Reasoning Model",
          context_window: 128_000,
        },
      ],
    };

    expect(parseOpenAICompatibleModelsResponse(body)).toEqual([
      { id: "gpt-4o-mini", displayName: "gpt-4o-mini" },
      {
        id: "custom/reasoning-model",
        displayName: "Reasoning Model",
        contextWindow: 128_000,
      },
    ]);
  });

  test("drops malformed and duplicate OpenAI-compatible models", () => {
    const body = {
      data: [
        { id: "gpt-4o-mini" },
        { id: "gpt-4o-mini", name: "dupe" },
        { id: "" },
        { name: "no id" },
        null,
      ],
    };

    expect(parseOpenAICompatibleModelsResponse(body)).toEqual([
      { id: "gpt-4o-mini", displayName: "gpt-4o-mini" },
    ]);
  });
});

describe("fetchInferenceProfileModels", () => {
  test("uses Baseten Api-Key auth for OpenAI-compatible model discovery", async () => {
    const calls = installFetchRecorder();

    await fetchInferenceProfileModels({
      provider: "openai-compatible",
      baseUrl: "https://inference.baseten.co/v1",
      apiKey: "baseten-key",
    });

    expect(calls).toEqual([
      {
        url: "https://inference.baseten.co/v1/models",
        headers: { Authorization: "Api-Key baseten-key" },
      },
    ]);
  });

  test("keeps bearer auth for generic OpenAI-compatible model discovery", async () => {
    const calls = installFetchRecorder();

    await fetchInferenceProfileModels({
      provider: "openai-compatible",
      baseUrl: "https://openai.example/v1",
      apiKey: "openai-key",
    });

    expect(calls).toEqual([
      {
        url: "https://openai.example/v1/models",
        headers: { Authorization: "Bearer openai-key" },
      },
    ]);
  });

  test("normalizes Fireworks Anthropic-compatible message endpoints before model discovery", async () => {
    const calls = installFetchRecorder();

    await fetchInferenceProfileModels({
      provider: "anthropic",
      baseUrl: "https://api.fireworks.ai/inference/v1/messages",
      apiKey: "fireworks-key",
    });

    expect(calls).toEqual([
      {
        url: "https://api.fireworks.ai/inference/v1/models",
        headers: {
          Authorization: "Bearer fireworks-key",
          "anthropic-version": "2023-06-01",
        },
      },
    ]);
  });
});

function installFetchRecorder() {
  const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  globalThis.fetch = ((input, init) => {
    calls.push({ url: String(input), headers: init?.headers });
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return calls;
}
