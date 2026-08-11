import { toProviderModelId } from "@open-agents/agent";
import { describe, expect, test } from "bun:test";
import { BUILT_IN_VARIANTS, type ModelVariant } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { resolveChatModelSelection } from "./model-selection";

describe("resolveChatModelSelection", () => {
  test("returns direct model ids unchanged", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: "openai/gpt-5",
      modelVariants: [],
      missingVariantLabel: "Selected model variant",
    });

    expect(selection).toEqual({
      id: toProviderModelId("openai/gpt-5"),
    });
  });

  test("resolves variant ids with provider options", () => {
    const modelVariants: ModelVariant[] = [
      {
        id: "variant:openai-medium",
        name: "OpenAI Medium",
        baseModelId: "openai/gpt-5",
        providerOptions: {
          reasoningEffort: "medium",
        },
      },
    ];

    const selection = resolveChatModelSelection({
      selectedModelId: "variant:openai-medium",
      modelVariants,
      missingVariantLabel: "Selected model variant",
    });

    expect(selection).toEqual({
      id: toProviderModelId("openai/gpt-5"),
      providerOptionsOverrides: {
        openai: {
          reasoningEffort: "medium",
          store: false,
        },
      },
    });
  });

  test("resolves built-in OpenAI variants with store false", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelVariants: BUILT_IN_VARIANTS,
      missingVariantLabel: "Selected model variant",
    });

    expect(selection).toEqual({
      id: toProviderModelId("openai/gpt-5.4"),
      providerOptionsOverrides: {
        openai: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          store: false,
        },
      },
    });
  });

  test("falls back to the default model and warns when a variant is missing", () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const selection = resolveChatModelSelection({
        selectedModelId: "variant:missing",
        modelVariants: [],
        missingVariantLabel: "Selected model variant",
      });

      expect(selection).toEqual({
        id: toProviderModelId(APP_DEFAULT_MODEL_ID),
      });
      expect(warnings).toEqual([
        [
          'Selected model variant "variant:missing" was not found. Falling back to default model.',
        ],
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("uses the default model when no model id is provided", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: null,
      modelVariants: [],
      missingVariantLabel: "Selected model variant",
    });

    expect(selection).toEqual({
      id: toProviderModelId(APP_DEFAULT_MODEL_ID),
    });
  });

  // Production bug: every agent turn for a user whose
  // `default_subagent_model_id` is a BYOK composite
  // ("user-profile:<profileId>:<modelId>") threw
  // UnresolvedCompositeModelIdError here, because this function minted the
  // raw composite via toProviderModelId() instead of deferring it. The fix is
  // to defer, not mint: return the (variant-resolved) composite UNMINTED so
  // resolveStepAgentModels — which resolves subagent ids on their own
  // profile, never inheriting the main model's — can see the
  // "user-profile:" prefix and resolve it on its own terms downstream.
  // Stripping the prefix here instead would make that downstream check stop
  // firing and route a BYOK model through the platform gateway unbilled.
  test("defers a BYOK composite id instead of throwing", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: "user-profile:profile-1:gemma-4-31b",
      modelVariants: [],
      missingVariantLabel: "Subagent model variant",
    });

    expect(selection.id).toStartWith("user-profile:");
  });

  // The platform's disabled-model guard (`isModelDisabled`, which rejects
  // "openai/gpt-*-pro") encodes what the PLATFORM GATEWAY refuses to serve. It
  // must NOT be applied to a BYOK composite: a user's own OpenAI-compatible
  // endpoint may legitimately serve a model whose id happens to match, since
  // OpenRouter and LiteLLM both namespace ids as "openai/gpt-...", and
  // user-profile options never pass through filterDisabledModels.
  //
  // Substituting the gateway default here would run a delegated subagent on
  // the PLATFORM key while the coordinator ran on the user's own — silent
  // mis-billing, and strictly worse than the loud crash this deferral fixed.
  test("does not apply the platform disabled-model guard to a BYOK composite", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: "user-profile:profile-1:openai/gpt-5-pro",
      modelVariants: [],
      missingVariantLabel: "Subagent model variant",
    });

    // Compared as a plain string: `.id` is a branded ProviderModelId, and the
    // whole point of this branch is that it is deliberately NOT one yet.
    expect(String(selection.id)).toBe(
      "user-profile:profile-1:openai/gpt-5-pro",
    );
    expect(String(selection.id)).not.toBe(String(APP_DEFAULT_MODEL_ID));
  });

  // A plain gateway id must still be caught by that guard.
  test("still falls back to the default for a disabled PLAIN model id", () => {
    const selection = resolveChatModelSelection({
      selectedModelId: "openai/gpt-5-pro",
      modelVariants: [],
      missingVariantLabel: "Selected model variant",
    });

    expect(selection).toEqual({ id: toProviderModelId(APP_DEFAULT_MODEL_ID) });
  });

  // Keyed on the prefix, not on a successful parse: a malformed composite
  // parses back to itself, so parse-keyed deferral would hand it to the mint
  // and throw the very error this fix removes.
  test("defers a malformed composite instead of throwing", () => {
    expect(() =>
      resolveChatModelSelection({
        selectedModelId: "user-profile:",
        modelVariants: [],
        missingVariantLabel: "Subagent model variant",
      }),
    ).not.toThrow();
  });
});
