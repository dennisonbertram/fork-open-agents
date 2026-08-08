/**
 * Regression coverage for #1123 — defence in depth.
 *
 * "user-profile:<inferenceProfileId>:<modelId>" is an internal composite option
 * id. Handing it to the Vercel AI Gateway produced the production failure
 * `Provider error: Model 'user-profile:mw51n3rR9QQZqf6Boe42i:zai-glm-4.7' not found`.
 *
 * resolveInferenceProfileModelSelection is the last funnel before a model id
 * leaves the app, so it must never forward an internal identifier to a
 * provider: it recovers the profile from the composite when the caller lost it,
 * and fails with a typed, actionable error when the composite is unusable.
 */

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

const lookupCalls: Array<{ userId: string; profileId: string }> = [];

mock.module("@open-agents/agent", () => ({
  directAnthropicModel: (config: unknown) => config,
  directOpenAIModel: (config: unknown) => config,
  toAnthropicDirectModelId: (modelId: string) =>
    modelId === "anthropic/claude-haiku-4.5" ? "claude-haiku-4-5" : null,
  toProviderModelId: (modelId: string) => modelId,
}));

mock.module("@/lib/db/inference-profiles", () => ({
  INFERENCE_PROFILE_REENTER_KEY_MESSAGE: "re-enter",
  decryptInferenceProfileApiKey: () => "decrypted-key",
  getInferenceProfileByIdForUser: async (userId: string, profileId: string) => {
    lookupCalls.push({ userId, profileId });
    return profile;
  },
  recordInferenceProfileTestResult: async () => null,
}));

const { resolveInferenceProfileModelSelection } =
  await import("./profile-resolution");

const PROFILE_ID = "mw51n3rR9QQZqf6Boe42i";
const COMPOSITE_ID = `user-profile:${PROFILE_ID}:zai-glm-4.7`;

beforeEach(() => {
  lookupCalls.length = 0;
  profile = {
    id: PROFILE_ID,
    name: "ZAI (GLM)",
    provider: "openai-compatible",
    enabled: true,
    baseUrl: "https://api.z.ai/api/paas/v4",
    encryptedApiKey: "encrypted-key",
  };
});

describe("resolveInferenceProfileModelSelection user-profile option ids", () => {
  test("recovers the profile from an already-corrupt stored selection instead of routing to the gateway", async () => {
    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      // Exactly the production shape: composite model id, NULL profile id.
      inferenceProfileId: null,
      selection: { id: COMPOSITE_ID as never },
    });

    expect(lookupCalls).toEqual([{ userId: "user-1", profileId: PROFILE_ID }]);
    expect(selection.id).toBe("zai-glm-4.7" as never);
    expect(selection).toMatchObject({
      directInference: {
        provider: "openai-compatible",
        modelId: "zai-glm-4.7",
        apiKey: "decrypted-key",
        baseURL: "https://api.z.ai/api/paas/v4",
      },
      attribution: {
        inferenceRoute: "user",
        inferenceProfileId: PROFILE_ID,
        inferenceProfileName: "ZAI (GLM)",
      },
    });
  });

  test("strips the composite prefix when the caller already supplied the profile id", async () => {
    const selection = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: PROFILE_ID,
      selection: { id: COMPOSITE_ID as never },
    });

    expect(selection.id).toBe("zai-glm-4.7" as never);
    expect(selection).toMatchObject({
      directInference: { modelId: "zai-glm-4.7" },
    });
  });

  test("never emits a user-profile: id on the gateway route", async () => {
    const gateway = await resolveInferenceProfileModelSelection({
      userId: "user-1",
      inferenceProfileId: null,
      selection: { id: "openai/gpt-5.4" as never },
    });

    expect(gateway).toMatchObject({
      id: "openai/gpt-5.4",
      attribution: { inferenceRoute: "gateway", provider: "openai" },
    });
    expect(gateway.id.startsWith("user-profile:")).toBe(false);
    expect(lookupCalls).toEqual([]);
  });

  test("fails with a typed, actionable error when the composite id is malformed", async () => {
    await expect(
      resolveInferenceProfileModelSelection({
        userId: "user-1",
        inferenceProfileId: null,
        // No "<profileId>:<modelId>" separator — unparseable.
        selection: { id: "user-profile:orphaned" as never },
      }),
    ).rejects.toThrow(/Settings -> Models/);

    expect(lookupCalls).toEqual([]);
  });

  test("surfaces the profile-unavailable error rather than falling back to the gateway", async () => {
    profile = null;

    await expect(
      resolveInferenceProfileModelSelection({
        userId: "user-1",
        inferenceProfileId: null,
        selection: { id: COMPOSITE_ID as never },
      }),
    ).rejects.toThrow("unavailable");
  });
});
