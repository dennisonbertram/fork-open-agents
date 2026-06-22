import { describe, expect, test } from "bun:test";
import {
  getInferenceProfileModelProvider,
  getInferenceProfileModelProviderDisplayName,
  isModelCompatibleWithInferenceProfile,
  toAnthropicCompatibleProfileModelId,
  toOpenAICompatibleProfileModelId,
} from "./profile-models";

describe("inference profile model compatibility", () => {
  const toAnthropicDirectModelId = (modelId: string) =>
    modelId.startsWith("anthropic/")
      ? modelId.slice("anthropic/".length).replaceAll(".", "-")
      : null;

  test("detects ZAI GLM profiles from name and routes ZAI models", () => {
    const profile = {
      name: "ZAI (GLM)",
      provider: "anthropic",
      baseUrl: "https://api.z.ai/api/anthropic/v1",
    };

    expect(getInferenceProfileModelProvider(profile)).toBe("zai");
    expect(isModelCompatibleWithInferenceProfile(profile, "zai/glm-4.6")).toBe(
      true,
    );
    expect(
      isModelCompatibleWithInferenceProfile(
        profile,
        "anthropic/claude-opus-4.6",
      ),
    ).toBe(false);
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "zai/glm-4.6",
        toAnthropicDirectModelId,
      ),
    ).toBe("glm-4.6");
  });

  test("keeps ordinary Anthropic profiles on Anthropic models", () => {
    const profile = {
      name: "Personal Anthropic",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
    };

    expect(getInferenceProfileModelProvider(profile)).toBe("anthropic");
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "anthropic/claude-opus-4.6",
        toAnthropicDirectModelId,
      ),
    ).toBe("claude-opus-4-6");
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "zai/glm-4.6",
        toAnthropicDirectModelId,
      ),
    ).toBeNull();
  });

  test("detects Fireworks profiles and maps catalog ids to account model ids", () => {
    const profile = {
      name: "Fireworks",
      provider: "anthropic",
      baseUrl: "https://api.fireworks.ai/inference/v1",
    };

    expect(getInferenceProfileModelProvider(profile)).toBe("fireworks");
    expect(getInferenceProfileModelProviderDisplayName(profile)).toBe(
      "Fireworks",
    );
    expect(
      isModelCompatibleWithInferenceProfile(profile, "fireworks/kimi-k2p5"),
    ).toBe(true);
    expect(
      isModelCompatibleWithInferenceProfile(
        profile,
        "deepseek/deepseek-v3.1",
        "fireworks",
      ),
    ).toBe(true);
    expect(
      isModelCompatibleWithInferenceProfile(profile, "zai/glm-5.2", "baseten"),
    ).toBe(true);
    expect(
      isModelCompatibleWithInferenceProfile(
        profile,
        "anthropic/claude-opus-4.6",
      ),
    ).toBe(false);
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "fireworks/kimi-k2p5",
        toAnthropicDirectModelId,
      ),
    ).toBe("accounts/fireworks/models/kimi-k2p5");
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "deepseek/deepseek-v3.1",
        toAnthropicDirectModelId,
        "fireworks",
      ),
    ).toBe("accounts/fireworks/models/deepseek-v3p1");
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "zai/glm-5.2",
        toAnthropicDirectModelId,
        "baseten",
      ),
    ).toBe("accounts/fireworks/models/glm-5p2");
    expect(
      toAnthropicCompatibleProfileModelId(
        profile,
        "fireworks/accounts/fireworks/models/deepseek-v3p1",
        toAnthropicDirectModelId,
      ),
    ).toBe("accounts/fireworks/models/deepseek-v3p1");
  });

  test("supports OpenAI-compatible profiles with custom model ids", () => {
    const profile = {
      name: "Sakana",
      provider: "openai-compatible",
      baseUrl: "https://api.sakana.ai/fugu/v1",
      modelIds: ["fugu-mini", "fugu-ultra"],
    };

    expect(getInferenceProfileModelProvider(profile)).toBe("openai-compatible");
    expect(getInferenceProfileModelProviderDisplayName(profile)).toBe(
      "OpenAI-compatible",
    );
    expect(
      isModelCompatibleWithInferenceProfile(
        profile,
        "openai-compatible/fugu-ultra",
      ),
    ).toBe(true);
    expect(
      isModelCompatibleWithInferenceProfile(profile, "anthropic/claude-opus-4"),
    ).toBe(false);
    expect(
      toOpenAICompatibleProfileModelId(profile, "openai-compatible/fugu-ultra"),
    ).toBe("fugu-ultra");
  });

  test("detects Cursor OpenAI-compatible profiles and strips cursor model prefixes", () => {
    const profile = {
      name: "Cursor",
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:8787/v1",
      modelIds: ["composer-2.5", "composer-2.5-fast"],
    };

    expect(getInferenceProfileModelProvider(profile)).toBe("cursor");
    expect(getInferenceProfileModelProviderDisplayName(profile)).toBe("Cursor");
    expect(
      isModelCompatibleWithInferenceProfile(profile, "cursor/composer-2.5"),
    ).toBe(true);
    expect(
      toOpenAICompatibleProfileModelId(profile, "cursor/composer-2.5"),
    ).toBe("composer-2.5");
    expect(
      toOpenAICompatibleProfileModelId(profile, "cursor/composer-2.5-fast"),
    ).toBe("composer-2.5-fast");
  });
});
