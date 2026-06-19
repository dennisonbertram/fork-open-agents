/**
 * Regression tests for #388: proposeToolAction never wired in chat.ts agentOptions.
 *
 * BT-TA-001: When resolvedAgent for "main" has toolAuthoringEnabled=true,
 *            runAgentWorkflow passes toolAuthoringEnabled:true and a
 *            proposeToolAction into agentOptions (i.e. stepAgentOptions).
 * BT-TA-002: When resolvedAgent for "main" has toolAuthoringEnabled=false (default),
 *            proposeToolAction is NOT injected — zero behavior change for existing agents.
 * BT-TA-003: proposeToolAction closure calls createProposedToolEntry with the correct
 *            agentId, userId, toolkitSlug, createdByChatId.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// ── Spy state ──────────────────────────────────────────────────────

const writtenChunks: UIMessageChunk[] = [];
let runStatus: string = "running";

type TestResolvedChatSandboxRuntime = {
  mode: "sandbox";
  sandboxState: {
    type: "vercel";
    sandboxName: string;
    expiresAt: number;
  };
  runtimeMode: "classic" | "managed_runtime";
  workingDirectory: string;
  currentBranch: string;
  environmentDetails: string;
  skills: never[];
  didSetupWorkspace: boolean;
  sessionTitle: string;
  repoOwner?: string;
  repoName?: string;
};

function createResolvedChatSandboxRuntime(
  overrides: Partial<TestResolvedChatSandboxRuntime> = {},
): TestResolvedChatSandboxRuntime {
  return {
    mode: "sandbox",
    sandboxState: {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: Date.now() + 60_000,
    },
    runtimeMode: "classic",
    workingDirectory: "/vercel/sandbox",
    currentBranch: "main",
    environmentDetails: "test sandbox",
    skills: [],
    didSetupWorkspace: false,
    sessionTitle: "Session title",
    repoOwner: "acme",
    repoName: "repo",
    ...overrides,
  };
}

type MockResolvedAgent = {
  role: string;
  modelId: string | null;
  fromDbRow: boolean;
  instructions: string | null;
  composioToolkitSlugs: string[];
  inferenceProfileId: string | null;
  skillRefs: never[];
  builtinToolNames: null;
  composioProfileId: null;
  managedRuntimeProfileId: string | null;
  toolAuthoringEnabled: boolean;
  githubToolsEnabled: boolean;
  agentId?: string;
};

function makeSyntheticResolvedAgent(
  role: string,
  overrides: Partial<MockResolvedAgent> = {},
): MockResolvedAgent {
  return {
    role,
    modelId: "anthropic/claude-haiku-4.5",
    fromDbRow: false,
    instructions: null,
    composioToolkitSlugs: [],
    inferenceProfileId: null,
    skillRefs: [],
    builtinToolNames: null,
    composioProfileId: null,
    managedRuntimeProfileId: null,
    toolAuthoringEnabled: false,
    githubToolsEnabled: false,
    ...overrides,
  };
}

// Spy tracking the options passed to stream
let capturedStreamOptions: Record<string, unknown> | undefined;

// Spy for createProposedToolEntry
const createProposedToolEntrySpy = mock(
  async (input: {
    agentId: string;
    userId: string;
    toolkitSlug: string;
    createdByChatId: string | null;
    createdByRunId: string | null;
  }) => ({
    id: "entry-123",
    agentId: input.agentId,
    userId: input.userId,
    toolkitSlug: input.toolkitSlug,
    provider: "composio" as const,
    status: "proposed" as const,
    createdByChatId: input.createdByChatId,
    createdByRunId: input.createdByRunId,
    createdAt: new Date(),
    approvedAt: null,
  }),
);

// resolveAgentForRole spy — controlled per-test
const resolveAgentForRoleSpy = mock(async (params: { role: string }) =>
  makeSyntheticResolvedAgent(params.role),
);

// Build a minimal steps array for the agent result
function buildAgentSteps() {
  return [
    {
      stepNumber: 0,
      model: { provider: "openai", modelId: "test-model" },
      finishReason: "stop",
      rawFinishReason: "provider_stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: undefined,
      content: [{ type: "text" }],
      toolCalls: [],
      toolResults: [],
      request: { body: null },
      response: {
        id: "response-1",
        modelId: "test-model",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        headers: undefined,
        body: undefined,
        messages: [],
      },
      providerMetadata: undefined,
    },
  ];
}

// ── Module mocks ───────────────────────────────────────────────────

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_test-123" }),
  getWritable: () => {
    const writable = new WritableStream<UIMessageChunk>({
      write(chunk) {
        writtenChunks.push(chunk);
      },
    });
    return writable;
  },
}));

mock.module("workflow/api", () => ({
  getRun: () => ({
    get status() {
      return Promise.resolve(runStatus);
    },
  }),
}));

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async ({
      options,
    }: {
      messages: unknown;
      options: unknown;
      tools?: unknown;
    }) => {
      capturedStreamOptions = options as Record<string, unknown>;

      const assistantMessage = {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello!" }],
        metadata: {},
      };

      let onFinishCallback:
        | ((args: { responseMessage: unknown }) => void)
        | undefined;

      return {
        toUIMessageStream: (opts: {
          sendStart?: boolean;
          sendFinish?: boolean;
          originalMessages?: Array<Record<string, unknown>>;
          messageMetadata?: (args: {
            part: Record<string, unknown>;
          }) => unknown;
          onFinish?: (args: { responseMessage: unknown }) => void;
          onError?: (error: unknown) => string;
          generateMessageId?: () => string;
        }) => {
          onFinishCallback = opts.onFinish;
          // Plain async iterable (no yield needed — this mock only drives the
          // onFinish side-effect; it does not stream any chunks).
          return {
            [Symbol.asyncIterator](): AsyncIterator<never> {
              let called = false;
              return {
                async next() {
                  if (!called) {
                    called = true;
                    if (onFinishCallback) {
                      onFinishCallback({ responseMessage: assistantMessage });
                    }
                  }
                  return { done: true as const, value: undefined as never };
                },
              };
            },
          };
        },
        totalUsage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        }),
        finishReason: Promise.resolve("stop"),
        rawFinishReason: Promise.resolve("provider_stop"),
        response: Promise.resolve({
          id: "response-1",
          modelId: "test-model",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          messages: [],
        }),
        steps: Promise.resolve(buildAgentSteps()),
      };
    },
  },
}));

mock.module("@/lib/agents/resolve-agent", () => ({
  resolveAgentForRole: resolveAgentForRoleSpy,
}));

mock.module("@/lib/db/agent-tool-entries", () => ({
  createProposedToolEntry: createProposedToolEntrySpy,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => ({
    id: "chat-1",
    sessionId: "session-1",
    modelId: null,
    inferenceProfileId: null,
  }),
  getSessionById: async () => ({
    id: "session-1",
    userId: "user-1",
    inferenceProfileId: null,
    autoCommitPushOverride: null,
    autoCreatePrOverride: null,
    repoOwner: null,
    repoName: null,
  }),
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-opus-4.6",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: false,
    alertSoundEnabled: false,
    publicUsageEnabled: false,
    globalSkillRefs: [],
    modelVariants: [],
    enabledModelIds: [],
  }),
}));

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: async () => undefined,
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async () => null,
}));

mock.module("@/lib/composio/session", () => ({
  resolveComposioToolsForChat: async () => ({ status: "off" as const }),
}));

mock.module("@/lib/github/tools", () => ({
  resolveGitHubToolsForChat: async () => ({
    status: "off" as const,
    reason: "not_enabled" as const,
  }),
}));

mock.module("./chat-sandbox-runtime", () => ({
  resolveChatSandboxRuntime: async (params: { assistantId: string }) => {
    writtenChunks.push({ type: "start", messageId: params.assistantId });
    return createResolvedChatSandboxRuntime();
  },
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: async () => [],
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: async () => [],
}));

mock.module("@/lib/workflows/goal-ledger-recorder", () => ({
  recordGoalLedgerStart: async () => "goal-test-abc123",
  recordGoalLedgerEvent: async () => undefined,
  recordGoalLedgerClose: async () => undefined,
}));

mock.module("@/lib/workflows/goal-validation", () => ({
  validateGoalCompletion: () => ({ ok: true }),
}));

mock.module("./chat-post-finish", () => ({
  persistUserMessage: async () => undefined,
  persistAssistantMessageWithToolResults: async () => undefined,
  persistAssistantMessage: async () => undefined,
  persistSandboxState: async () => undefined,
  claimActiveStream: async () => "claimed",
  closeStream: async (writable: WritableStream<UIMessageChunk>) =>
    writable.close(),
  clearActiveStream: async () => undefined,
  sendFinish: async (writable: WritableStream<UIMessageChunk>) => {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "finish", finishReason: "stop" });
    } finally {
      writer.releaseLock();
    }
  },
  recordWorkflowUsage: async () => undefined,
  refreshDiffCache: async () => undefined,
  refreshLifecycleActivity: async () => undefined,
  hasAutoCommitChangesStep: async () => false,
  runAutoCommitStep: async () => ({ committed: false, pushed: false }),
  runAutoCreatePrStep: async () => ({
    created: false,
    syncedExisting: false,
    skipped: true,
    prNumber: null,
    prUrl: null,
  }),
}));

mock.module("ai", () => ({
  generateId: () => "gen-id-1",
  convertToModelMessages: async (msgs: Array<Record<string, unknown>>) =>
    msgs.map((message) => ({
      role: message.role,
      content: Array.isArray(message.parts)
        ? message.parts
            .filter(
              (p): p is { type: string; text: string } =>
                typeof p === "object" &&
                p !== null &&
                "type" in p &&
                (p as { type: unknown }).type === "text",
            )
            .map((p) => ({ type: "text", text: p.text }))
        : [],
    })),
  isToolUIPart: (part: { type: string }) =>
    part.type === "tool-invocation" || part.type.startsWith("tool-"),
  pruneMessages: ({ messages }: { messages: Array<Record<string, unknown>> }) =>
    messages,
}));

mock.module("@open-agents/agent", () => ({
  toAnthropicDirectModelId: (modelId: string) =>
    modelId.startsWith("anthropic/")
      ? modelId.slice("anthropic/".length).replaceAll(".", "-")
      : null,
}));

// Import after all mocks are set up
const { runAgentWorkflow } = await import("./chat");

function makeOptions(overrides?: Record<string, unknown>) {
  return {
    messages: [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text", text: "Hello" }],
      },
    ],
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    requestUrl: "http://localhost/api/chat",
    authSession: {
      authProvider: "vercel" as const,
      user: {
        id: "user-1",
        username: "user",
        email: "user@example.com",
        avatar: "",
      },
    },
    selectedModelId: "gpt-4",
    modelId: "gpt-4",
    agentOptions: {},
    maxSteps: 1,
    ...overrides,
  } as Parameters<typeof runAgentWorkflow>[0];
}

// ── Tests ──────────────────────────────────────────────────────────

describe("tool authoring wiring in chat.ts (#388)", () => {
  beforeEach(() => {
    writtenChunks.length = 0;
    capturedStreamOptions = undefined;
    resolveAgentForRoleSpy.mockReset();
    createProposedToolEntrySpy.mockReset();
    // Default: all roles return synthetic (toolAuthoringEnabled=false)
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) =>
        makeSyntheticResolvedAgent(params.role),
    );
    createProposedToolEntrySpy.mockResolvedValue({
      id: "entry-123",
      agentId: "agent-main-1",
      userId: "user-1",
      toolkitSlug: "github",
      provider: "composio" as const,
      status: "proposed" as const,
      createdByChatId: "chat-1",
      createdByRunId: null,
      createdAt: new Date(),
      approvedAt: null,
    });
  });

  // BT-TA-001: main agent toolAuthoringEnabled=true → proposeToolAction injected
  test("BT-TA-001: toolAuthoringEnabled=true on main agent threads proposeToolAction into agentOptions", async () => {
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "main") {
          return makeSyntheticResolvedAgent("main", {
            fromDbRow: true,
            toolAuthoringEnabled: true,
            agentId: "agent-main-1",
          });
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    // toolAuthoringEnabled must be true in the options passed to stream
    expect(capturedStreamOptions?.toolAuthoringEnabled).toBe(true);
    // proposeToolAction must be a function
    expect(typeof capturedStreamOptions?.proposeToolAction).toBe("function");
  });

  // BT-TA-002: default (toolAuthoringEnabled=false) → proposeToolAction NOT injected
  test("BT-TA-002: regression — default agent (toolAuthoringEnabled=false) does NOT get proposeToolAction", async () => {
    // Default mock: all agents have toolAuthoringEnabled=false
    await runAgentWorkflow(makeOptions());

    // proposeToolAction must NOT be present when authoring is off
    expect(capturedStreamOptions?.proposeToolAction).toBeUndefined();
    // toolAuthoringEnabled may be absent or false — must not be true
    expect(capturedStreamOptions?.toolAuthoringEnabled).not.toBe(true);
  });

  // BT-TA-003: proposeToolAction closure calls createProposedToolEntry correctly
  test("BT-TA-003: proposeToolAction closure persists entry via createProposedToolEntry", async () => {
    const agentId = "agent-main-xyz";
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "main") {
          return makeSyntheticResolvedAgent("main", {
            fromDbRow: true,
            toolAuthoringEnabled: true,
            agentId,
          });
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    // Invoke the captured proposeToolAction closure directly
    const proposeToolAction = capturedStreamOptions?.proposeToolAction as
      | ((input: { toolkitSlug: string }) => Promise<{ entryId: string }>)
      | undefined;
    expect(typeof proposeToolAction).toBe("function");

    const result = await proposeToolAction!({ toolkitSlug: "github" });
    expect(result.entryId).toBeDefined();

    // Verify createProposedToolEntry was called with correct attribution
    expect(createProposedToolEntrySpy).toHaveBeenCalledTimes(1);
    const callArgs = createProposedToolEntrySpy.mock.calls[0]?.[0] as {
      agentId: string;
      userId: string;
      toolkitSlug: string;
      createdByChatId: string | null;
      createdByRunId: string | null;
    };
    expect(callArgs.toolkitSlug).toBe("github");
    expect(callArgs.userId).toBe("user-1");
    expect(callArgs.createdByChatId).toBe("chat-1");
    expect(callArgs.createdByRunId).toBeNull();
  });
});
