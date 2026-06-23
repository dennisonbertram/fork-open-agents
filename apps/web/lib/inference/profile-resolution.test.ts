import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let profile: {
  id: string;
  name: string;
  provider: "anthropic" | "openai-compatible";
  enabled: boolean;
  baseUrl: string | null;
  encryptedApiKey: string;
} | null = null;
let decryptError: Error | null = null;
const recordResultCalls: Array<{
  userId: string;
  profileId: string;
  result: unknown;
}> = [];

mock.module("@open-agents/agent", () => ({
  directAnthropicModel: (config: unknown) => config,
  directOpenAIModel: (config: unknown) => config,
  toAnthropicDirectModelId: (modelId: string) =>
    modelId === "anthropic/claude-haiku-4.5" ? "claude-haiku-4-5" : null,
}));

mock.module("@/lib/db/inference-profiles", () => ({
  INFERENCE_PROFILE_REENTER_KEY_MESSAGE:
    "This saved API key can no longer be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.",
  decryptInferenceProfileApiKey: () => {
    if (decryptError) {
      throw decryptError;
    }
    return "decrypted-key";
  },
  getInferenceProfileByIdForUser: async () => profile,
  recordInferenceProfileTestResult: async (
    userId: string,
    profileId: string,
    result: unknown,
  ) => {
    recordResultCalls.push({ userId, profileId, result });
    return null;
  },
}));

const { resolveInferenceProfileModelSelection } =
  await import("./profile-resolution");

describe("resolveInferenceProfileModelSelection", () => {
  beforeEach(() => {
    decryptError = null;
    recordResultCalls.length = 0;
  });

  test("routes OpenAI-compatible profile models through direct inference config", async () => {
    profile = {
      id: "profile-openai",
      name: "Local Gateway",
      provider: "openai-compatible",
      enabled: true,
      baseUrl: "https://llm.example.com/v1",
      encryptedApiKey: "encrypted-key",
    };

    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: "profile-openai",
      selection: { id: "custom/reasoner" as never },
    });

    expect(selection).toMatchObject({
      id: "custom/reasoner",
      directInference: {
        provider: "openai-compatible",
        modelId: "custom/reasoner",
        apiKey: "decrypted-key",
        baseURL: "https://llm.example.com/v1",
      },
      attribution: {
        inferenceRoute: "user",
        inferenceProfileId: "profile-openai",
        inferenceProfileName: "Local Gateway",
        provider: "openai-compatible",
      },
    });
  });

  test("normalizes saved OpenAI-compatible chat-completion URLs before routing", async () => {
    profile = {
      id: "profile-baseten",
      name: "Baseten",
      provider: "openai-compatible",
      enabled: true,
      baseUrl: "https://inference.baseten.co/v1/chat/completions/v1",
      encryptedApiKey: "encrypted-key",
    };

    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: "profile-baseten",
      selection: { id: "zai-org/GLM-5.2" as never },
    });

    expect(selection).toMatchObject({
      directInference: {
        provider: "openai-compatible",
        modelId: "zai-org/GLM-5.2",
        apiKey: "decrypted-key",
        baseURL: "https://inference.baseten.co/v1",
      },
    });
  });

  test("preserves Anthropic catalog id mapping for Anthropic-compatible profiles", async () => {
    profile = {
      id: "profile-anthropic",
      name: "Personal Anthropic",
      provider: "anthropic",
      enabled: true,
      baseUrl: null,
      encryptedApiKey: "encrypted-key",
    };

    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: "profile-anthropic",
      selection: { id: "anthropic/claude-haiku-4.5" as never },
    });

    expect(selection).toMatchObject({
      directInference: {
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        apiKey: "decrypted-key",
      },
    });
  });

  test("allows Anthropic-compatible provider model ids that contain slashes", async () => {
    profile = {
      id: "profile-fireworks",
      name: "Fireworks",
      provider: "anthropic",
      enabled: true,
      baseUrl: "https://api.fireworks.ai/inference/v1/messages",
      encryptedApiKey: "encrypted-key",
    };

    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: "profile-fireworks",
      selection: { id: "accounts/fireworks/models/kimi-k2p5" as never },
    });

    expect(selection).toMatchObject({
      directInference: {
        provider: "anthropic",
        modelId: "accounts/fireworks/models/kimi-k2p5",
        apiKey: "decrypted-key",
        baseURL: "https://api.fireworks.ai/inference/v1",
      },
    });
  });

  test("marks profile failed when the stored API key cannot be decrypted", async () => {
    profile = {
      id: "profile-zai",
      name: "ZAI (GLM)",
      provider: "anthropic",
      enabled: true,
      baseUrl: "https://api.z.ai/api/anthropic/v1",
      encryptedApiKey: "encrypted-key",
    };
    decryptError = Object.assign(
      new Error(
        'The saved API key for inference profile "ZAI (GLM)" can\'t be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.',
      ),
      { name: "InferenceProfileResolutionError" },
    );

    await expect(
      resolveInferenceProfileModelSelection({
        userId: "user-1",
        inferenceProfileId: "profile-zai",
        selection: { id: "glm-5.2" as never },
      }),
    ).rejects.toThrow("Re-enter the API key");

    expect(recordResultCalls).toEqual([
      {
        userId: "user-1",
        profileId: "profile-zai",
        result: {
          status: "failed",
          message:
            "This saved API key can no longer be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.",
        },
      },
    ]);
  });
});
