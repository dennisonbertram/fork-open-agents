import { describe, expect, test } from "bun:test";
import type { ModelVariant } from "@/lib/model-variants";
import {
  buildModelOptions,
  getDefaultModelOptionId,
  groupByProvider,
  withMissingModelOption,
} from "./model-options";
import type { AvailableModel } from "./models";

function createModel(input: {
  id: string;
  name?: string;
  description?: string | null;
  contextWindow?: number;
}): AvailableModel {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    context_window: input.contextWindow,
    modelType: "language",
  } as unknown as AvailableModel;
}

describe("model options", () => {
  test("buildModelOptions includes base models and variants", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "openai/gpt-5",
        name: "GPT-5",
        description: "Base model",
        contextWindow: 400_000,
      }),
    ];

    const variants: ModelVariant[] = [
      {
        id: "variant:gpt-5-medium",
        name: "GPT-5 Medium Reasoning",
        baseModelId: "openai/gpt-5",
        providerOptions: { reasoningEffort: "medium" },
      },
    ];

    const options = buildModelOptions(models, variants);

    expect(options).toEqual([
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        description: "Base model",
        isVariant: false,
        contextWindow: 400_000,
        provider: "openai",
        source: "catalog",
      },
      {
        id: "variant:gpt-5-medium",
        label: "GPT-5 Medium Reasoning",
        shortLabel: "GPT-5 Medium Reasoning",
        description: "Variant of GPT-5",
        isVariant: true,
        contextWindow: 400_000,
        provider: "openai",
        source: "catalog",
        baseModelId: "openai/gpt-5",
      },
    ]);
  });

  test("buildModelOptions strips provider prefix for shortLabel", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
      }),
    ];

    const options = buildModelOptions(models, []);

    expect(options[0].shortLabel).toBe("Opus 4.6");
    expect(options[0].label).toBe("Claude Opus 4.6");
  });

  test("buildModelOptions prepends user Anthropic profile options", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        contextWindow: 200_000,
      }),
      createModel({ id: "openai/gpt-5", name: "GPT-5" }),
    ];

    const options = buildModelOptions(
      models,
      [],
      [
        {
          id: "profile-1",
          name: "Personal Anthropic",
          provider: "anthropic",
          baseUrl: "https://platformproxy.example.com/v1",
          keyLast4: "abcd",
          keyFingerprint: "fingerprint",
          status: "verified",
          lastTestedAt: null,
          lastTestMessage: null,
          enabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    );

    expect(options[0]).toMatchObject({
      id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
      label: "Claude Opus 4.6",
      shortLabel: "Opus 4.6",
      description: "Direct Anthropic via Personal Anthropic",
      isVariant: false,
      contextWindow: 200_000,
      provider: "user",
      source: "user",
      baseModelId: "anthropic/claude-opus-4.6",
      inferenceProfileId: "profile-1",
      secondaryLabel: "Personal Anthropic",
    });
    expect(options.map((option) => option.id)).toEqual([
      "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
      "anthropic/claude-opus-4.6",
      "openai/gpt-5",
    ]);
  });

  test("groupByProvider puts user, anthropic, and openai first, preserves insertion order", () => {
    const options = [
      {
        id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
        label: "Claude Opus 4.6",
        shortLabel: "Opus 4.6",
        isVariant: false,
        provider: "user",
      },
      {
        id: "google/gemini-2.5",
        label: "Gemini 2.5",
        shortLabel: "2.5",
        isVariant: false,
        provider: "google",
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
      {
        id: "variant:opus-custom",
        label: "Opus Custom",
        shortLabel: "Opus Custom",
        isVariant: true,
        provider: "anthropic",
      },
      {
        id: "anthropic/claude-opus-4.6",
        label: "Claude Opus 4.6",
        shortLabel: "Opus 4.6",
        isVariant: false,
        provider: "anthropic",
      },
    ];

    const groups = groupByProvider(options);

    expect(groups.map((g) => g.provider)).toEqual([
      "user",
      "anthropic",
      "openai",
      "google",
    ]);
    // Within anthropic: preserves original order (variant first, base second)
    expect(groups[1].options[0].id).toBe("variant:opus-custom");
    expect(groups[1].options[1].id).toBe("anthropic/claude-opus-4.6");
  });

  test("withMissingModelOption appends missing variant option", () => {
    const result = withMissingModelOption([], "variant:removed");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "variant:removed",
      label: "removed (missing)",
      shortLabel: "removed (missing)",
      description: "Variant no longer exists",
      isVariant: true,
      contextWindow: undefined,
      provider: "unknown",
    });
  });

  test("withMissingModelOption does not append non-variant ids", () => {
    const original = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(withMissingModelOption(original, "openai/unknown-model")).toBe(
      original,
    );
  });

  test("withMissingModelOption appends missing user profile option", () => {
    const result = withMissingModelOption(
      [],
      "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
    );

    expect(result).toEqual([
      {
        id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
        label: "anthropic/claude-opus-4.6 (missing profile)",
        shortLabel: "anthropic/claude-opus-4.6 (missing profile)",
        description: "Inference profile no longer exists",
        isVariant: false,
        contextWindow: undefined,
        provider: "user",
        source: "user",
        baseModelId: "anthropic/claude-opus-4.6",
        inferenceProfileId: "profile-1",
      },
    ]);
  });

  test("withMissingModelOption returns original list when id already exists", () => {
    const original = [
      {
        id: "variant:existing",
        label: "Existing Variant",
        shortLabel: "Existing Variant",
        isVariant: true,
        provider: "openai",
      },
    ];

    expect(withMissingModelOption(original, "variant:existing")).toBe(original);
  });

  test("getDefaultModelOptionId prefers repository default model when present", () => {
    const options = [
      {
        id: "openai/gpt-5.4",
        label: "GPT-5.4",
        shortLabel: "GPT-5.4",
        isVariant: false,
        provider: "anthropic",
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5.4");
  });

  test("getDefaultModelOptionId falls back to first option when default is missing", () => {
    const options = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5");
  });
});
