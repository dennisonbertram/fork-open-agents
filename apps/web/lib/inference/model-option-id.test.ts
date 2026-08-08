import { describe, expect, test } from "bun:test";
import {
  createUserInferenceModelOptionId,
  getModelOptionSelectionId,
  parseModelOptionSelection,
  splitModelSelection,
} from "./model-option-id";

describe("model option ids", () => {
  test("round-trips user inference model selections", () => {
    const optionId = createUserInferenceModelOptionId(
      "profile:1",
      "anthropic/claude-opus-4.6",
    );

    expect(optionId).toBe(
      "user-profile:profile%3A1:anthropic%2Fclaude-opus-4.6",
    );
    expect(parseModelOptionSelection(optionId)).toEqual({
      inferenceProfileId: "profile:1",
      modelId: "anthropic/claude-opus-4.6",
    });
  });

  test("keeps catalog selections unchanged", () => {
    expect(parseModelOptionSelection("openai/gpt-5.4")).toEqual({
      inferenceProfileId: null,
      modelId: "openai/gpt-5.4",
    });
    expect(getModelOptionSelectionId("openai/gpt-5.4", null)).toBe(
      "openai/gpt-5.4",
    );
  });

  test("returns encoded selection id only when a profile is present", () => {
    expect(
      getModelOptionSelectionId("anthropic/claude-haiku-4.5", "profile-1"),
    ).toBe("user-profile:profile-1:anthropic%2Fclaude-haiku-4.5");
    expect(getModelOptionSelectionId(null, "profile-1")).toBe("");
  });

  // #1154: shared write-boundary normalizer reused by user preferences and
  // the three chat-creation routes so a composite never lands in a modelId
  // column while the paired profile id column is null.
  describe("splitModelSelection", () => {
    test("decodes a composite modelId when there is no explicit profile", () => {
      const composite = createUserInferenceModelOptionId(
        "profile-legacy",
        "claude-sonnet-4.5",
      );

      expect(splitModelSelection(composite, undefined)).toEqual({
        modelId: "claude-sonnet-4.5",
        inferenceProfileId: "profile-legacy",
      });
      expect(splitModelSelection(composite, null)).toEqual({
        modelId: "claude-sonnet-4.5",
        inferenceProfileId: "profile-legacy",
      });
    });

    test("an already-explicit profile id wins over a decoded one", () => {
      const composite = createUserInferenceModelOptionId(
        "profile-legacy",
        "claude-sonnet-4.5",
      );

      expect(splitModelSelection(composite, "profile-explicit")).toEqual({
        modelId: "claude-sonnet-4.5",
        inferenceProfileId: "profile-explicit",
      });
    });

    test("leaves a plain provider model id unchanged", () => {
      expect(splitModelSelection("openai/gpt-5.4", null)).toEqual({
        modelId: "openai/gpt-5.4",
        inferenceProfileId: null,
      });
    });
  });
});
