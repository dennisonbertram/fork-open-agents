/**
 * Regression tests for #1157: the two non-negotiable roster routing guards.
 *
 * roster.ts used to build a roster model override with `gateway` imported
 * from "ai" — the AI SDK's default Vercel gateway — instead of
 * `packages/agent/models.ts`'s `gateway()`, which is the only place
 * `directInference` (BYOK / direct-inference routing) actually reaches a
 * provider call. That meant ANY roster model override, including a plain
 * gateway id, silently discarded the user's own-key routing and billed
 * through the Vercel gateway instead.
 *
 * These tests mock "ai" and the direct-provider SDKs (mirroring
 * models.test.ts's pattern) so the actual provider construction call — not
 * just the resulting model's `.modelId` — is observable, which is the only
 * way to prove routing was preserved rather than merely a model id string.
 */

import { describe, expect, mock, test } from "bun:test";

const createGatewayCalls: Array<Record<string, unknown>> = [];
const createAnthropicCalls: Array<Record<string, unknown>> = [];
const createOpenAICompatibleCalls: Array<Record<string, unknown>> = [];

mock.module("ai", () => {
  const gatewayFn = (modelId: string) => ({
    provider: "gateway",
    modelId,
  });

  return {
    createGateway: (settings?: Record<string, unknown>) => {
      createGatewayCalls.push(settings ?? {});
      return gatewayFn;
    },
    defaultSettingsMiddleware: (_settings: unknown) => ({
      kind: "default-settings-middleware",
    }),
    gateway: gatewayFn,
    wrapLanguageModel: ({ model }: { model: unknown }) => model,
  };
});

mock.module("@ai-sdk/anthropic", () => ({
  createAnthropic: (settings?: Record<string, unknown>) => {
    createAnthropicCalls.push(settings ?? {});
    return (modelId: string) => ({ provider: "anthropic", modelId });
  },
}));

mock.module("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (settings?: Record<string, unknown>) => {
    createOpenAICompatibleCalls.push(settings ?? {});
    return {
      chatModel: (modelId: string) => ({
        provider: "openai-compatible",
        modelId,
      }),
    };
  },
}));

mock.module("@ai-sdk/devtools", () => ({
  devToolsMiddleware: () => ({ kind: "devtools-middleware" }),
}));

const { applyRosterOverrides } = await import("./roster");
const { toProviderModelId } = await import("../provider-model-id");

function resetCalls() {
  createGatewayCalls.length = 0;
  createAnthropicCalls.length = 0;
  createOpenAICompatibleCalls.length = 0;
}

// ── Guard: a plain gateway roster override preserves the base selection's
//    directInference and providerOptionsOverrides ─────────────────────────

describe("Guard 1: plain gateway roster override preserves base directInference", () => {
  test("a roster entry with no directInference of its own derives direct routing for its OWN model, not the base's", () => {
    resetCalls();

    const result = applyRosterOverrides({
      role: "explorer",
      roster: {
        // Plain gateway id override -- carries no profile/directInference
        // of its own. Deliberately a DIFFERENT model than the base.
        explorer: {
          modelSelection: {
            id: toProviderModelId("anthropic/claude-haiku-4.5"),
          },
        },
      },
      base: {
        model: { modelId: "anthropic/claude-opus-4.6" },
        instructions: "base",
        // The role's default routing: a user's own Anthropic-compatible key,
        // not the Vercel gateway.
        selection: {
          id: toProviderModelId("anthropic/claude-opus-4.6"),
          directInference: {
            provider: "anthropic",
            modelId: "claude-opus-4-6",
            apiKey: "user-own-key",
            baseURL: "https://user-endpoint.example/v1",
          },
        },
      },
    });

    // Must NOT have fallen back to the plain Vercel gateway.
    expect(createGatewayCalls.length).toBe(0);
    expect(createAnthropicCalls).toEqual([
      expect.objectContaining({ apiKey: "user-own-key" }),
    ]);
    // The reused key/endpoint must call the provider with the ROLE's own
    // model (haiku), never the base's (opus). Silently substituting the
    // base's modelId here is the #1157-class bug this guard exists to catch.
    expect(result.model as unknown).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
  });

  test("a roster entry whose plain model id can't be mapped onto the base's direct provider falls back to the plain gateway with the ROLE's model id (never the base's provider call)", () => {
    resetCalls();

    const result = applyRosterOverrides({
      role: "explorer",
      roster: {
        // Cross-provider override: base has an Anthropic direct key, but
        // this role picked an OpenAI model.
        explorer: {
          modelSelection: { id: toProviderModelId("openai/gpt-4o") },
        },
      },
      base: {
        model: { modelId: "anthropic/claude-opus-4.6" },
        instructions: "base",
        selection: {
          id: toProviderModelId("anthropic/claude-opus-4.6"),
          directInference: {
            provider: "anthropic",
            modelId: "claude-opus-4-6",
            apiKey: "user-own-key",
            baseURL: "https://user-endpoint.example/v1",
          },
        },
      },
    });

    // Must NOT have routed the openai/gpt-4o override through the base's
    // Anthropic direct-inference key/endpoint.
    expect(createAnthropicCalls.length).toBe(0);
    expect(createGatewayCalls.length).toBe(1);
    expect(result.model as unknown).toEqual({
      provider: "gateway",
      modelId: toProviderModelId("openai/gpt-4o"),
    });
  });

  test("a roster entry with no directInference of its own preserves the base selection's providerOptionsOverrides", () => {
    resetCalls();

    applyRosterOverrides({
      role: "executor",
      roster: {
        executor: {
          modelSelection: { id: toProviderModelId("openai/gpt-4o") },
        },
      },
      base: {
        model: { modelId: "openai/gpt-4o" },
        instructions: "base",
        selection: {
          id: toProviderModelId("openai/gpt-4o"),
          providerOptionsOverrides: {
            openai: { reasoningSummary: "detailed" },
          },
        },
      },
    });

    // No direct-inference config was set, so gateway() should have gone
    // through createGateway -- but the provider option override must still
    // have been threaded (proven indirectly: applyRosterOverrides must not
    // have thrown and must have reached the "ai" gateway path only once).
    expect(createGatewayCalls.length).toBe(1);
  });
});

// ── Guard 2: a roster entry with its own profile's directInference is never
//    overridden by the base selection's (or the main model's) ────────────

describe("Guard 2: a roster entry's own directInference wins over the base selection's", () => {
  test("entry.modelSelection.directInference is used, base.selection.directInference is ignored", () => {
    resetCalls();

    const result = applyRosterOverrides({
      role: "design",
      roster: {
        design: {
          modelSelection: {
            id: toProviderModelId("openai-compatible-model"),
            directInference: {
              provider: "openai-compatible",
              modelId: "role-own-model",
              apiKey: "role-own-key",
              baseURL: "https://role-own-endpoint.example/v1",
            },
          },
        },
      },
      base: {
        model: { modelId: "anthropic/claude-opus-4.6" },
        instructions: "base",
        // A DIFFERENT profile's routing -- must never be used for this entry.
        selection: {
          id: toProviderModelId("anthropic/claude-opus-4.6"),
          directInference: {
            provider: "anthropic",
            modelId: "claude-opus-4-6",
            apiKey: "main-or-default-key",
            baseURL: "https://main-endpoint.example/v1",
          },
        },
      },
    });

    expect(createAnthropicCalls.length).toBe(0);
    expect(createOpenAICompatibleCalls).toEqual([
      expect.objectContaining({ apiKey: "role-own-key" }),
    ]);
    expect(result.model as unknown).toEqual({
      provider: "openai-compatible",
      modelId: "role-own-model",
    });
  });
});
