import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// ── Spy state ──────────────────────────────────────────────────────

const writtenChunks: UIMessageChunk[] = [];
let runStatus: string = "running";

type TestResolvedChatSandboxRuntime = {
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
  listManagedServices: mock(async (): Promise<unknown[]> => []),
  listManagedBrowserRuns: mock(async (): Promise<unknown[]> => []),
  createArtifact: mock(async (_input: unknown) => ({
    id: "artifact-created-id",
    kind: "research_packet",
    status: "available",
    redactionStatus: "pending",
    sourceLocation: null,
    summary: null,
    createdByActor: null,
    workflowRunId: null,
    sessionId: null,
    chatId: null,
    goalId: null,
    gateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
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

mock.module("./chat-sandbox-runtime", () => ({
  resolveChatSandboxRuntime: spies.resolveChatSandboxRuntime,
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: spies.listManagedServices,
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: spies.listManagedBrowserRuns,
}));

mock.module("@/lib/db/workflow-artifacts", () => ({
  createArtifact: spies.createArtifact,
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

    expect(agentStreamTools).toBe(composioTools);
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

  test("marks managed runtime proof incomplete when no managed worker executed", async () => {
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
          status: "incomplete",
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

  // ── BT-001: artifact generation — managed_runtime creates research_packet + spec ──

  test("creates research_packet and spec artifacts for a managed_runtime run", async () => {
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

    const artifactCalls = spies.createArtifact.mock.calls as unknown[][];
    const kinds = artifactCalls.map(
      (call) => (call[0] as { kind: string }).kind,
    );

    expect(kinds).toContain("research_packet");
    expect(kinds).toContain("spec");
  });

  // ── BT-002: artifact carries correct context fields ──

  test("creates artifacts with correct workflowRunId, sessionId, chatId, userId", async () => {
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

    const artifactCalls = spies.createArtifact.mock.calls as unknown[][];
    expect(artifactCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of artifactCalls) {
      const input = call[0] as {
        workflowRunId: string;
        sessionId: string;
        chatId: string;
      };
      expect(input.workflowRunId).toBe("wrun_test-123");
      expect(input.sessionId).toBe("session-1");
      expect(input.chatId).toBe("chat-1");
    }
  });

  // ── BT-003: redaction — secret is not present in artifact summary ──

  test("redacts secrets from artifact summary — bearer token is not written to createArtifact", async () => {
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

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "user-1",
            role: "user" as const,
            parts: [
              {
                type: "text",
                text: "Call the service using Bearer sk-supersecrettoken12345 to authenticate",
              },
            ],
          },
        ],
      }),
    );

    const artifactCalls = spies.createArtifact.mock.calls as unknown[][];
    expect(artifactCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of artifactCalls) {
      const input = call[0] as { summary: string | null };
      expect(input.summary ?? "").not.toContain("sk-supersecrettoken12345");
    }
  });

  // ── BT-004: defensive — createArtifact failure does not crash the workflow ──

  test("runAgentWorkflow completes normally even when createArtifact rejects", async () => {
    spies.createArtifact.mockImplementation(async () => {
      throw new Error("Artifact DB write failed");
    });

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

    // Must NOT throw
    await runAgentWorkflow(makeOptions());

    // Workflow still emits start + finish
    const types = writtenChunks.map((c) => c.type);
    expect(types[0]).toBe("start");
    expect(types[types.length - 1]).toBe("finish");

    // And normal persistence still happens
    expect(spies.clearActiveStream).toHaveBeenCalled();

    // Reset to default spy
    spies.createArtifact.mockRestore();
  });

  // ── BT-005: managed-only — classic run does NOT create artifacts ──

  test("does NOT call createArtifact for a classic (non-managed) run", async () => {
    // Default resolveChatSandboxRuntime returns runtimeMode: "classic"
    await runAgentWorkflow(makeOptions());

    expect(spies.createArtifact).not.toHaveBeenCalled();
  });

  // ── BT-006: artifact summary is non-empty for a normal objective ──

  test("artifact summary is non-empty string for a normal user message", async () => {
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

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "user-1",
            role: "user" as const,
            parts: [
              {
                type: "text",
                text: "Build a pagination component for the items list",
              },
            ],
          },
        ],
      }),
    );

    const artifactCalls = spies.createArtifact.mock.calls as unknown[][];
    expect(artifactCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of artifactCalls) {
      const input = call[0] as { summary: string | null };
      expect(typeof input.summary).toBe("string");
      expect((input.summary ?? "").length).toBeGreaterThan(0);
    }
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
