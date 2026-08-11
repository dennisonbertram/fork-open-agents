import { describe, expect, test } from "bun:test";
import { isModelServedByProfile } from "./profile-model-availability";

/**
 * This is a refusal guard, so it is exercised through the real exported
 * function. An earlier version of these cases reimplemented the comparison
 * locally, which meant deleting the production parsing — or feeding it the
 * wrong value — left every test green.
 */
describe("isModelServedByProfile", () => {
  const openAiCompatible = {
    provider: "openai-compatible",
    models: [{ id: "gemma-4-31b" }, { id: "zai-glm-4.7" }],
  };

  test("matches a composite selection against the profile's bare model ids", () => {
    // A legacy chat still carries "user-profile:<profileId>:<modelId>" here,
    // while the profile's own list holds bare ids. Comparing the composite
    // matches nothing and refuses a model the profile actually serves.
    expect(
      isModelServedByProfile({
        selectionId: "user-profile:profile-1:gemma-4-31b",
        profile: openAiCompatible,
      }),
    ).toBe(true);
  });

  test("matches a plain selection unchanged", () => {
    expect(
      isModelServedByProfile({
        selectionId: "gemma-4-31b",
        profile: openAiCompatible,
      }),
    ).toBe(true);
  });

  test("still refuses a model the profile does not serve", () => {
    expect(
      isModelServedByProfile({
        selectionId: "user-profile:profile-1:not-served",
        profile: openAiCompatible,
      }),
    ).toBe(false);
  });

  test("does not accept an Anthropic catalog id on a non-Anthropic profile", () => {
    // Without the provider gate, any "anthropic/..." id reads as available on
    // an OpenAI-compatible profile that never advertised it — and the
    // unadvertised id is then sent to that endpoint instead of being refused
    // here with the intended availability error.
    expect(
      isModelServedByProfile({
        selectionId: "user-profile:profile-1:anthropic/claude-sonnet-4",
        profile: { provider: "openai-compatible", models: [] },
      }),
    ).toBe(false);
  });

  test("accepts an Anthropic catalog id on an Anthropic profile with no discovered models", () => {
    expect(
      isModelServedByProfile({
        selectionId: "anthropic/claude-sonnet-4",
        profile: { provider: "anthropic", models: [] },
      }),
    ).toBe(true);
  });

  test("a discovered model still wins on an Anthropic profile", () => {
    expect(
      isModelServedByProfile({
        selectionId: "some-custom-model",
        profile: {
          provider: "anthropic",
          models: [{ id: "some-custom-model" }],
        },
      }),
    ).toBe(true);
  });

  test("tolerates a profile with no model list", () => {
    expect(
      isModelServedByProfile({
        selectionId: "gemma-4-31b",
        profile: { provider: "openai-compatible", models: null },
      }),
    ).toBe(false);
  });
});
