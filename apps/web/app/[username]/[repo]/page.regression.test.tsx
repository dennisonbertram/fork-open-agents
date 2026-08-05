/**
 * Regression coverage for #1123.
 *
 * Opening /<username>/<repo> bootstraps a session plus its first chat from the
 * account preferences. It copied `defaultModelId` but dropped
 * `defaultInferenceProfileId`, so a user whose default is a User inference
 * model got a chat pinned to the gateway route with a model the gateway does
 * not serve.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

const preferences = {
  defaultModelId: "zai-glm-4.7",
  defaultSubagentModelId: null as string | null,
  defaultInferenceProfileId: "mw51n3rR9QQZqf6Boe42i" as string | null,
  defaultSandboxType: "vercel" as const,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
  defaultDiffMode: "unified" as const,
  autoCommitPush: false,
  autoCreatePr: false,
  alertsEnabled: true,
  alertSoundEnabled: true,
  publicUsageEnabled: false,
  globalSkillRefs: [] as unknown[],
  modelVariants: [] as unknown[],
  enabledModelIds: [] as string[],
  modelSystemPrompts: {},
};

let createCalls: Array<{
  session: Record<string, unknown>;
  initialChat: Record<string, unknown>;
}> = [];

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

mock.module("next/server", () => ({
  after: (fn: () => void) => fn,
}));

mock.module("nanoid", () => ({ nanoid: () => "generated-id" }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => preferences,
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => null,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

mock.module("@/lib/sandbox/prewarm-kick", () => ({
  kickSandboxPrewarmWorkflow: () => undefined,
}));

mock.module("@/lib/db/sessions", () => ({
  getUsedSessionTitles: async () => [],
  createSessionWithInitialChat: async (input: {
    session: Record<string, unknown>;
    initialChat: Record<string, unknown>;
  }) => {
    createCalls.push(input);
    return {
      session: { id: "session-1" },
      chat: { id: "chat-1" },
    };
  },
}));

const RepoPage = (await import("./page")).default;

beforeEach(() => {
  createCalls = [];
  preferences.defaultModelId = "zai-glm-4.7";
  preferences.defaultInferenceProfileId = "mw51n3rR9QQZqf6Boe42i";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        default_branch: "main",
        clone_url: "https://github.com/acme/widgets.git",
        full_name: "acme/widgets",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
});

async function openRepoPage() {
  await expect(
    RepoPage({
      params: Promise.resolve({ username: "acme", repo: "widgets" }),
    }),
  ).rejects.toThrow("NEXT_REDIRECT:/sessions/session-1/chats/chat-1");
}

describe("repo page session bootstrap", () => {
  test("carries the default inference profile onto the session and its first chat", async () => {
    await openRepoPage();

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.initialChat).toMatchObject({
      modelId: "zai-glm-4.7",
      inferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
    });
    expect(createCalls[0]?.session).toMatchObject({
      inferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
    });
  });

  test("leaves the profile null for a plain gateway default", async () => {
    preferences.defaultModelId = "openai/gpt-5.4";
    preferences.defaultInferenceProfileId = null;

    await openRepoPage();

    expect(createCalls[0]?.initialChat).toMatchObject({
      modelId: "openai/gpt-5.4",
      inferenceProfileId: null,
    });
  });
});
