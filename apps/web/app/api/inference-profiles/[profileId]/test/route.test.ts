import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type TestProfile = {
  id: string;
  name: string;
  provider: "anthropic" | "openai-compatible";
  enabled: boolean;
  baseUrl: string | null;
};

const generateTextCalls: Array<{ model: unknown; prompt: string }> = [];
const setModelsCalls: Array<{
  userId: string;
  profileId: string;
  models: unknown[];
}> = [];
const recordResultCalls: Array<{
  userId: string;
  profileId: string;
  result: unknown;
}> = [];
const fetchModelsCalls: Array<{
  provider?: string;
  baseUrl: string | null;
  apiKey: string;
}> = [];

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};
let profile: TestProfile | null = null;
let fetchedModels: Array<{ id: string; displayName: string }> = [];
let decryptError: Error | null = null;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () =>
    currentSession?.user
      ? { ok: true, userId: currentSession.user.id }
      : {
          ok: false,
          response: Response.json(
            { error: "Not authenticated" },
            { status: 401 },
          ),
        },
}));

mock.module("ai", () => ({
  generateText: async (input: { model: unknown; prompt: string }) => {
    generateTextCalls.push(input);
    return { text: "OK" };
  },
}));

mock.module("@open-agents/agent", () => ({
  directAnthropicModel: (config: unknown) => ({
    kind: "anthropic-model",
    config,
  }),
  directOpenAIModel: (config: unknown) => ({
    kind: "openai-model",
    config,
  }),
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
  getInferenceProfileByIdForUser: async (_userId: string, profileId: string) =>
    profile?.id === profileId ? profile : null,
  recordInferenceProfileTestResult: async (
    userId: string,
    profileId: string,
    result: unknown,
  ) => {
    recordResultCalls.push({ userId, profileId, result });
    return profile
      ? {
          ...profile,
          status:
            typeof result === "object" &&
            result !== null &&
            "status" in result &&
            result.status === "passed"
              ? "verified"
              : "failed",
        }
      : null;
  },
  setInferenceProfileModels: async (
    userId: string,
    profileId: string,
    models: unknown[],
  ) => {
    setModelsCalls.push({ userId, profileId, models });
    return profile ? { ...profile, models } : null;
  },
}));

mock.module("@/lib/inference/fetch-profile-models", () => ({
  fetchInferenceProfileModels: async (params: {
    provider?: string;
    baseUrl: string | null;
    apiKey: string;
  }) => {
    fetchModelsCalls.push(params);
    return fetchedModels;
  },
}));

mock.module("@/lib/inference/model-routing", () => ({
  toInferenceProfileTestMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Failed to test profile.",
}));

const routeModulePromise = import("./route");

function routeContext(profileId = "profile-openai") {
  return {
    params: Promise.resolve({ profileId }),
  };
}

function postRequest(body: unknown = {}) {
  return new Request(
    "http://localhost/api/inference-profiles/profile-openai/test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("/api/inference-profiles/[profileId]/test", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    profile = {
      id: "profile-openai",
      name: "Local Gateway",
      provider: "openai-compatible",
      enabled: true,
      baseUrl: "https://llm.example.com/v1",
    };
    fetchedModels = [
      { id: "gpt-4o-mini", displayName: "gpt-4o-mini" },
      { id: "custom/reasoner", displayName: "Custom Reasoner" },
    ];
    decryptError = null;
    generateTextCalls.length = 0;
    setModelsCalls.length = 0;
    recordResultCalls.length = 0;
    fetchModelsCalls.length = 0;
  });

  test("tests an OpenAI-compatible profile and saves discovered models", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(postRequest(), routeContext());
    const body = (await response.json()) as {
      result: { status: string; message: string };
    };

    expect(response.status).toBe(200);
    expect(fetchModelsCalls).toEqual([
      {
        provider: "openai-compatible",
        baseUrl: "https://llm.example.com/v1",
        apiKey: "decrypted-key",
      },
    ]);
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]?.model).toEqual({
      kind: "openai-model",
      config: {
        provider: "openai-compatible",
        modelId: "gpt-4o-mini",
        apiKey: "decrypted-key",
        baseURL: "https://llm.example.com/v1",
      },
    });
    expect(setModelsCalls).toEqual([
      {
        userId: "user-1",
        profileId: "profile-openai",
        models: fetchedModels,
      },
    ]);
    expect(recordResultCalls[0]).toMatchObject({
      userId: "user-1",
      profileId: "profile-openai",
      result: {
        status: "passed",
        message: "Profile test passed. Discovered 2 models.",
      },
    });
    expect(body.result).toEqual({
      status: "passed",
      message: "Profile test passed. Discovered 2 models.",
    });
  });

  test("records a failed profile result when the saved key cannot be decrypted", async () => {
    const { POST } = await routeModulePromise;
    decryptError = Object.assign(
      new Error(
        'The saved API key for inference profile "Local Gateway" can\'t be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.',
      ),
      { name: "InferenceProfileResolutionError" },
    );

    const response = await POST(postRequest(), routeContext());
    const body = (await response.json()) as {
      result: { status: string; message: string };
    };

    expect(response.status).toBe(200);
    expect(fetchModelsCalls).toEqual([]);
    expect(generateTextCalls).toEqual([]);
    expect(recordResultCalls).toEqual([
      {
        userId: "user-1",
        profileId: "profile-openai",
        result: {
          status: "failed",
          message:
            "This saved API key can no longer be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.",
        },
      },
    ]);
    expect(body.result).toEqual({
      status: "failed",
      message:
        "This saved API key can no longer be decrypted in this environment. Re-enter the API key in Settings -> Models, save the profile, and try again.",
    });
  });
});
