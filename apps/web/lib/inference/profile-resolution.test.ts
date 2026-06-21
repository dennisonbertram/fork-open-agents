import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let profile: {
  id: string;
  name: string;
  provider: "anthropic" | "openai-compatible";
  enabled: boolean;
  baseUrl: string | null;
  encryptedApiKey: string;
} | null = null;

mock.module("@open-agents/agent", () => ({
  directAnthropicModel: (config: unknown) => config,
  directOpenAIModel: (config: unknown) => config,
  toAnthropicDirectModelId: (modelId: string) =>
    modelId === "anthropic/claude-haiku-4.5" ? "claude-haiku-4-5" : null,
}));

mock.module("@/lib/db/inference-profiles", () => ({
  decryptInferenceProfileApiKey: () => "decrypted-key",
  getInferenceProfileByIdForUser: async () => profile,
}));

const { resolveInferenceProfileModelSelection } =
  await import("./profile-resolution");

describe("resolveInferenceProfileModelSelection", () => {
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
});
