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
  managedRuntime?: {
    profileId?: string;
    profileVersion?: string;
    profileDisplayName?: string;
    profileRunId?: string;
    sandboxName?: string;
  };
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

const spies = {
  persistUserMessage: mock(() => Promise.resolve()),
  persistAssistantMessageWithToolResults: mock(() => Promise.resolve()),
  persistAssistantMessage: mock((_chatId?: unknown, _message?: unknown) =>
    Promise.resolve(),
  ),
  persistSandboxState: mock((_sessionId?: unknown, _sandboxState?: unknown) =>
    Promise.resolve(),
  ),
  resolveChatSandboxRuntime: mock((params: { assistantId: string }) => {
    writtenChunks.push({ type: "start", messageId: params.assistantId });
    return Promise.resolve(createResolvedChatSandboxRuntime());
  }),
  claimActiveStream: mock(() => Promise.resolve("claimed")),
  closeStream: mock((writable: WritableStream<UIMessageChunk>) =>
    writable.close(),
  ),
  clearActiveStream: mock((_chatId?: unknown, _workflowRunId?: unknown) =>
    Promise.resolve(),
  ),
  sendFinish: mock(async (writable: WritableStream<UIMessageChunk>) => {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "finish", finishReason: "stop" });
    } finally {
      writer.releaseLock();
    }
  }),
  recordWorkflowUsage: mock(() => Promise.resolve()),
  refreshDiffCache: mock((_sessionId?: unknown, _sandboxState?: unknown) =>
    Promise.resolve(),
  ),
  refreshLifecycleActivity: mock(() => Promise.resolve()),
  hasAutoCommitChangesStep: mock(() => Promise.resolve(true)),
  runAutoCommitStep: mock(() =>
    Promise.resolve({ committed: false, pushed: false }),
  ),
  runAutoCreatePrStep: mock(() =>
    Promise.resolve({
      created: true,
      syncedExisting: false,
      skipped: false,
      prNumber: 42,
      prUrl: "https://github.com/acme/repo/pull/42",
    }),
  ),
  emitSessionEvent: mock(() => Promise.resolve(null)),
  resolveComposioToolsForChat: mock(
    async (): Promise<unknown> => ({ status: "off" as const }),
  ),
  resolveGitHubToolsForChat: mock(
    async (): Promise<unknown> => ({
      status: "off" as const,
      reason: "not_enabled" as const,
    }),
  ),
  listManagedServices: mock(async (): Promise<unknown[]> => []),
  listManagedBrowserRuns: mock(async (): Promise<unknown[]> => []),
  recordGoalLedgerStart: mock(() => Promise.resolve("goal-test-abc123")),
  recordGoalLedgerEvent: mock(() => Promise.resolve()),
  recordGoalLedgerClose: mock(() => Promise.resolve()),
};

let testSessionRecord: {
  id: string;
  userId: string;
  inferenceProfileId: string | null;
  autoCommitPushOverride: boolean | null;
  autoCreatePrOverride: boolean | null;
  repoOwner: string | null;
  repoName: string | null;
};
let testChatRecord: {
  id: string;
  sessionId: string;
  modelId: string | null;
  inferenceProfileId: string | null;
};
let testPreferences: {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  defaultInferenceProfileId: string | null;
  defaultSandboxType: "vercel";
  defaultDiffMode: "unified";
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  alertsEnabled: boolean;
  alertSoundEnabled: boolean;
  publicUsageEnabled: boolean;
  globalSkillRefs: never[];
  modelVariants: never[];
  enabledModelIds: string[];
};

// Track what the agent stream yields
let agentStreamParts: Array<Record<string, unknown>> = [];
let agentAssistantParts: Array<Record<string, unknown>> | undefined;
let agentFinishReason = "stop";
let agentRawFinishReason: string | undefined = "provider_stop";
let agentTotalUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
let agentResponseMessages: unknown[] = [];
let agentResponse: Record<string, unknown> = {
  messages: agentResponseMessages,
};
let streamOnFinishCallback:
  | ((args: { responseMessage: unknown }) => void)
  | undefined;
let agentWarnings: unknown[] | undefined;
let agentRequestBody: unknown;
let agentResponseHeaders: Record<string, string> | undefined;
let agentResponseBody: unknown;
let agentProviderMetadata: Record<string, unknown> | undefined;
let agentInputMessages: unknown;
let agentStreamOptions: unknown;
let agentStreamTools: unknown;
let agentStreamError: Error | undefined;

function buildAgentSteps() {
  return [
    {
      stepNumber: 0,
      model: {
        provider: "openai",
        modelId:
          typeof agentResponse.modelId === "string"
            ? agentResponse.modelId
            : "test-model",
      },
      finishReason: agentFinishReason,
      rawFinishReason: agentRawFinishReason,
      usage: agentTotalUsage,
      warnings: agentWarnings,
      content: [{ type: "text" }],
      toolCalls: [],
      toolResults: [],
      request: { body: agentRequestBody },
      response: {
        id:
          typeof agentResponse.id === "string"
            ? agentResponse.id
            : "response-1",
        modelId:
          typeof agentResponse.modelId === "string"
            ? agentResponse.modelId
            : "test-model",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        headers: agentResponseHeaders,
        body: agentResponseBody,
        messages: agentResponseMessages,
      },
      providerMetadata: agentProviderMetadata,
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

mock.module("./chat-post-finish", () => spies);

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async ({
      messages,
      options,
      tools,
    }: {
      messages: unknown;
      options: unknown;
      tools?: unknown;
    }) => {
      agentInputMessages = messages;
      agentStreamOptions = options;
      agentStreamTools = tools;
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
        }) => {
          const priorAssistantMessage = opts.originalMessages?.at(-1);
          const assistantMessage = (
            priorAssistantMessage?.role === "assistant"
              ? structuredClone(priorAssistantMessage)
              : {
                  id: "assistant-1",
                  role: "assistant",
                  parts: agentAssistantParts ?? [
                    { type: "text", text: "Hello!" },
                  ],
                  metadata: {},
                }
          ) as {
            id: string;
            role: "assistant";
            parts: Array<Record<string, unknown>>;
            metadata?: unknown;
          };

          streamOnFinishCallback = opts.onFinish;
          // Return an async iterable that yields parts and calls onFinish
          return {
            async *[Symbol.asyncIterator]() {
              if (agentStreamError) {
                opts.onError?.(agentStreamError);
                throw new Error(
                  "No output generated. Check the stream for errors.",
                );
              }
              for (const part of agentStreamParts) {
                yield part;

                const metadata = opts.messageMetadata?.({ part });
                if (metadata) {
                  assistantMessage.metadata = Object.assign(
                    {},
                    assistantMessage.metadata as
                      | Record<string, unknown>
                      | undefined,
                    metadata as Record<string, unknown>,
                  );
                  yield {
                    type: "message-metadata",
                    messageMetadata: metadata,
                  };
                }
              }
              if (streamOnFinishCallback) {
                streamOnFinishCallback({
                  responseMessage: assistantMessage,
                });
              }
            },
          };
        },
        totalUsage: Promise.resolve(agentTotalUsage),
        finishReason: Promise.resolve(agentFinishReason),
        rawFinishReason: Promise.resolve(agentRawFinishReason),
        response: Promise.resolve(agentResponse),
        steps: Promise.resolve(buildAgentSteps()),
      };
    },
  },
}));

mock.module("ai", () => ({
  convertToModelMessages: async (
    msgs: Array<Record<string, unknown>>,
    options?: { convertDataPart?: (part: Record<string, unknown>) => unknown },
  ) =>
    msgs.map((message) => {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const content = parts.flatMap((part) => {
        if (typeof part !== "object" || part === null) {
          return [];
        }

        if (part.type === "text" && typeof part.text === "string") {
          return [{ type: "text", text: part.text }];
        }

        if (
          typeof part.type === "string" &&
          part.type.startsWith("data-") &&
          options?.convertDataPart
        ) {
          const convertedPart = options.convertDataPart(
            part as Record<string, unknown>,
          );
          return convertedPart === undefined ? [] : [convertedPart];
        }

        return [];
      });

      return {
        role: message.role,
        content,
      };
    }),
  generateId: () => "gen-id-1",
  isToolUIPart: (part: { type: string }) =>
    part.type === "tool-invocation" || part.type.startsWith("tool-"),
  pruneMessages: ({ messages }: { messages: Array<Record<string, unknown>> }) =>
    messages.filter((message) => {
      const content = message.content;
      return !Array.isArray(content) || content.length > 0;
    }),
}));

mock.module("@open-agents/agent", () => ({
  toAnthropicDirectModelId: (modelId: string) =>
    modelId.startsWith("anthropic/")
      ? modelId.slice("anthropic/".length).replaceAll(".", "-")
      : null,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => testChatRecord,
  getSessionById: async () => testSessionRecord,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => testPreferences,
}));

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: async (
    _userId: string,
    profileId: string,
  ) => ({
    id: profileId,
    name: "Personal Anthropic",
    provider: "anthropic",
    enabled: true,
  }),
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: spies.emitSessionEvent,
}));

mock.module("@/lib/composio/session", () => ({
  resolveComposioToolsForChat: spies.resolveComposioToolsForChat,
}));

mock.module("@/lib/github/tools", () => ({
  resolveGitHubToolsForChat: spies.resolveGitHubToolsForChat,
}));

mock.module("./chat-sandbox-runtime", () => ({
  resolveChatSandboxRuntime: spies.resolveChatSandboxRuntime,
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: spies.listManagedServices,
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: spies.listManagedBrowserRuns,
}));

mock.module("@/lib/workflows/goal-ledger-recorder", () => ({
  recordGoalLedgerStart: spies.recordGoalLedgerStart,
  recordGoalLedgerEvent: spies.recordGoalLedgerEvent,
  recordGoalLedgerClose: spies.recordGoalLedgerClose,
}));

// Mock the goal-validation module so integration tests can control its output.
// The spy delegates to the real implementation by default, so it does not
// interfere with goal-validation.test.ts which tests the real module directly.
// Individual tests can override goalValidationResult to force a failure.
let goalValidationResult: {
  ok: boolean;
  code?: string;
  reason?: string;
} | null = null;

const validateGoalCompletionSpy = mock(
  (input: {
    status: string;
    evidenceRefs: readonly string[];
    requireEvidence: boolean;
  }): { ok: boolean; code?: string; reason?: string } => {
    if (goalValidationResult !== null) {
      return goalValidationResult;
    }
    // Default: complete + requireEvidence=false → ok (production behavior)
    if (
      input.status === "complete" &&
      input.requireEvidence &&
      input.evidenceRefs.length === 0
    ) {
      return {
        ok: false,
        code: "missing_required_evidence",
        reason: "A complete goal requires at least one evidence ref.",
      };
    }
    return { ok: true };
  },
);

mock.module("@/lib/workflows/goal-validation", () => ({
  validateGoalCompletion: validateGoalCompletionSpy,
}));

// ── Subagent roster mock ────────────────────────────────────────────
// Controls what resolveAgentForRole returns for each role.
// Default: synthetic fallback shape (fromDbRow: false, modelId from prefs,
// no instructions, no slugs) — mirrors production when zero agent rows exist.
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
};

function makeSyntheticResolvedAgent(
  role: string,
  modelId = "anthropic/claude-haiku-4.5",
): MockResolvedAgent {
  return {
    role,
    modelId,
    fromDbRow: false,
    instructions: null,
    composioToolkitSlugs: [],
    inferenceProfileId: null,
    skillRefs: [],
    builtinToolNames: null,
    composioProfileId: null,
    managedRuntimeProfileId: null,
    toolAuthoringEnabled: false,
  };
}

// The spy is the single mock implementation; individual tests can override it.
const resolveAgentForRoleSpy = mock(async (params: { role: string }) =>
  makeSyntheticResolvedAgent(params.role),
);

mock.module("@/lib/agents/resolve-agent", () => ({
  resolveAgentForRole: resolveAgentForRoleSpy,
}));

const { runAgentWorkflow } = await import("./chat");

// ── Helpers ────────────────────────────────────────────────────────

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

function managedWorkerTaskPart(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool-task",
    toolCallId: "task-1",
    state: "output-available",
    preliminary: false,
    input: {
      subagentType: "executor",
      task: "Implement a small UI change",
    },
    output: {
      final: [],
      toolCallCount: 3,
      runtime: {
        mode: "managed_runtime",
        label: "Managed runtime worker",
        workerType: "executor",
        profileId: "web-bun-agent-browser",
        profileVersion: "2026-05-23.1",
        profileDisplayName: "Web app with Bun and browser checks",
        profileRunId: "profile-run-1",
        sandboxName: "session_session-1",
      },
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  writtenChunks.length = 0;
  runStatus = "running";
  agentStreamParts = [{ type: "text-delta", textDelta: "Hi" }];
  agentAssistantParts = undefined;
  agentFinishReason = "stop";
  agentRawFinishReason = "provider_stop";
  agentTotalUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  agentResponseMessages = [];
  agentResponse = { messages: agentResponseMessages };
  agentWarnings = undefined;
  agentRequestBody = undefined;
  agentResponseHeaders = undefined;
  agentResponseBody = undefined;
  agentProviderMetadata = undefined;
  agentInputMessages = undefined;
  agentStreamOptions = undefined;
  agentStreamTools = undefined;
  agentStreamError = undefined;
  streamOnFinishCallback = undefined;
  testSessionRecord = {
    id: "session-1",
    userId: "user-1",
    inferenceProfileId: null,
    autoCommitPushOverride: null,
    autoCreatePrOverride: null,
    repoOwner: "acme",
    repoName: "repo",
  };
  testChatRecord = {
    id: "chat-1",
    sessionId: "session-1",
    modelId: null,
    inferenceProfileId: null,
  };
  testPreferences = {
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: null,
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
  };
  Object.values(spies).forEach((s) => s.mockClear());
  // Reset recorder spies to their default successful implementations.
  spies.recordGoalLedgerStart.mockResolvedValue("goal-test-abc123");
  spies.recordGoalLedgerEvent.mockResolvedValue(undefined);
  spies.recordGoalLedgerClose.mockResolvedValue(undefined);
  // Reset goal-validation spy and result (null = use real logic in spy).
  goalValidationResult = null;
  validateGoalCompletionSpy.mockClear();
  // Reset resolveAgentForRole to synthetic fallback (no DB rows) for each test.
  resolveAgentForRoleSpy.mockImplementation(async (params: { role: string }) =>
    makeSyntheticResolvedAgent(params.role),
  );
});

describe("runAgentWorkflow", () => {
  test("keeps database-backed modules behind step-local imports", async () => {
    const source = await Bun.file(new URL("chat.ts", import.meta.url)).text();

    expect(source).not.toContain(
      'import { emitSessionEvent } from "@/lib/observability/events";',
    );
    expect(source).not.toContain(
      'import { getChatById, getSessionById } from "@/lib/db/sessions";',
    );
    expect(source).not.toContain(
      'import { getUserPreferences } from "@/lib/db/user-preferences";',
    );
    expect(source).toContain("async function emitWorkflowSessionEvent");
  });

  test("regression: goal-ledger-recorder is behind a dynamic import in chat.ts", async () => {
    // If someone refactors the recorder call to a top-level import, it would
    // break the "use step" isolation that prevents DB calls from running at
    // workflow-setup time. This test catches that regression.
    const source = await Bun.file(new URL("chat.ts", import.meta.url)).text();

    expect(source).not.toContain(
      'import { recordGoalLedgerStart } from "@/lib/workflows/goal-ledger-recorder";',
    );
    expect(source).not.toContain(
      'import { recordGoalLedgerClose } from "@/lib/workflows/goal-ledger-recorder";',
    );
    // The recorder IS imported — just dynamically inside a "use step" wrapper.
    expect(source).toContain('"@/lib/workflows/goal-ledger-recorder"');
    expect(source).toContain("async function startGoalLedger");
    expect(source).toContain("async function closeGoalLedger");
  });

  test("regression: objective is truncated to 200 chars from user message", async () => {
    // If the truncation is removed, long objectives would break DB column limits.
    const longText = "A".repeat(500);
    const options = makeOptions({
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          parts: [{ type: "text", text: longText }],
        },
      ],
    });

    await runAgentWorkflow(options);

    const startCalls = spies.recordGoalLedgerStart.mock.calls as unknown[][];
    const startCall = startCalls[0]?.[0] as { objective?: string } | undefined;
    expect(startCall?.objective?.length).toBeLessThanOrEqual(200);
  });

  test("throws when no messages provided", async () => {
    try {
      await runAgentWorkflow(makeOptions({ messages: [] }));
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain("at least one message");
    }
  });

  test("exits before side effects when another workflow owns the stream slot", async () => {
    spies.claimActiveStream.mockImplementationOnce(() =>
      Promise.resolve("conflict"),
    );

    await runAgentWorkflow(makeOptions());

    expect(writtenChunks).toEqual([]);
    expect(agentInputMessages).toBeUndefined();
    expect(spies.persistAssistantMessage).not.toHaveBeenCalled();
    expect(spies.clearActiveStream).not.toHaveBeenCalled();
    expect(spies.recordWorkflowUsage).not.toHaveBeenCalled();
  });

  test("continues when claiming the stream errors", async () => {
    spies.claimActiveStream.mockImplementationOnce(() =>
      Promise.resolve("error"),
    );

    await runAgentWorkflow(makeOptions());

    const types = writtenChunks.map((chunk) => chunk.type);
    expect(types[0]).toBe("start");
    expect(types[types.length - 1]).toBe("finish");
    expect(spies.persistAssistantMessage).toHaveBeenCalledTimes(1);
  });

  test("sends start and finish chunks to writable", async () => {
    await runAgentWorkflow(makeOptions());

    const types = writtenChunks.map((c) => c.type);
    expect(types[0]).toBe("start");
    expect(types[types.length - 1]).toBe("finish");
  });

  test("resolves Composio for the main agent without passing tools when off", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.resolveComposioToolsForChat).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
      agentKey: "main",
      runtimeMode: "classic",
    });
    expect(agentStreamTools).toBeUndefined();
  });

  test("passes selected Composio tools into the agent stream with evidence", async () => {
    const composioTools = {
      COMPOSIO_GITHUB_CREATE_ISSUE: { description: "Create an issue" },
    };
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => ({
      status: "ready" as const,
      tools: composioTools,
      profile: {
        id: "profile-1",
        name: "GitHub",
        toolkitSlugs: ["github"],
      },
      composioSessionId: "composio-session-1",
      configHash: "hash-1",
      reusedSession: false,
    }));

    await runAgentWorkflow(makeOptions());

    // mergeExtraTools returns a fresh object ({ ...composioTools }) so Composio
    // and GitHub tools can coexist without clobbering; assert structural
    // equality rather than reference identity.
    expect(agentStreamTools).toEqual(composioTools);
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.profile.selected",
        status: "succeeded",
        summary: "Using Composio profile: GitHub.",
        payload: expect.objectContaining({
          profileId: "profile-1",
          toolkitSlugs: ["github"],
          configHash: "hash-1",
          composioSessionId: "composio-session-1",
          toolCount: 1,
        }),
      }),
    );
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.session.created",
        status: "succeeded",
        payload: expect.objectContaining({
          profileId: "profile-1",
          configHash: "hash-1",
          composioSessionId: "composio-session-1",
        }),
      }),
    );
  });

  test("surfaces Composio setup failures before model invocation", async () => {
    const setupError = new Error(
      "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
    );
    setupError.name = "ComposioSetupError";
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => {
      throw setupError;
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Composio tools are selected",
    );

    expect(agentInputMessages).toBeUndefined();
    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta:
            "Composio tools are selected, but COMPOSIO_API_KEY is not configured. Add the key in your deployment environment, then retry, or turn Tools off for this chat.",
        },
      ]),
    );
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.session.failed",
        status: "failed",
        summary:
          "Composio tools are selected, but COMPOSIO_API_KEY is not configured. Add the key in your deployment environment, then retry, or turn Tools off for this chat.",
      }),
    );
  });

  test("surfaces wrapped invalid Composio API key errors as actionable chat text", async () => {
    const setupError = new Error(
      'FatalError: Step failed after 3 retries: 401 {"error":{"message":"Invalid API key: ak_invalid","code":10401,"suggested_fix":"Please check you are using a valid API key."}}',
    );
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => {
      throw setupError;
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Invalid API key",
    );

    expect(agentInputMessages).toBeUndefined();
    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta:
            "Composio tools could not start because COMPOSIO_API_KEY is invalid. Update the key in your deployment environment, then retry, or turn Tools off for this chat.",
        },
      ]),
    );
    expect(JSON.stringify(writtenChunks)).not.toContain("ak_invalid");
  });

  test("passes managed runtime mode into agent options", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(
          createResolvedChatSandboxRuntime({
            runtimeMode: "managed_runtime",
          }),
        );
      },
    );

    await runAgentWorkflow(makeOptions());

    expect(agentStreamOptions).toMatchObject({
      runtimeMode: "managed_runtime",
      managedRuntime: {
        sandboxName: "session_session-1",
      },
    });
  });

  test("marks managed runtime proof no_activity when the coordinator answers without delegating or running tools", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(
          createResolvedChatSandboxRuntime({
            runtimeMode: "managed_runtime",
            managedRuntime: {
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.1",
              profileDisplayName: "Web app with Bun and browser checks",
              profileRunId: "profile-run-1",
              sandboxName: "session_session-1",
            },
          }),
        );
      },
    );

    await runAgentWorkflow(makeOptions());

    const proofParts = writtenChunks.filter(
      (chunk) => chunk.type === "data-runtime-proof",
    );

    expect(proofParts).toEqual([
      {
        type: "data-runtime-proof",
        id: "gen-id-1:runtime-proof",
        data: {
          status: "no_activity",
          runtimeMode: "managed_runtime",
          workflowRunId: "wrun_test-123",
          sandboxName: "session_session-1",
          profile: {
            id: "web-bun-agent-browser",
            version: "2026-05-23.1",
            displayName: "Web app with Bun and browser checks",
            profileRunId: "profile-run-1",
          },
          workerEvidence: {
            total: 0,
            completed: 0,
            failed: 0,
            running: 0,
            latest: null,
          },
          coordinatorDirectToolUse: {
            observed: false,
            count: 0,
            toolTypes: [],
            toolLabels: [],
            warning: null,
          },
          externalToolUse: {
            observed: false,
            count: 0,
            toolNames: [],
          },
          evidence: [
            "Managed runtime was selected for this workflow.",
            "Workflow, sandbox, and profile run attribution were recorded.",
            "Profile setup/probe details are available in Runtime Inspector.",
          ],
          serviceEvidence: {
            total: 0,
            running: 0,
            failed: 0,
            latest: null,
          },
          browserEvidence: {
            total: 0,
            passed: 0,
            failed: 0,
            latest: null,
          },
          limitations: [
            "Managed runtime was selected, but no managed worker executed for this turn.",
            "Service/dev-server evidence is captured only when a managed service is started.",
            "Browser/screenshot evidence is captured only when a browser check is run.",
          ],
        },
      },
    ]);

    expect(spies.persistAssistantMessage).toHaveBeenLastCalledWith(
      "chat-1",
      expect.objectContaining({
        parts: expect.arrayContaining([proofParts[0]]),
      }),
    );
    expect(spies.listManagedServices).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(spies.listManagedBrowserRuns).toHaveBeenCalledWith({
      sessionId: "session-1",
      chatId: "chat-1",
    });
  });

  test("includes managed service and browser evidence in runtime proof data", async () => {
    agentAssistantParts = [
      { type: "text", text: "Done." },
      managedWorkerTaskPart(),
    ];
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(
          createResolvedChatSandboxRuntime({
            runtimeMode: "managed_runtime",
            managedRuntime: {
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.1",
              profileDisplayName: "Web app with Bun and browser checks",
              profileRunId: "profile-run-1",
              sandboxName: "session_session-1",
            },
          }),
        );
      },
    );
    spies.listManagedServices.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: "service-1",
          kind: "dev_server",
          status: "running",
          packagePath: "apps/web",
          port: 3000,
          url: "https://preview.example.test",
          logPath: "/workspace/apps/web/.open-agents-managed-dev-server.log",
          lastHealthStatus: 200,
          failureMessage: null,
        },
      ]),
    );
    spies.listManagedBrowserRuns.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: "browser-1",
          status: "passed",
          targetUrl: "https://preview.example.test",
          summary: "Browser check loaded the preview and captured a snapshot.",
          consoleErrors: [],
          networkErrors: [],
          steps: [],
          artifactRefs: [{ kind: "screenshot", path: "/tmp/screenshot.png" }],
          redactionStatus: "passed",
        },
      ]),
    );

    await runAgentWorkflow(makeOptions());

    const proofPart = writtenChunks.find(
      (chunk) => chunk.type === "data-runtime-proof",
    );

    expect(proofPart).toMatchObject({
      type: "data-runtime-proof",
      data: {
        status: "completed",
        workerEvidence: {
          total: 1,
          completed: 1,
          failed: 0,
          running: 0,
          latest: {
            id: "task-1",
            workerType: "executor",
            status: "completed",
            sandboxName: "session_session-1",
            profileId: "web-bun-agent-browser",
            profileVersion: "2026-05-23.1",
            profileDisplayName: "Web app with Bun and browser checks",
            profileRunId: "profile-run-1",
            currentToolName: null,
            currentToolSummary: null,
            toolCallCount: 3,
            summary: "Implement a small UI change",
          },
        },
        coordinatorDirectToolUse: {
          observed: false,
          count: 0,
          toolTypes: [],
          toolLabels: [],
          warning: null,
        },
        evidence: expect.arrayContaining([
          "Managed worker evidence recorded: executor completed in sandbox session_session-1 with 3 tool calls.",
          "Managed dev-server evidence recorded: service-1 running on port 3000 (HTTP 200).",
          "Browser/screenshot evidence recorded: browser-1 passed with 1 artifact.",
        ]),
        serviceEvidence: {
          total: 1,
          running: 1,
          failed: 0,
          latest: {
            id: "service-1",
            kind: "dev_server",
            status: "running",
            packagePath: "apps/web",
            port: 3000,
            url: "https://preview.example.test",
            logPath: "/workspace/apps/web/.open-agents-managed-dev-server.log",
            lastHealthStatus: 200,
            failureMessage: null,
          },
        },
        browserEvidence: {
          total: 1,
          passed: 1,
          failed: 0,
          latest: {
            id: "browser-1",
            status: "passed",
            targetUrl: "https://preview.example.test",
            summary:
              "Browser check loaded the preview and captured a snapshot.",
            artifactCount: 1,
            redactionStatus: "passed",
          },
        },
        limitations: [],
      },
    });
  });

  test("marks managed runtime proof incomplete when coordinator used direct repo tools", async () => {
    agentAssistantParts = [
      { type: "text", text: "Done." },
      managedWorkerTaskPart(),
      {
        type: "tool-bash",
        state: "output-available",
        input: { command: "bun --bun run ci" },
        output: { success: true },
      },
    ];
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(
          createResolvedChatSandboxRuntime({
            runtimeMode: "managed_runtime",
            managedRuntime: {
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.1",
              profileDisplayName: "Web app with Bun and browser checks",
              profileRunId: "profile-run-1",
              sandboxName: "session_session-1",
            },
          }),
        );
      },
    );

    await runAgentWorkflow(makeOptions());

    const proofPart = writtenChunks.find(
      (chunk) => chunk.type === "data-runtime-proof",
    );

    expect(proofPart).toMatchObject({
      type: "data-runtime-proof",
      data: {
        status: "incomplete",
        coordinatorDirectToolUse: {
          observed: true,
          count: 1,
          toolTypes: ["tool-bash"],
          toolLabels: ["Bash"],
          warning:
            "Coordinator direct repo tool use observed: Bash. These actions did not run through a managed worker.",
        },
        limitations: expect.arrayContaining([
          "Coordinator direct repo tool use observed: Bash. These actions did not run through a managed worker.",
        ]),
      },
    });
  });

  test("regression(issue-416): does not mark proof completed when worker failed but external tools completed", async () => {
    // Regression for the bug where failed > 0 AND completed === 0 AND
    // externalToolsCompleted > 0 would incorrectly return 'completed'.
    // The outer if fires because failed > 0; the inner guard must also check
    // failed === 0 so external tools cannot mask a failed managed worker.
    agentAssistantParts = [
      { type: "text", text: "Done." },
      // A managed worker that failed
      {
        ...managedWorkerTaskPart(),
        state: "output-error",
      },
      // Two successful external (Composio/dynamic) tool calls
      {
        type: "dynamic-tool",
        state: "output-available",
        toolName: "github_create_file",
      },
      {
        type: "dynamic-tool",
        state: "output-available",
        toolName: "github_push_files",
      },
    ];
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(
          createResolvedChatSandboxRuntime({
            runtimeMode: "managed_runtime",
            managedRuntime: {
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.1",
              profileDisplayName: "Web app with Bun and browser checks",
              profileRunId: "profile-run-1",
              sandboxName: "session_session-1",
            },
          }),
        );
      },
    );

    await runAgentWorkflow(makeOptions());

    const proofPart = writtenChunks.find(
      (chunk) => chunk.type === "data-runtime-proof",
    );

    // External tools must NOT elevate proof to 'completed' when a managed
    // worker was attempted and failed (failed=1, completed=0).
    expect(proofPart).toMatchObject({
      type: "data-runtime-proof",
      data: {
        status: "incomplete",
        workerEvidence: {
          failed: 1,
          completed: 0,
        },
      },
    });
  });

  test("streams transient workspace setup status from runtime prep", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(async (params) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      writtenChunks.push({
        type: "data-workspace-status",
        id: "workspace-status",
        data: {
          status: "setting-up",
          message: "Setting up the workspace...",
        },
        transient: true,
      });
      return createResolvedChatSandboxRuntime({
        didSetupWorkspace: true,
      });
    });

    await runAgentWorkflow(makeOptions());

    expect(writtenChunks[0]).toEqual({ type: "start", messageId: "gen-id-1" });
    expect(writtenChunks[1]).toEqual({
      type: "data-workspace-status",
      id: "workspace-status",
      data: {
        status: "setting-up",
        message: "Setting up the workspace...",
      },
      transient: true,
    });
  });

  test("streams a user-visible message when workspace setup fails", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(async (params) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      throw new Error("Connect GitHub to access repositories");
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Connect GitHub to access repositories",
    );

    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        { type: "start", messageId: "gen-id-1" },
        { type: "text-start", id: "setup-error" },
        {
          type: "text-delta",
          id: "setup-error",
          delta: "Connect GitHub to access this repository, then try again.",
        },
        { type: "text-end", id: "setup-error" },
      ]),
    );
    expect(spies.persistAssistantMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        id: "gen-id-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Connect GitHub to access this repository, then try again.",
          },
        ],
      }),
    );
  });

  test("streams an archived-session setup message when runtime rejects", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(async (params) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      throw new Error("Session is archived");
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Session is archived",
    );

    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta: "This session is archived. Unarchive it to continue.",
        },
      ]),
    );
  });

  test("streams managed runtime setup details when profile setup fails", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(async (params) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      const error = new Error(
        "Managed runtime profile setup failed while running Install agent-browser for browser smoke checks for Web app with Bun and browser checks (web-bun-agent-browser). agent-browser lets the managed runtime open preview URLs, inspect the UI, capture browser errors, and run browser smoke checks after the app starts.",
      );
      error.name = "WorkspaceSetupError";
      throw error;
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Managed runtime profile setup failed",
    );

    const setupErrorChunk = writtenChunks.find(
      (chunk) => chunk.type === "text-delta" && chunk.id === "setup-error",
    );
    expect(setupErrorChunk?.type).toBe("text-delta");
    if (setupErrorChunk?.type === "text-delta") {
      expect(setupErrorChunk.delta).toContain("web-bun-agent-browser");
      expect(setupErrorChunk.delta).toContain("agent-browser");
    }
  });

  test("streams AI Gateway credit restriction details when model streaming fails", async () => {
    agentStreamError = new Error(
      "GatewayInternalServerError: Free credits temporarily have restricted access due to abuse. no_providers_available RestrictedModelsError",
    );

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Provider error",
    );

    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta:
            "The model call failed in Vercel AI Gateway because free credits are temporarily restricted for this project. Add paid AI Gateway credits or switch to a model/provider with available credits, then retry.",
        },
      ]),
    );
  });

  test("persists assistant message after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistAssistantMessage).toHaveBeenCalledTimes(1);
    const paCalls = spies.persistAssistantMessage.mock.calls as unknown[][];
    expect(paCalls[0][0]).toBe("chat-1");
  });

  test("persists incoming messages during workflow startup", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistUserMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ id: "user-1", role: "user" }),
    );
    expect(spies.persistAssistantMessageWithToolResults).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ id: "user-1", role: "user" }),
    );
  });

  test("records usage after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.recordWorkflowUsage).toHaveBeenCalledTimes(1);
    const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
    expect(rwCalls[0][0]).toBe("user-1");
    expect(rwCalls[0][1]).toBe("gpt-4");
  });

  test("persists model metadata even without a finish-step chunk", async () => {
    await runAgentWorkflow(
      makeOptions({
        selectedModelId: "variant:builtin:gpt-5.4-xhigh",
        modelId: "openai/gpt-5.4",
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });
  });

  test("streams model metadata in finish-step chunks", async () => {
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        selectedModelId: "variant:builtin:gpt-5.4-xhigh",
        modelId: "openai/gpt-5.4",
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          selectedModelId?: string;
          modelId?: string;
        };
      } => chunk.type === "message-metadata",
    );

    expect(metadataChunks.at(-1)?.messageMetadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });
  });

  test("overwrites model metadata when resuming an assistant message", async () => {
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "assistant-1",
            role: "assistant" as const,
            parts: [{ type: "text", text: "Need your approval" }],
            metadata: {
              selectedModelId: "variant:builtin:gpt-5.4-xhigh",
              modelId: "openai/gpt-5.4",
            },
          },
        ],
        selectedModelId: "anthropic/claude-opus-4.6",
        modelId: "anthropic/claude-opus-4.6",
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "anthropic/claude-opus-4.6",
      modelId: "anthropic/claude-opus-4.6",
    });
  });

  test("marks workflow run as failed when maxSteps is exhausted", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
    const workflowRun = rwCalls[0][5] as {
      workflowRunId: string;
      status: string;
      totalDurationMs: number;
      stepTimings: Array<{
        stepNumber: number;
        durationMs: number;
        finishReason?: string;
      }>;
    };

    expect(workflowRun.workflowRunId).toBe("wrun_test-123");
    expect(workflowRun.status).toBe("failed");
    expect(workflowRun.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(workflowRun.stepTimings).toHaveLength(2);
    expect(workflowRun.stepTimings).toEqual([
      expect.objectContaining({
        stepNumber: 1,
        durationMs: expect.any(Number),
        finishReason: "tool-calls",
      }),
      expect.objectContaining({
        stepNumber: 2,
        durationMs: expect.any(Number),
        finishReason: "tool-calls",
      }),
    ]);
  });

  test("logs full step diagnostics when the agent finishes with reason other", async () => {
    agentFinishReason = "other";
    agentRawFinishReason = "provider_other";
    agentResponseMessages = [{ role: "assistant" }];
    agentResponse = {
      id: "response-1",
      messages: agentResponseMessages,
      modelId: "test-model",
    };
    agentWarnings = [
      {
        type: "unsupported-setting",
        setting: "text.verbosity",
        details: "Provider ignored the requested verbosity.",
      },
    ];
    agentRequestBody = {
      model: "openai/gpt-5",
      store: false,
      max_output_tokens: 512,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
      tools: [{ type: "function", name: "read" }],
    };
    agentResponseHeaders = { "x-request-id": "req-123" };
    agentResponseBody = {
      id: "response-body-1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          id: "msg-1",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi" }],
        },
      ],
      usage: { total_tokens: 15 },
      service_tier: "default",
    };
    agentProviderMetadata = {
      openai: { responseId: "response-1", serviceTier: "default" },
    };

    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      await runAgentWorkflow(makeOptions());

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toHaveLength(1);
      const warning = warnings[0]?.[0];
      expect(typeof warning).toBe("string");
      expect(warning).toStartWith(
        "[workflow] Agent step finished with reason 'other':\n",
      );

      const payload = JSON.parse(
        (warning as string).replace(
          "[workflow] Agent step finished with reason 'other':\n",
          "",
        ),
      );

      expect(payload).toMatchObject({
        workflowRunId: "wrun_test-123",
        chatId: "chat-1",
        sessionId: "session-1",
        messageId: "gen-id-1",
        selectedModelId: "gpt-4",
        finishReason: "other",
        rawFinishReason: "provider_other",
        response: agentResponse,
        stepDiagnostics: [
          {
            stepNumber: 0,
            model: { provider: "openai", modelId: "test-model" },
            finishReason: "other",
            rawFinishReason: "provider_other",
            warnings: agentWarnings,
            request: {
              body: {
                model: "openai/gpt-5",
                store: false,
                maxOutputTokens: 512,
                inputCount: 1,
                toolsCount: 1,
              },
            },
            response: {
              id: "response-1",
              modelId: "test-model",
              headers: { "x-request-id": "req-123" },
              body: {
                id: "response-body-1",
                status: "incomplete",
                incompleteDetails: { reason: "max_output_tokens" },
                outputCount: 1,
                serviceTier: "default",
              },
              messageCount: 1,
            },
            providerMetadata: {
              openai: { responseId: "response-1", serviceTier: "default" },
            },
          },
        ],
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  test("persists raw finish reasons for each agent step in message metadata", async () => {
    agentFinishReason = "tool-calls";
    agentStreamParts = [
      { type: "text-delta", textDelta: "Hi" },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        lastStepFinishReason?: string;
        lastStepRawFinishReason?: string;
        stepFinishReasons?: Array<{
          finishReason: string;
          rawFinishReason?: string;
        }>;
      };
    };

    expect(persistedMessage.metadata?.lastStepFinishReason).toBe("tool-calls");
    expect(persistedMessage.metadata?.lastStepRawFinishReason).toBe(
      "provider_tool_use",
    );
    expect(persistedMessage.metadata?.stepFinishReasons).toEqual([
      {
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
      },
      {
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
      },
    ]);
  });

  test("streams and persists cumulative total message usage", async () => {
    agentFinishReason = "tool-calls";
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          totalMessageUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          };
        };
      } => chunk.type === "message-metadata",
    );

    expect(
      metadataChunks.map((chunk) => ({
        inputTokens: chunk.messageMetadata.totalMessageUsage?.inputTokens,
        outputTokens: chunk.messageMetadata.totalMessageUsage?.outputTokens,
        totalTokens: chunk.messageMetadata.totalMessageUsage?.totalTokens,
      })),
    ).toEqual([
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    ]);

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        totalMessageUsage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      };
    };

    expect({
      inputTokens: persistedMessage.metadata?.totalMessageUsage?.inputTokens,
      outputTokens: persistedMessage.metadata?.totalMessageUsage?.outputTokens,
      totalTokens: persistedMessage.metadata?.totalMessageUsage?.totalTokens,
    }).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
  });

  test("streams and persists cumulative gateway cost", async () => {
    agentFinishReason = "tool-calls";
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
        providerMetadata: {
          gateway: { cost: "0.0025" },
        },
      },
    ];
    agentProviderMetadata = {
      gateway: { cost: "0.0025" },
    };

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          lastStepCost?: number;
          totalMessageCost?: number;
        };
      } => chunk.type === "message-metadata",
    );

    expect(
      metadataChunks.map((chunk) => ({
        lastStepCost: chunk.messageMetadata.lastStepCost,
        totalMessageCost: chunk.messageMetadata.totalMessageCost,
      })),
    ).toEqual([
      { lastStepCost: 0.0025, totalMessageCost: 0.0025 },
      { lastStepCost: 0.0025, totalMessageCost: 0.005 },
    ]);

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        lastStepCost?: number;
        totalMessageCost?: number;
      };
    };

    expect(persistedMessage.metadata?.lastStepCost).toBe(0.0025);
    expect(persistedMessage.metadata?.totalMessageCost).toBeCloseTo(0.005, 10);
  });

  test("preserves previously accumulated gateway cost when resuming an assistant message", async () => {
    const existingTotalMessageCost = 0.0025;
    const resumedStepCost = 0.001;
    const expectedTotalMessageCost = existingTotalMessageCost + resumedStepCost;

    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
        providerMetadata: {
          gateway: { cost: String(resumedStepCost) },
        },
      },
    ];
    agentProviderMetadata = {
      gateway: { cost: String(resumedStepCost) },
    };

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Need your approval" }],
            metadata: {
              totalMessageCost: existingTotalMessageCost,
            },
          },
        ],
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          lastStepCost?: number;
          totalMessageCost?: number;
        };
      } => chunk.type === "message-metadata",
    );

    expect(metadataChunks.at(-1)?.messageMetadata.lastStepCost).toBe(
      resumedStepCost,
    );
    expect(metadataChunks.at(-1)?.messageMetadata.totalMessageCost).toBeCloseTo(
      expectedTotalMessageCost,
      10,
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        lastStepCost?: number;
        totalMessageCost?: number;
      };
    };

    expect(persistedMessage.metadata?.lastStepCost).toBe(resumedStepCost);
    expect(persistedMessage.metadata?.totalMessageCost).toBeCloseTo(
      expectedTotalMessageCost,
      10,
    );
  });

  test("omits cost metadata when provider does not report gateway cost", async () => {
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(makeOptions());

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        lastStepCost?: number;
        totalMessageCost?: number;
      };
    };

    expect(persistedMessage.metadata?.lastStepCost).toBeUndefined();
    expect(persistedMessage.metadata?.totalMessageCost).toBeUndefined();
  });

  test("refreshes lifecycle activity before clearing the active stream", async () => {
    const callOrder: string[] = [];
    spies.refreshLifecycleActivity.mockImplementationOnce(async () => {
      callOrder.push("refresh-lifecycle");
    });
    spies.clearActiveStream.mockImplementationOnce(async () => {
      callOrder.push("clear-stream");
    });

    await runAgentWorkflow(makeOptions());

    expect(spies.refreshLifecycleActivity).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["refresh-lifecycle", "clear-stream"]);
  });

  test("persists sandbox state when sandbox is present", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistSandboxState).toHaveBeenCalledTimes(1);
  });

  test("clears active stream in finally block", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.clearActiveStream).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
    );
  });

  test("skips diff cache refresh when no file-changing tools ran", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.refreshDiffCache).not.toHaveBeenCalled();
  });

  test("refreshes diff cache after a write tool runs", async () => {
    agentStreamParts = [];
    agentResponseMessages = [];
    agentResponse = { messages: agentResponseMessages };
    streamOnFinishCallback = undefined;
    const writeToolPart = {
      type: "tool-write",
      toolCallId: "write-1",
      state: "output-available",
      input: { filePath: "app/page.tsx" },
      output: { success: true },
    };
    agentAssistantParts = [writeToolPart];

    await runAgentWorkflow(makeOptions());

    expect(spies.refreshDiffCache).toHaveBeenCalledTimes(1);
  });

  test("runs auto-commit when enabled and not aborted", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCommitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("runs auto PR creation when enabled and not aborted", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCreatePrStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCreatePrStep).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("skips optimistic commit streaming when preflight finds no changes", async () => {
    spies.hasAutoCommitChangesStep.mockImplementationOnce(() =>
      Promise.resolve(false),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
    expect(spies.runAutoCreatePrStep).toHaveBeenCalledTimes(1);
    expect(
      writtenChunks.filter((chunk) => chunk.type === "data-commit"),
    ).toEqual([]);
  });

  test("streams and persists resolved git data parts", async () => {
    spies.runAutoCommitStep.mockImplementationOnce(() =>
      Promise.resolve({
        committed: true,
        pushed: true,
        commitMessage: "feat: add auto git status",
        commitSha: "abc123",
      }),
    );
    spies.runAutoCreatePrStep.mockImplementationOnce(() =>
      Promise.resolve({
        created: true,
        syncedExisting: false,
        skipped: false,
        prNumber: 101,
        prUrl: "https://github.com/acme/repo/pull/101",
      }),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(
      writtenChunks.filter((chunk) => chunk.type === "data-commit"),
    ).toEqual([
      {
        type: "data-commit",
        id: "gen-id-1:commit",
        data: { status: "pending" },
      },
      {
        type: "data-commit",
        id: "gen-id-1:commit",
        data: {
          status: "success",
          committed: true,
          pushed: true,
          commitMessage: "feat: add auto git status",
          commitSha: "abc123",
          url: "https://github.com/acme/repo/commit/abc123",
        },
      },
    ]);
    expect(writtenChunks.filter((chunk) => chunk.type === "data-pr")).toEqual([
      {
        type: "data-pr",
        id: "gen-id-1:pr",
        data: { status: "pending" },
      },
      {
        type: "data-pr",
        id: "gen-id-1:pr",
        data: {
          status: "success",
          created: true,
          syncedExisting: false,
          prNumber: 101,
          url: "https://github.com/acme/repo/pull/101",
        },
      },
    ]);

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      parts: Array<Record<string, unknown>>;
    };

    expect(persistedMessage.parts).toEqual(
      expect.arrayContaining([
        {
          type: "data-commit",
          id: "gen-id-1:commit",
          data: {
            status: "success",
            committed: true,
            pushed: true,
            commitMessage: "feat: add auto git status",
            commitSha: "abc123",
            url: "https://github.com/acme/repo/commit/abc123",
          },
        },
        {
          type: "data-pr",
          id: "gen-id-1:pr",
          data: {
            status: "success",
            created: true,
            syncedExisting: false,
            prNumber: 101,
            url: "https://github.com/acme/repo/pull/101",
          },
        },
      ]),
    );
  });

  test("prunes synthetic git-only assistant messages before the next model call", async () => {
    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
          {
            id: "assistant-git-1",
            role: "assistant",
            parts: [
              {
                type: "data-commit",
                id: "assistant-git-1:commit",
                data: { status: "success" },
              },
            ],
            metadata: {},
          },
          {
            id: "user-2",
            role: "user",
            parts: [{ type: "text", text: "What changed?" }],
          },
        ],
      }),
    );

    expect(agentInputMessages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "What changed?" }],
      },
    ]);
  });

  test("skips auto PR creation when auto-commit does not push the latest commit", async () => {
    spies.runAutoCommitStep.mockImplementationOnce(() =>
      Promise.resolve({
        committed: true,
        pushed: false,
        error: "Commit succeeded but push failed",
      }),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips post-finish automation when the agent pauses for tool input", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [
              {
                type: "tool-invocation",
                state: "approval-requested",
              },
            ],
            metadata: {},
          },
        ],
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips auto PR creation when not enabled", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: false,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when not enabled", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: false,
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when repoOwner is missing", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(() =>
      Promise.resolve(
        createResolvedChatSandboxRuntime({
          repoOwner: undefined,
          repoName: "repo",
        }),
      ),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when repoName is missing", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(() =>
      Promise.resolve(
        createResolvedChatSandboxRuntime({
          repoOwner: "acme",
          repoName: undefined,
        }),
      ),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  // ── Goal ledger recorder lifecycle tests ───────────────────────────
  // NOTE: These tests must appear BEFORE the "still clears stream" test,
  // because that test re-mocks @/app/config to throw — an override that
  // persists for subsequent dynamic imports in the same file.

  // ── Step history gap tests (TASK-ISSUE-36 fix) ──────────────────────
  // RED: These tests fail before FIX 1 is implemented because the current code
  // records only a `final` event — no `started` or `progress` events.

  test("records a 'started' ledger event immediately after startGoalLedger succeeds", async () => {
    await runAgentWorkflow(makeOptions());

    // Must have been called at least once with eventType "started"
    type EventCall = {
      goalId: string;
      userId: string;
      eventType: string;
      summary: string;
      payload?: Record<string, unknown>;
    };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const startedCalls = allCalls.filter(
      ([input]) => input.eventType === "started",
    );
    expect(startedCalls).toHaveLength(1);

    const [startedInput] = startedCalls[0];
    expect(startedInput.goalId).toBe("goal-test-abc123");
    expect(startedInput.userId).toBe("user-1");
    expect(startedInput.summary).toBeTruthy();
    // payload must carry the workflowRunId so the ledger event is traceable
    expect(startedInput.payload).toMatchObject({
      workflowRunId: "wrun_test-123",
    });
  });

  test("records at least one 'progress' event with stepNumber during a single-step run", async () => {
    await runAgentWorkflow(makeOptions());

    type EventCall = {
      goalId: string;
      userId: string;
      eventType: string;
      summary: string;
      payload?: Record<string, unknown>;
    };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const progressCalls = allCalls.filter(
      ([input]) => input.eventType === "progress",
    );
    // At least one progress event for the one step that ran
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);

    const [firstProgressInput] = progressCalls[0];
    expect(firstProgressInput.goalId).toBe("goal-test-abc123");
    expect(firstProgressInput.userId).toBe("user-1");
    // payload must include stepNumber
    expect(firstProgressInput.payload).toMatchObject({ stepNumber: 1 });
  });

  test("records a 'progress' event for each step in a multi-step run", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(makeOptions({ maxSteps: 2 }));

    type EventCall = {
      goalId: string;
      eventType: string;
      payload?: Record<string, unknown>;
    };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const progressCalls = allCalls.filter(
      ([input]) => input.eventType === "progress",
    );
    expect(progressCalls.length).toBe(2);

    const stepNumbers = progressCalls.map(
      ([input]) => input.payload?.stepNumber,
    );
    expect(stepNumbers).toEqual([1, 2]);
  });

  test("records 'started', progress events, then 'final' event in order", async () => {
    await runAgentWorkflow(makeOptions());

    type EventCall = { eventType: string };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const eventTypes = allCalls.map(([input]) => input.eventType);
    // started comes first, final comes last, progress in between
    expect(eventTypes[0]).toBe("started");
    expect(eventTypes[eventTypes.length - 1]).toBe("final");
    expect(
      eventTypes.filter((t) => t === "progress").length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("does not record 'started' or 'progress' events when startGoalLedger returns null", async () => {
    // When recordGoalLedgerStart returns null (e.g. DB unavailable), the goal id
    // is null and no events should be attempted — no goalId to record against.
    spies.recordGoalLedgerStart.mockResolvedValueOnce(
      null as unknown as string,
    );

    await runAgentWorkflow(makeOptions());

    type EventCall = { eventType: string };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const startedCalls = allCalls.filter(
      ([input]) => input.eventType === "started",
    );
    expect(startedCalls).toHaveLength(0);

    const progressCalls = allCalls.filter(
      ([input]) => input.eventType === "progress",
    );
    expect(progressCalls).toHaveLength(0);
  });

  test("failed-run final summary uses sanitized user-facing error message (FIX 4)", async () => {
    // When a run fails with a known error type, the final ledger summary must
    // use getUserFacingWorkflowErrorMessage, not the raw error string.
    const restrictedError = new Error(
      "GatewayInternalServerError: Free credits temporarily have restricted access due to abuse. no_providers_available RestrictedModelsError",
    );
    agentStreamError = restrictedError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected to throw
    }

    type EventCall = { eventType: string; summary: string };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const finalCalls = allCalls.filter(
      ([input]) => input.eventType === "final",
    );
    // A final event must have been recorded even on failure (goalLedgerId was set)
    expect(finalCalls.length).toBeGreaterThanOrEqual(1);

    const lastFinalCall = finalCalls[finalCalls.length - 1];
    const finalSummary =
      lastFinalCall !== undefined ? lastFinalCall[0].summary : "";
    // The sanitized message does NOT contain the raw internal error keywords
    expect(finalSummary).not.toContain("GatewayInternalServerError");
    expect(finalSummary).not.toContain("no_providers_available");
    // The sanitized message contains the user-facing wording
    expect(finalSummary).toContain("Vercel AI Gateway");
  });

  test("calls recordGoalLedgerStart with correct fields on a successful run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.recordGoalLedgerStart).toHaveBeenCalledTimes(1);
    expect(spies.recordGoalLedgerStart).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "wrun_test-123",
        objective: expect.any(String),
      }),
    );
  });

  test("objective is derived from the last user message text", async () => {
    const options = makeOptions({
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          parts: [
            {
              type: "text",
              text: "Please help me refactor the auth module",
            },
          ],
        },
      ],
    });

    await runAgentWorkflow(options);

    const startCalls = spies.recordGoalLedgerStart.mock.calls as unknown[][];
    const startCall = startCalls[0]?.[0] as { objective?: string } | undefined;
    expect(startCall?.objective).toContain("refactor the auth module");
  });

  test("calls recordGoalLedgerClose with terminal status 'complete' on a successful run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.recordGoalLedgerClose).toHaveBeenCalledTimes(1);
    expect(spies.recordGoalLedgerClose).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "goal-test-abc123",
        terminalStatus: "complete",
      }),
    );
  });

  test("calls recordGoalLedgerClose with terminal status 'failed' when maxSteps exhausted", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(makeOptions({ maxSteps: 2 }));

    expect(spies.recordGoalLedgerClose).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalStatus: "failed",
      }),
    );
  });

  // ── Issue #38: goal validation integration ────────────────────────────────
  // NOTE: These tests MUST appear before any test that re-mocks @/app/config,
  // because those re-mocks persist for subsequent dynamic imports in the same file.

  test("BT-038-CHAT-001: finalization calls validateGoalCompletion before closing as complete", async () => {
    // Default goalValidationResult is { ok: true } → close proceeds normally.
    await runAgentWorkflow(makeOptions());

    // validateGoalCompletion must have been called with status "complete"
    // and requireEvidence false (no proof-level link yet → dormant).
    expect(validateGoalCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complete",
        requireEvidence: false,
      }),
    );
    // Normal close still happens
    expect(spies.recordGoalLedgerClose).toHaveBeenCalledWith(
      expect.objectContaining({ terminalStatus: "complete" }),
    );
  });

  test("BT-038-CHAT-002: when validation fails (forced mock), goal is recorded as blocked instead of complete", async () => {
    // Force validation to fail — simulates a future requireEvidence:true scenario.
    goalValidationResult = {
      ok: false,
      code: "missing_required_evidence",
      reason: "A complete goal requires at least one evidence ref.",
    };

    await runAgentWorkflow(makeOptions());

    // Must NOT have closed as "complete".
    const closeCalls = spies.recordGoalLedgerClose.mock
      .calls as unknown[][] as Array<
      [{ goalId: string; terminalStatus: string }]
    >;
    const completeCalls = closeCalls.filter(
      ([input]) => input.terminalStatus === "complete",
    );
    expect(completeCalls).toHaveLength(0);

    // Should have emitted a "blocked" ledger event to record the validation failure.
    type EventCall = {
      goalId: string;
      eventType: string;
      summary: string;
      payload?: Record<string, unknown>;
    };
    const allEventCalls = spies.recordGoalLedgerEvent.mock
      .calls as unknown[][] as Array<[EventCall]>;
    const blockedCalls = allEventCalls.filter(
      ([input]) => input.eventType === "blocked",
    );
    expect(blockedCalls).toHaveLength(1);
    const [blockedInput] = blockedCalls[0];
    expect(blockedInput.summary).toContain("validation");
  });

  test("regression: validateGoalCompletion is called via dynamic import (source structure check)", async () => {
    // This test reads chat.ts source to verify that goal-validation is imported
    // dynamically — consistent with the "use step" isolation pattern used for
    // other DB-touching modules.
    const source = await Bun.file(new URL("chat.ts", import.meta.url)).text();

    // The module must be referenced as a dynamic import, not a top-level import.
    expect(source).not.toContain(
      'import { validateGoalCompletion } from "@/lib/workflows/goal-validation";',
    );
    expect(source).toContain('"@/lib/workflows/goal-validation"');
    expect(source).toContain("validateGoalCompletion");
  });

  // ── PARAMOUNT INVARIANT: subagent roster must be null when no DB rows ──────
  // BT-ROSTER-001 through BT-ROSTER-003 guard against the invariant violation
  // described in the blocking finding: when resolveAgentForRole returns a synthetic
  // fallback (fromDbRow=false), chat.ts must NOT emit a modelId-only roster entry.
  // If it does, applyRosterOverrides calls gateway(modelId) without
  // providerOptionsOverrides, silently dropping model-variant overrides.
  //
  // NOTE: These tests MUST appear before ANY test that re-mocks @/app/config
  // (the abort test and "still clears stream" test), because those re-mocks
  // persist for subsequent dynamic imports and break stream option capture.

  test("BT-ROSTER-001: when all roles return synthetic fallback (fromDbRow=false), agentOptions has no subagentRoster", async () => {
    // Synthetic fallback has non-null modelId (from prefs), null instructions,
    // empty slugs. Before the fix, toRosterEntry() would include modelId
    // and hasAnyEntry would be true → roster threaded into agentOptions.
    // After the fix, fromDbRow=false means modelId is ignored in toRosterEntry,
    // no entry is emitted, and subagentRoster stays null.
    await runAgentWorkflow(makeOptions());

    // agentStreamOptions is what was passed to webAgent.stream().
    // It must NOT have a subagentRoster when all roles are synthetic.
    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    expect(opts?.subagentRoster).toBeUndefined();
  });

  test("BT-ROSTER-002: when one role has a real DB row (fromDbRow=true, modelId set), roster IS threaded for that role only", async () => {
    // executor has a real DB row with a custom model — should appear in roster.
    // explorer and design are synthetic — should NOT appear in roster.
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "executor") {
          return {
            ...makeSyntheticResolvedAgent("executor", "openai/gpt-5.4"),
            fromDbRow: true,
          };
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const roster = opts?.subagentRoster as Record<string, unknown> | undefined;
    // roster must exist because executor has a real DB row
    expect(roster).toBeDefined();
    // only executor appears
    expect(roster?.executor).toMatchObject({ modelId: "openai/gpt-5.4" });
    // explorer and design must be absent (synthetic, no entry emitted)
    expect(roster?.explorer).toBeUndefined();
    expect(roster?.design).toBeUndefined();
  });

  test("BT-ROSTER-003: when all roles are synthetic (fromDbRow=false) even with non-null modelId, subagentRoster in agentOptions is undefined", async () => {
    // Simulate the exact production scenario: user has defaultSubagentModelId set,
    // zero agents rows. All roles return synthetic with a non-null modelId.
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) =>
        makeSyntheticResolvedAgent(params.role, "anthropic/claude-sonnet-4.5"),
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    // subagentRoster must be absent — model is already wired via subagentModel
    // in the agentOptions, and we must NOT override it without providerOptionsOverrides
    expect(opts?.subagentRoster).toBeUndefined();
  });

  test("regression: BT-ROSTER-REG-001 real DB row with instructions still threads full roster entry", async () => {
    // If fromDbRow=true AND instructions is set, the entry must include both
    // modelId and instructions. This catches future regressions where only one
    // field is emitted.
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "explorer") {
          return {
            ...makeSyntheticResolvedAgent("explorer", "openai/gpt-5.4"),
            fromDbRow: true,
            instructions: "Focus on reading, not writing.",
          };
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const roster = opts?.subagentRoster as Record<string, unknown> | undefined;
    expect(roster).toBeDefined();
    expect(roster?.explorer).toMatchObject({
      modelId: "openai/gpt-5.4",
      instructions: "Focus on reading, not writing.",
    });
  });

  test("recordGoalLedgerClose uses 'canceled' status when workflow is aborted", async () => {
    // Simulate abort: override the agent stream to throw an AbortError.
    // This is what happens when the user clicks Stop — the agent stream throws
    // and isAbortError(error) is true, causing stepWasAborted=true and
    // ultimately workflowStatus="aborted" which maps to terminalStatus="canceled".
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    mock.module("@/app/config", () => ({
      webAgent: {
        tools: {},
        stream: async () => ({
          toUIMessageStream: () => ({
            [Symbol.asyncIterator]() {
              return {
                next() {
                  return Promise.reject(abortError);
                },
                return() {
                  return Promise.resolve({ value: undefined, done: true });
                },
              };
            },
          }),
          totalUsage: Promise.resolve(agentTotalUsage),
          finishReason: Promise.resolve("stop"),
          rawFinishReason: Promise.resolve("AbortError"),
          response: Promise.resolve({ messages: [] }),
          steps: Promise.resolve([]),
        }),
      },
    }));

    const { runAgentWorkflow: abortRun } = await import("./chat");

    // Aborted workflow does not rethrow — it completes with "aborted" status.
    await abortRun(makeOptions());

    expect(spies.recordGoalLedgerClose).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalStatus: "canceled",
      }),
    );
  });

  test("runAgentWorkflow completes normally even when recordGoalLedgerStart rejects", async () => {
    // Defensive regression: recorder failure must never crash chat
    spies.recordGoalLedgerStart.mockRejectedValueOnce(
      new Error("DB connection failed"),
    );

    // The workflow should still complete without throwing
    await expect(runAgentWorkflow(makeOptions())).resolves.toBeUndefined();

    // Core workflow behavior is unchanged: the stream finishes
    const types = writtenChunks.map((c) => c.type);
    expect(types[types.length - 1]).toBe("finish");
    expect(spies.persistAssistantMessage).toHaveBeenCalledTimes(1);
  });

  test("runAgentWorkflow completes normally even when recordGoalLedgerClose rejects", async () => {
    // Defensive regression: close failure must not crash chat
    spies.recordGoalLedgerClose.mockImplementationOnce(async () => {
      throw new Error("DB write failed");
    });

    await expect(runAgentWorkflow(makeOptions())).resolves.toBeUndefined();

    const types = writtenChunks.map((c) => c.type);
    expect(types[types.length - 1]).toBe("finish");
  });

  // ── Regression tests: TASK-ISSUE-36 step history gap fix (13696abf) ──
  // These tests catch future breakage: if started/progress events are dropped,
  // the goal ledger returns to recording only the final event (the original bug).

  test("regression: progress event payload includes both stepNumber and finishReason", async () => {
    // If the payload structure changes (e.g. stepNumber dropped), ledger queries
    // filtering by stepNumber would silently return no results.
    await runAgentWorkflow(makeOptions());

    type EventCall = { eventType: string; payload?: Record<string, unknown> };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const progressCalls = allCalls.filter(
      ([input]) => input.eventType === "progress",
    );
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);

    for (const [input] of progressCalls) {
      expect(typeof input.payload?.stepNumber).toBe("number");
      expect(typeof input.payload?.finishReason).toBe("string");
    }
  });

  test("regression: started event payload includes workflowRunId for traceability", async () => {
    // The workflowRunId in the started event payload is what links the ledger
    // entry back to the workflow run record. If dropped, the ledger event is
    // untraceably orphaned.
    await runAgentWorkflow(makeOptions());

    type EventCall = { eventType: string; payload?: Record<string, unknown> };
    const allCalls = spies.recordGoalLedgerEvent.mock.calls as unknown as Array<
      [EventCall]
    >;

    const startedCalls = allCalls.filter(
      ([input]) => input.eventType === "started",
    );
    expect(startedCalls).toHaveLength(1);
    const firstStartedCall = startedCalls[0];
    expect(firstStartedCall).toBeDefined();
    if (firstStartedCall !== undefined) {
      expect(firstStartedCall[0].payload?.workflowRunId).toBe("wrun_test-123");
    }
  });

  test("regression: workflow completes normally when a progress event throws (defensiveness preserved)", async () => {
    // Simulate: progress event throws, but the final event must still be called
    // (the progress error is caught by the best-effort wrapper in chat.ts).
    let progressCallCount = 0;
    // Cast through unknown to allow our implementation to accept an arg.
    // The Bun mock type is `Mock<() => Promise<void>>` regardless of how many
    // args the original spy had; we use unknown to work around that mismatch.
    (
      spies.recordGoalLedgerEvent as unknown as {
        mockImplementation: (fn: (input: unknown) => Promise<void>) => void;
      }
    ).mockImplementation(async (input: unknown) => {
      const typedInput = input as { eventType: string };
      if (typedInput.eventType === "progress") {
        progressCallCount++;
        throw new Error("Simulated progress DB failure");
      }
      // Allow other event types (started, final) to succeed
    });

    // Must not throw even though progress events fail
    await expect(runAgentWorkflow(makeOptions())).resolves.toBeUndefined();

    // Stream finishes correctly
    const types = writtenChunks.map((c) => c.type);
    expect(types[types.length - 1]).toBe("finish");

    // The workflow still called progress (even though it threw)
    expect(progressCallCount).toBeGreaterThanOrEqual(1);

    // Restore spy
    spies.recordGoalLedgerEvent.mockReset();
    spies.recordGoalLedgerEvent.mockResolvedValue(undefined);
  });

  test("regression: startGoalLedger runs before sandbox/model setup (source structure check)", async () => {
    // This test reads chat.ts source to verify that startGoalLedger is called
    // BEFORE the try block that contains resolveChatSandboxRuntime. If someone
    // moves it back inside the try, setup failures won't create ledger entries.
    const source = await Bun.file(new URL("chat.ts", import.meta.url)).text();

    // The "started" event wiring block must appear before the sandbox runtime call.
    const startedEventIdx = source.indexOf(`eventType: "started"`);
    const sandboxRuntimeIdx = source.indexOf("resolveChatSandboxRuntime({");

    expect(startedEventIdx).toBeGreaterThan(-1);
    expect(sandboxRuntimeIdx).toBeGreaterThan(-1);
    expect(startedEventIdx).toBeLessThan(sandboxRuntimeIdx);
  });

  test("still clears stream and sends finish even on step error", async () => {
    // Mock the agent to throw
    mock.module("@/app/config", () => ({
      webAgent: {
        tools: {},
        stream: async () => {
          throw new Error("Agent failed");
        },
      },
    }));

    // Re-import to pick up new mock
    const { runAgentWorkflow: reloadedRun } = await import("./chat");

    try {
      await reloadedRun(makeOptions());
    } catch {
      // Expected to throw
    }

    // The finally block should still fire
    expect(spies.clearActiveStream).toHaveBeenCalled();
  });
});
