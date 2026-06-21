import { describe, expect, test } from "bun:test";
import {
  getModelSystemPromptForSelection,
  normalizeModelSystemPrompts,
} from "./model-system-prompts";
import { createUserInferenceModelOptionId } from "./inference/model-option-id";

describe("model system prompts", () => {
  test("normalizes prompt maps and drops empty prompts", () => {
    expect(
      normalizeModelSystemPrompts({
        " openai/gpt-5.4 ": "  Be direct.  ",
        "anthropic/claude-opus-4.6": "   ",
        "openai/gpt-5": 123,
      }),
    ).toEqual({
      "openai/gpt-5.4": "Be direct.",
    });
  });

  test("prefers exact selector prompt before resolved model fallback", () => {
    const userProfileModelId = createUserInferenceModelOptionId(
      "profile-1",
      "glm-5.2",
    );

    expect(
      getModelSystemPromptForSelection(
        {
          "glm-5.2": "Generic GLM prompt",
          [userProfileModelId]: "Profile-specific prompt",
        },
        {
          selectedModelId: "glm-5.2",
          resolvedModelId: "glm-5.2",
          inferenceProfileId: "profile-1",
        },
      ),
    ).toBe("Profile-specific prompt");
  });

  test("falls back from a variant key to the resolved base model", () => {
    expect(
      getModelSystemPromptForSelection(
        {
          "openai/gpt-5.4": "Base prompt",
        },
        {
          selectedModelId: "variant:builtin:gpt-5.4-xhigh",
          resolvedModelId: "openai/gpt-5.4",
          inferenceProfileId: null,
        },
      ),
    ).toBe("Base prompt");
  });
});
