import { describe, expect, test } from "bun:test";
import type { ModelOption } from "@/lib/model-options";
import {
  getProfileEnabledToggleLabel,
  getProfileModelOptions,
  getProfileSelectedModelIds,
  getProfileUsageDisplayText,
  mergeProfileEnabledModelIds,
  summarizeProfileUsage,
} from "./inference-profiles-section";

function option({
  cost,
  id,
  inferenceProfileId,
  source = "catalog",
}: Pick<ModelOption, "id"> &
  Partial<
    Pick<ModelOption, "cost" | "inferenceProfileId" | "source">
  >): ModelOption {
  return {
    ...(cost ? { cost } : {}),
    id,
    inferenceProfileId,
    isVariant: false,
    label: id,
    provider: source === "user" ? "user" : "openai",
    shortLabel: id,
    source,
  };
}

describe("inference profile model selection", () => {
  const allModelOptions = [
    option({ id: "openai/gpt-5.5" }),
    option({
      id: "user-profile:fireworks:glm-5.2",
      inferenceProfileId: "fireworks",
      source: "user",
    }),
    option({
      id: "user-profile:fireworks:glm-5.2-air",
      inferenceProfileId: "fireworks",
      source: "user",
    }),
    option({
      id: "user-profile:baseten:zai-org/GLM-5.2",
      inferenceProfileId: "baseten",
      source: "user",
    }),
  ];

  test("finds only models belonging to the selected profile", () => {
    expect(getProfileModelOptions(allModelOptions, "fireworks")).toEqual([
      allModelOptions[1],
      allModelOptions[2],
    ]);
  });

  test("treats empty enabled model preferences as all profile models selected", () => {
    const profileModelOptions = getProfileModelOptions(
      allModelOptions,
      "fireworks",
    );

    expect(
      getProfileSelectedModelIds({
        enabledModelIds: [],
        profileModelOptions,
      }),
    ).toEqual([
      "user-profile:fireworks:glm-5.2",
      "user-profile:fireworks:glm-5.2-air",
    ]);
  });

  test("narrows one profile without hiding unrelated catalog or profile models", () => {
    const profileModelOptions = getProfileModelOptions(
      allModelOptions,
      "fireworks",
    );

    expect(
      mergeProfileEnabledModelIds({
        allModelOptions,
        currentEnabledModelIds: [],
        nextProfileModelIds: ["user-profile:fireworks:glm-5.2"],
        profileModelOptions,
      }),
    ).toEqual([
      "openai/gpt-5.5",
      "user-profile:fireworks:glm-5.2",
      "user-profile:baseten:zai-org/GLM-5.2",
    ]);
  });

  test("collapses back to the all-models preference when every known model is selected", () => {
    const profileModelOptions = getProfileModelOptions(
      allModelOptions,
      "fireworks",
    );

    expect(
      mergeProfileEnabledModelIds({
        allModelOptions,
        currentEnabledModelIds: [
          "openai/gpt-5.5",
          "user-profile:fireworks:glm-5.2",
          "user-profile:baseten:zai-org/GLM-5.2",
        ],
        nextProfileModelIds: [
          "user-profile:fireworks:glm-5.2",
          "user-profile:fireworks:glm-5.2-air",
        ],
        profileModelOptions,
      }),
    ).toEqual([]);
  });

  test("preserves unknown preference ids when updating the profile slice", () => {
    const profileModelOptions = getProfileModelOptions(
      allModelOptions,
      "fireworks",
    );

    expect(
      mergeProfileEnabledModelIds({
        allModelOptions,
        currentEnabledModelIds: [
          "openai/gpt-5.5",
          "user-profile:fireworks:glm-5.2-air",
          "external/future-model",
        ],
        nextProfileModelIds: ["user-profile:fireworks:glm-5.2"],
        profileModelOptions,
      }),
    ).toEqual([
      "openai/gpt-5.5",
      "user-profile:fireworks:glm-5.2",
      "external/future-model",
    ]);
  });

  test("labels the profile card enable switch with the next action", () => {
    expect(
      getProfileEnabledToggleLabel({
        enabled: true,
        name: "Fireworks",
      }),
    ).toBe("Disable Fireworks");
    expect(
      getProfileEnabledToggleLabel({
        enabled: false,
        name: "Baseten",
      }),
    ).toBe("Enable Baseten");
  });

  test("summarizes profile spend from known model pricing", () => {
    const summary = summarizeProfileUsage({
      modelOptions: [
        option({
          id: "user-profile:fireworks:glm-5.2",
          inferenceProfileId: "fireworks",
          source: "user",
          cost: { input: 2, output: 4 },
        }),
      ],
      profileId: "fireworks",
      usageRows: [
        {
          inferenceProfileId: "fireworks",
          provider: "anthropic",
          modelId: "user-profile:fireworks:glm-5.2",
          inputTokens: 1_000_000,
          cachedInputTokens: 0,
          outputTokens: 500_000,
          messageCount: 2,
          toolCallCount: 1,
        },
        {
          inferenceProfileId: "other-profile",
          provider: "anthropic",
          modelId: "user-profile:other-profile:glm-5.2",
          inputTokens: 1_000_000,
          cachedInputTokens: 0,
          outputTokens: 1_000_000,
          messageCount: 1,
          toolCallCount: 0,
        },
      ],
    });

    expect(summary).toMatchObject({
      totalTokens: 1_500_000,
      estimatedCostUsd: 4,
      pricedTokens: 1_500_000,
      modelCount: 1,
    });
    expect(getProfileUsageDisplayText(summary)).toBe(
      "$4.00 est. spent across 1.5m tokens",
    );
  });

  test("keeps unpriced profile usage visible without inventing spend", () => {
    const summary = summarizeProfileUsage({
      modelOptions: [],
      profileId: "baseten",
      usageRows: [
        {
          inferenceProfileId: "baseten",
          provider: "openai-compatible",
          modelId: "zai-org/GLM-5.2",
          inputTokens: 10_000,
          cachedInputTokens: 0,
          outputTokens: 5_000,
          messageCount: 1,
          toolCallCount: 0,
        },
      ],
    });

    expect(summary).toMatchObject({
      totalTokens: 15_000,
      estimatedCostUsd: 0,
      pricedTokens: 0,
    });
    expect(getProfileUsageDisplayText(summary)).toBe(
      "Cost unavailable across 15.0k tokens",
    );
  });
});
