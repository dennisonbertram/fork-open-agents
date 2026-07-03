import { describe, expect, test } from "bun:test";
import type { SafeInferenceProfile } from "@/lib/inference/types";
import { buildSessionChatModelOptions } from "@/lib/model-options";
import type { AvailableModel } from "@/lib/models";
import { hasSelectableModelOptions } from "./has-selectable-model-options";

function createModel(id: string): AvailableModel {
  return {
    id,
    name: id,
    description: null,
    modelType: "language",
  } as unknown as AvailableModel;
}

function createInferenceProfile(
  overrides: Partial<SafeInferenceProfile> = {},
): SafeInferenceProfile {
  return {
    id: "profile-1",
    name: "My OpenAI Key",
    provider: "openai",
    baseUrl: null,
    keyLast4: "abcd",
    keyFingerprint: "fingerprint",
    status: "passed",
    lastTestedAt: null,
    lastTestMessage: null,
    enabled: true,
    models: [{ id: "openai/gpt-5", displayName: "GPT-5" }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SafeInferenceProfile;
}

describe("hasSelectableModelOptions", () => {
  test("returns false when the gateway catalog and inference profiles are both empty", () => {
    const options = buildSessionChatModelOptions([], [], []);

    expect(hasSelectableModelOptions(options)).toBe(false);
  });

  test("returns true when the gateway catalog has models", () => {
    const options = buildSessionChatModelOptions(
      [createModel("anthropic/claude-opus-4.6")],
      [],
      [],
    );

    expect(hasSelectableModelOptions(options)).toBe(true);
  });

  test("returns true when the gateway catalog is empty but a usable inference profile exists", () => {
    // Regression: a user with an own-key inference profile still has
    // selectable models even when the gateway catalog fetch failed or
    // returned zero models. Gating on gateway-only models would incorrectly
    // show the "no models configured" banner in this case.
    const options = buildSessionChatModelOptions(
      [],
      [],
      [createInferenceProfile()],
    );

    expect(hasSelectableModelOptions(options)).toBe(true);
  });

  test("returns false when inference profiles exist but are all disabled", () => {
    const options = buildSessionChatModelOptions(
      [],
      [],
      [createInferenceProfile({ enabled: false })],
    );

    expect(hasSelectableModelOptions(options)).toBe(false);
  });
});
