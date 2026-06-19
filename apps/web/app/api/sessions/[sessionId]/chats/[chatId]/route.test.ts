import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type ChatComposioSelection,
  defaultChatComposioSelection,
} from "@/lib/composio/types";

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: {
        id: string;
        repoOwner: string | null;
        repoName: string | null;
      };
      chat: {
        id: string;
        sessionId: string;
        modelId: string;
        inferenceProfileId: string | null;
        composioSelection: ChatComposioSelection;
        activeStreamId: string | null;
      };
    }
  | {
      ok: false;
      response: Response;
    };

type ChatMessageRecord = {
  id: string;
  parts: Array<{ type: string; text?: string }>;
};

type ChatRecord = {
  id: string;
  sessionId: string;
  title: string;
  modelId: string;
  inferenceProfileId: string | null;
  composioSelection: ChatComposioSelection;
};

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionChatResult: OwnedSessionChatResult = {
  ok: true,
  sessionRecord: { id: "session-1", repoOwner: null, repoName: null },
  chat: {
    id: "chat-1",
    sessionId: "session-1",
    modelId: "model-1",
    inferenceProfileId: null,
    composioSelection: defaultChatComposioSelection,
    activeStreamId: null,
  },
};
let currentSession: {
  authProvider?: "vercel" | "github";
  user: { id: string; email?: string; username?: string; avatar?: string };
} | null = {
  user: { id: "user-1" },
};
let chatMessages: ChatMessageRecord[] = [
  {
    id: "message-1",
    parts: [{ type: "text", text: "Hello" }],
  },
];

let updatedChat: ChatRecord | null = {
  id: "chat-1",
  sessionId: "session-1",
  title: "Updated",
  modelId: "model-updated",
  inferenceProfileId: null,
  composioSelection: { mainProfileId: "profile-updated" },
};
let inferenceProfile: {
  id: string;
  userId: string;
  enabled: boolean;
  provider: "anthropic";
  models: Array<{ id: string; displayName: string }>;
} | null = {
  id: "inference-profile-1",
  userId: "user-1",
  enabled: true,
  provider: "anthropic",
  models: [{ id: "glm-4.6", displayName: "GLM-4.6" }],
};
let chatsInSession: Array<{ id: string }> = [
  { id: "chat-1" },
  { id: "chat-2" },
];
let composioPolicy = { allowed: true, reason: null as string | null };

const updateChatCalls: Array<{
  chatId: string;
  patch: {
    title?: string;
    modelId?: string;
    inferenceProfileId?: string | null;
    composioSelection?: ChatComposioSelection;
  };
}> = [];
const deleteChatCalls: string[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSession: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
  requireOwnedSessionChat: async () => ownedSessionChatResult,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatSummariesBySessionId: async () => [],
  getChatById: async () => null,
  createChat: async () => null,
  createSessionWithInitialChat: async () => null,
  getArchivedSessionCountByUserId: async () => 0,
  getSessionById: async () => null,
  getSessionsWithUnreadByUserId: async () => [],
  getUsedSessionTitles: async () => new Set<string>(),
  updateSession: async () => null,
  updateChat: async (
    chatId: string,
    patch: {
      title?: string;
      modelId?: string;
      inferenceProfileId?: string | null;
      composioSelection?: ChatComposioSelection;
    },
  ) => {
    updateChatCalls.push({ chatId, patch });
    return updatedChat;
  },
  getChatMessages: async () => chatMessages,
  getChatsBySessionId: async () => chatsInSession,
  deleteChat: async (chatId: string) => {
    deleteChatCalls.push(chatId);
  },
}));

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: async (_userId: string, _profileId: string) =>
    inferenceProfile,
}));

mock.module("@/lib/db/composio", () => ({
  listComposioToolProfiles: async () => [],
  listComposioProfileOptionsForRepository: async () => ({
    profiles: [],
    profileOptions: [],
    repositorySettings: null,
  }),
  getComposioAgentDefaults: async () => ({}),
  createComposioToolProfile: async () => ({}),
  updateComposioAgentDefaults: async () => ({}),
  updateComposioToolProfile: async () => ({}),
  deleteComposioToolProfile: async () => true,
  getRepositoryComposioSettings: async () => null,
  upsertRepositoryComposioSettings: async () => ({}),
  isComposioProfileAllowedForRepository: async () => composioPolicy,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "model-default",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [],
    modelVariants: [],
    enabledModelIds: [],
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

function createGetRequest(): Request {
  return new Request("http://localhost/api/sessions/session-1/chats/chat-1");
}

function createPatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions/[sessionId]/chats/[chatId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1", repoOwner: null, repoName: null },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        inferenceProfileId: null,
        composioSelection: defaultChatComposioSelection,
        activeStreamId: null,
      },
    };
    currentSession = { user: { id: "user-1" } };
    chatMessages = [
      {
        id: "message-1",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    updatedChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Updated",
      modelId: "model-updated",
      inferenceProfileId: null,
      composioSelection: { mainProfileId: "profile-updated" },
    };
    inferenceProfile = {
      id: "inference-profile-1",
      userId: "user-1",
      enabled: true,
      provider: "anthropic",
      models: [{ id: "glm-4.6", displayName: "GLM-4.6" }],
    };
    chatsInSession = [{ id: "chat-1" }, { id: "chat-2" }];
    composioPolicy = { allowed: true, reason: null };
    updateChatCalls.length = 0;
    deleteChatCalls.length = 0;
  });

  test("GET returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(createGetRequest(), createContext());

    expect(response.status).toBe(401);
  });

  test("GET returns the latest chat snapshot", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1", repoOwner: null, repoName: null },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        inferenceProfileId: "inference-profile-1",
        composioSelection: { mainProfileId: "profile-1" },
        activeStreamId: "stream-1",
      },
    };
    chatMessages = [
      {
        id: "message-1",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "message-2",
        parts: [{ type: "text", text: "World" }],
      },
    ];
    const { GET } = await routeModulePromise;

    const response = await GET(createGetRequest(), createContext());
    const body = (await response.json()) as {
      chat: {
        id: string;
        modelId: string;
        inferenceProfileId: string | null;
        composioSelection: ChatComposioSelection;
        activeStreamId: string | null;
      };
      isStreaming: boolean;
      messages: ChatMessageRecord["parts"][];
    };

    expect(response.status).toBe(200);
    expect(body.chat).toEqual({
      id: "chat-1",
      modelId: "model-1",
      inferenceProfileId: "inference-profile-1",
      composioSelection: { mainProfileId: "profile-1" },
      activeStreamId: "stream-1",
    });
    expect(body.isStreaming).toBe(true);
    expect(body.messages).toEqual(chatMessages.map((message) => message.parts));
  });

  test("PATCH returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "x" }),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH returns ownership error from guard", async () => {
    ownedSessionChatResult = {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "x" }),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH returns 400 for invalid JSON", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  test("PATCH returns 400 when neither title nor modelId is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "   " }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("At least one field is required");
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH trims fields and updates chat", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "  New title  ", modelId: "  model-2  " }),
      createContext(),
    );
    const body = (await response.json()) as { chat: ChatRecord };

    expect(response.status).toBe(200);
    expect(updateChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: { title: "New title", modelId: "model-2" },
      },
    ]);
    expect(body.chat.id).toBe("chat-1");
  });

  test("PATCH persists user inference profile separately from model id", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        modelId: "anthropic/claude-opus-4.6",
        inferenceProfileId: "inference-profile-1",
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: {
          modelId: "anthropic/claude-opus-4.6",
          inferenceProfileId: "inference-profile-1",
        },
      },
    ]);
  });

  test("PATCH rejects a model the inference profile does not serve", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        modelId: "openai/gpt-5.4",
        inferenceProfileId: "inference-profile-1",
      }),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH accepts a discovered model served by the inference profile", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        modelId: "glm-4.6",
        inferenceProfileId: "inference-profile-1",
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: {
          modelId: "glm-4.6",
          inferenceProfileId: "inference-profile-1",
        },
      },
    ]);
  });

  test("PATCH persists Composio chat selection", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        composioSelection: {
          mainProfileId: "profile-1",
          agentProfileOverrides: {
            executor: "profile-2",
            explorer: null,
          },
        },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: {
          composioSelection: {
            mainProfileId: "profile-1",
            agentProfileOverrides: {
              executor: "profile-2",
              explorer: null,
            },
          },
        },
      },
    ]);
  });

  test("PATCH rejects Composio profiles blocked by repo policy", async () => {
    composioPolicy = {
      allowed: false,
      reason: "Blocked by repository policy.",
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        composioSelection: {
          mainProfileId: "profile-1",
        },
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Blocked by repository policy.");
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH returns 404 when updateChat returns null", async () => {
    updatedChat = null;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "New" }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Chat not found");
  });

  test("DELETE returns 400 when attempting to delete the only chat", async () => {
    chatsInSession = [{ id: "chat-1" }];
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "DELETE",
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Cannot delete the only chat in a session");
    expect(deleteChatCalls).toHaveLength(0);
  });

  test("DELETE removes chat when more than one chat exists", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "DELETE",
      }),
      createContext(),
    );
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteChatCalls).toEqual(["chat-1"]);
  });
});
