import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let profile: {
  id: string;
  userId: string;
  name: string;
  provider: "anthropic" | "openai-compatible";
  baseUrl: string | null;
  encryptedApiKey: string;
  keyLast4: string;
  keyFingerprint: string;
  enabled: boolean;
} | null = null;
let profileLookupCount = 0;

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: async () => {
    profileLookupCount += 1;
    return profile;
  },
}));

const { resolveBackgroundAgentInferenceSnapshot } =
  await import("./inference-snapshot");

beforeEach(() => {
  profile = null;
  profileLookupCount = 0;
});

describe("resolveBackgroundAgentInferenceSnapshot", () => {
  test("captures the concrete default model at queue time", async () => {
    await expect(
      resolveBackgroundAgentInferenceSnapshot({
        userId: "user-1",
        modelId: null,
        defaultModelId: "anthropic/claude-opus-4.6",
      }),
    ).resolves.toEqual({
      route: "gateway",
      modelId: "anthropic/claude-opus-4.6",
    });
    expect(profileLookupCount).toBe(0);
  });

  test("captures normalized non-secret user profile routing metadata", async () => {
    profile = {
      id: "profile-1",
      userId: "user-1",
      name: "Private endpoint",
      provider: "openai-compatible",
      baseUrl: "https://inference.example.com/chat/completions",
      encryptedApiKey: "must-not-be-copied",
      keyLast4: "1234",
      keyFingerprint: "must-not-be-copied",
      enabled: true,
    };

    const snapshot = await resolveBackgroundAgentInferenceSnapshot({
      userId: "user-1",
      modelId: "user-profile:profile-1:custom%2Freasoner",
    });

    expect(snapshot).toEqual({
      route: "user",
      modelId: "custom/reasoner",
      inferenceProfileId: "profile-1",
      provider: "openai-compatible",
      baseUrl: "https://inference.example.com/v1",
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-be-copied");
  });

  test("refuses to queue a new run for a missing user profile", async () => {
    await expect(
      resolveBackgroundAgentInferenceSnapshot({
        userId: "user-1",
        modelId: "user-profile:missing:glm-5.2",
      }),
    ).rejects.toThrow("unavailable");
  });
});
