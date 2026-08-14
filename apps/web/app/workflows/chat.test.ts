import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { UIMessageChunk } from "ai";
import type { AgentModelSelection } from "@open-agents/agent";

// resolveInferenceProfileModelSelection (used to resolve a roster entry's own
// inference profile, #1157) lives in a "server-only" module. Dynamically
// importing it under bun test throws unless "server-only" is stubbed, same as
// every other test file in this repo that reaches a server-only module.
mock.module("server-only", () => ({}));

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

type TestResolvedSandboxFreeRuntime = {
  mode: "sandbox-free";
  sandboxState: null;
  runtimeMode: "classic";
  workingDirectory: null;
  currentBranch: null;
  environmentDetails: undefined;
  skills: never[];
  didSetupWorkspace: false;
  sessionTitle: string;
  repoOwner?: undefined;
  repoName?: undefined;
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

function createResolvedSandboxFreeRuntime(
  overrides: Partial<TestResolvedSandboxFreeRuntime> = {},
): TestResolvedSandboxFreeRuntime {
  return {
    mode: "sandbox-free",
    sandboxState: null,
    runtimeMode: "classic",
    workingDirectory: null,
    currentBranch: null,
    environmentDetails: undefined,
    skills: [],
    didSetupWorkspace: false,
    sessionTitle: "Session title",
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
  resolveChatSandboxRuntime: mock(
    (params: {
      assistantId: string;
    }): Promise<
      TestResolvedChatSandboxRuntime | TestResolvedSandboxFreeRuntime
    > => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      return Promise.resolve(createResolvedChatSandboxRuntime());
    },
  ),
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
  getInferenceProfileByIdForUser: mock(
    async (
      _userId: string,
      profileId: string,
    ): Promise<{
      id: string;
      name: string;
      provider: "anthropic";
      enabled: boolean;
    } | null> => ({
      id: profileId,
      name: `Profile ${profileId}`,
      provider: "anthropic" as const,
      enabled: true,
    }),
  ),
  decryptInferenceProfileApiKey: mock(() => "decrypted-test-key"),
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
  createArtifact: mock(async (input: Record<string, unknown>) => ({
    id: `artifact-${String(input.kind ?? "unknown")}`,
    ...input,
    createdAt: new Date("2026-06-20T12:00:00.000Z"),
    updatedAt: new Date("2026-06-20T12:00:00.000Z"),
  })),
  listArtifacts: mock(
    async (): Promise<Array<Record<string, unknown>>> => [
      { kind: "research_packet", status: "available" },
      { kind: "spec", status: "available" },
    ],
  ),
  recordGoalLedgerStart: mock(() => Promise.resolve("goal-test-abc123")),
  recordGoalLedgerEvent: mock(() => Promise.resolve()),
  recordGoalLedgerClose: mock(() => Promise.resolve()),
  // #1231: headless-run progress fuse + turn-end hibernation.
  hibernateHeadlessSandboxAtTurnEnd: mock(() =>
    Promise.resolve({ action: "hibernated" as const }),
  ),
  probeHeadlessRunGitFingerprint: mock(
    (): Promise<string | null> => Promise.resolve("fingerprint-const"),
  ),
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
  modelSystemPrompts: Record<string, string>;
};

// Track what the agent stream yields
let agentStreamParts: Array<Record<string, unknown>> = [];
let agentAssistantParts: Array<Record<string, unknown>> | undefined;
// Per-step parts, for tests that need the assistant to behave differently on
// each step (a tool that fails then succeeds, or fails a different way each
// time). Takes precedence over the fixed `agentAssistantParts` above.
let agentAssistantPartsFactory:
  | (() => Array<Record<string, unknown>>)
  | undefined;
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
// One entry per webAgent.stream() call (i.e. per agent step) — lets a
// multi-step test assert the SAME tool set was reused on every step, not
// just inspect the last call's tools (which `agentStreamTools` overwrites).
let agentStreamToolsCalls: unknown[] = [];
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

// Mirrors @workflow/errors' real FatalError (name + message only — chat.ts
// only relies on those two fields): a step throwing this stops immediately
// instead of being retried by the engine.
class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

mock.module("workflow", () => ({
  FatalError,
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
mock.module("./headless-progress-fuse", () => spies);

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
      agentStreamToolsCalls.push(tools);
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
            agentAssistantPartsFactory
              ? {
                  // The factory owns the whole message each step, so a test can
                  // model an agent that behaves differently per step. Cloning
                  // the prior message would carry the previous step's parts
                  // forward and make "three failures" indistinguishable from
                  // "one failure seen three times".
                  id: "assistant-1",
                  role: "assistant",
                  parts: agentAssistantPartsFactory(),
                  metadata: {},
                }
              : priorAssistantMessage?.role === "assistant"
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
  // Mirrors the real SDK: `isStaticToolUIPart(part) || isDynamicToolUIPart(part)`
  // (ai/dist/index.mjs:5250-5255). `dynamic-tool` must be included — external
  // tools (Composio, GitHub) arrive with that type, and a double that excludes
  // them hides any bug in how production handles them.
  isToolUIPart: (part: { type: string }) =>
    part.type === "tool-invocation" ||
    part.type.startsWith("tool-") ||
    part.type === "dynamic-tool",
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
  toProviderModelId: (modelId: string) => modelId,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => testChatRecord,
  getSessionById: async () => testSessionRecord,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => testPreferences,
}));

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: spies.getInferenceProfileByIdForUser,
  decryptInferenceProfileApiKey: spies.decryptInferenceProfileApiKey,
  INFERENCE_PROFILE_REENTER_KEY_MESSAGE:
    "Re-enter your API key for this profile.",
  recordInferenceProfileTestResult: mock(() => Promise.resolve()),
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

mock.module("@/lib/db/workflow-artifacts", () => ({
  createArtifact: spies.createArtifact,
  listArtifacts: spies.listArtifacts,
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
      workspacePolicy: {
        executionMode: "isolated",
      },
      completionPacket: {
        status: "completed",
        workspaceMode: "isolated",
        summary: "Applied the requested UI change and verified it.",
        changedFiles: [
          "apps/web/components/example.tsx",
          "apps/web/components/example.test.tsx",
        ],
        verification: ["bun test apps/web/components/example.test.tsx"],
        integrationInstructions: ["Review and merge the isolated diff."],
        blockers: [],
      },
      completionPacketValidation: {
        status: "valid",
        reasonCode: null,
      },
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
  agentAssistantPartsFactory = undefined;
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
  agentStreamToolsCalls = [];
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
    modelSystemPrompts: {},
  };
  Object.values(spies).forEach((s) => s.mockClear());
  // Reset recorder spies to their default successful implementations.
  spies.recordGoalLedgerStart.mockResolvedValue("goal-test-abc123");
  spies.recordGoalLedgerEvent.mockResolvedValue(undefined);
  spies.recordGoalLedgerClose.mockResolvedValue(undefined);
  spies.hibernateHeadlessSandboxAtTurnEnd.mockImplementation(() =>
    Promise.resolve({ action: "hibernated" as const }),
  );
  spies.probeHeadlessRunGitFingerprint.mockImplementation(
    (): Promise<string | null> => Promise.resolve("fingerprint-const"),
  );
  spies.createArtifact.mockImplementation(
    async (input: Record<string, unknown>) => ({
      id: `artifact-${String(input.kind ?? "unknown")}`,
      ...input,
      createdAt: new Date("2026-06-20T12:00:00.000Z"),
      updatedAt: new Date("2026-06-20T12:00:00.000Z"),
    }),
  );
  spies.listArtifacts.mockResolvedValue([
    { kind: "research_packet", status: "available" },
    { kind: "spec", status: "available" },
  ]);
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

  test("regression: model runtime step does not return function-valued agent actions", async () => {
    // Workflow step return values are serialized. Returning proposeToolAction or
    // manageBackgroundAgentAction from resolveChatModelRuntime breaks production
    // chat runs before the agent can use the sandbox.
    const source = await Bun.file(new URL("chat.ts", import.meta.url)).text();
    const stepStart = source.indexOf("async function resolveChatModelRuntime");
    const helperStart = source.indexOf("type WorkflowActionAgentOptions");

    expect(stepStart).toBeGreaterThan(-1);
    expect(helperStart).toBeGreaterThan(stepStart);

    const modelRuntimeStepSource = source.slice(stepStart, helperStart);
    expect(modelRuntimeStepSource).toContain("actionResolution");
    expect(modelRuntimeStepSource).not.toContain("proposeToolAction");
    expect(modelRuntimeStepSource).not.toContain("manageBackgroundAgentAction");
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

  // TASK-1248: resolution must happen once for the whole run, not once per
  // agent step. Production evidence (issue #1248) showed 24 resolutions for a
  // 24-step run — each paying ~3 Composio HTTP round trips.
  test("TASK-1248 BT-1: resolves Composio tools once for a multi-step run, not once per step", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(makeOptions({ maxSteps: 2 }));

    expect(spies.resolveComposioToolsForChat).toHaveBeenCalledTimes(1);
  });

  test("TASK-1248 BT-2: reuses the same resolved Composio tool set across every step of a run", async () => {
    // Each invocation returns a DIFFERENT tool set (keyed by call count) so
    // this test can tell "resolved once and reused" apart from "resolved
    // fresh every step but happened to return an identical value" — a mock
    // that always returns the same object cannot distinguish those two.
    let callCount = 0;
    spies.resolveComposioToolsForChat.mockImplementation(async () => {
      callCount += 1;
      return {
        status: "ready" as const,
        tools: { [`COMPOSIO_TOOL_CALL_${callCount}`]: { description: "x" } },
        profile: null,
        composioSessionId: `composio-session-${callCount}`,
        configHash: `hash-${callCount}`,
        reusedSession: callCount > 1,
      };
    });
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(makeOptions({ maxSteps: 2 }));

    // Two agent steps ran (mirrors "records a 'progress' event for each step
    // in a multi-step run" above) and BOTH must have received the FIRST
    // resolution's tool set — proving the second step reused it instead of
    // triggering its own (second, differently-keyed) resolution.
    expect(agentStreamToolsCalls.length).toBe(2);
    expect(agentStreamToolsCalls[0]).toEqual({
      COMPOSIO_TOOL_CALL_1: { description: "x" },
    });
    expect(agentStreamToolsCalls[1]).toEqual({
      COMPOSIO_TOOL_CALL_1: { description: "x" },
    });
  });

  test("BT-CHAT-RP-001 (post-review, #799 contract gap): a partial repo-policy block on a READY outcome emits composio.repo_policy.blocked naming the dropped slug, tools still proceed", async () => {
    const composioTools = {
      COMPOSIO_SLACK_SEND_MESSAGE: { description: "Send a Slack message" },
    };
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => ({
      status: "ready" as const,
      tools: composioTools,
      profile: null,
      composioSessionId: "composio-session-rp-1",
      configHash: "hash-rp-1",
      reusedSession: false,
      repoPolicyBlocked: [{ slug: "gmail", reason: "repo_policy_blocked" }],
    }));

    await runAgentWorkflow(makeOptions());

    // Tools continue with the surviving slugs — non-fatal.
    expect(agentStreamTools).toEqual(composioTools);
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.repo_policy.blocked",
        status: "failed",
        summary:
          "Blocked toolkit for this repository: gmail (repo_policy_blocked).",
        payload: expect.objectContaining({
          blockedSlugs: ["gmail"],
          reasons: { gmail: "repo_policy_blocked" },
        }),
      }),
    );
  });

  test("BT-CHAT-RP-002 (post-review, #799 contract gap): an all-blocked OFF outcome emits composio.repo_policy.blocked naming every dropped slug", async () => {
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => ({
      status: "off" as const,
      repoPolicyBlocked: [
        { slug: "gmail", reason: "repo_policy_blocked" },
        { slug: "slack", reason: "not_in_repo_allowlist" },
      ],
    }));

    await runAgentWorkflow(makeOptions());

    expect(agentStreamTools).toBeUndefined();
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.repo_policy.blocked",
        status: "failed",
        summary:
          "Blocked toolkit for this repository: gmail (repo_policy_blocked), slack (not_in_repo_allowlist).",
        payload: expect.objectContaining({
          blockedSlugs: ["gmail", "slack"],
          reasons: {
            gmail: "repo_policy_blocked",
            slack: "not_in_repo_allowlist",
          },
        }),
      }),
    );
  });

  test("BT-CHAT-RP-003 (post-review, #799 contract gap): no repo_policy_blocked event when repoPolicyBlocked is absent (ordinary off, never configured)", async () => {
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => ({
      status: "off" as const,
    }));

    await runAgentWorkflow(makeOptions());

    expect(spies.emitSessionEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "composio.repo_policy.blocked",
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

  test("surfaces an already-final ComposioSetupError message verbatim, without double-wrapping it in generic setup copy", async () => {
    const setupError = new Error("Blocked toolkit for this repository: gmail.");
    setupError.name = "ComposioSetupError";
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => {
      throw setupError;
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Blocked toolkit for this repository: gmail.",
    );

    expect(agentInputMessages).toBeUndefined();
    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta: "Blocked toolkit for this repository: gmail.",
        },
      ]),
    );
    // Regression guard: the old code re-ran this final message through
    // getComposioUserFacingError's generic "unknown" branch, which appends
    // "Fix the Composio setup, then retry, or turn Tools off for this chat."
    // That must NOT happen when the error already carries a final message.
    expect(JSON.stringify(writtenChunks)).not.toContain(
      "Fix the Composio setup",
    );
  });

  test("surfaces a ComposioSetupError whose message falls outside the 6 specific errorKind branches verbatim, not re-wrapped with generic 'Fix the Composio setup' copy", async () => {
    // This message is a real ComposioSetupError text (from db/composio.ts's
    // profile-lookup path) that getComposioErrorKind classifies as
    // "composio_unknown" — proving the fix operates at the getSetupErrorMessage
    // level (name === "ComposioSetupError" short-circuit), not merely as a side
    // effect of a specific errorKind's copy already passing through as-is.
    const setupError = new Error(
      "The selected Composio profile no longer exists.",
    );
    setupError.name = "ComposioSetupError";
    spies.resolveComposioToolsForChat.mockImplementationOnce(async () => {
      throw setupError;
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "The selected Composio profile no longer exists.",
    );

    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        {
          type: "text-delta",
          id: "setup-error",
          delta: "The selected Composio profile no longer exists.",
        },
      ]),
    );
    expect(JSON.stringify(writtenChunks)).not.toContain(
      "Fix the Composio setup",
    );
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

  test("passes sandbox-free mode into agent options without sandbox-specific side effects", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(
      (params: { assistantId: string }) => {
        writtenChunks.push({ type: "start", messageId: params.assistantId });
        return Promise.resolve(createResolvedSandboxFreeRuntime());
      },
    );

    await runAgentWorkflow(makeOptions());

    expect(agentStreamOptions).toMatchObject({
      runtimeMode: "classic",
      sandboxFree: true,
      sandbox: {
        workingDirectory: "/",
      },
    });
    expect(spies.persistSandboxState).not.toHaveBeenCalled();
    expect(spies.refreshDiffCache).not.toHaveBeenCalled();
  });

  test("builds background-agent management hook in final agent options", async () => {
    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    expect(opts?.manageAgentEnabled).toBe(true);
    expect(typeof opts?.manageBackgroundAgentAction).toBe("function");
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

  test("records workflow artifacts after managed runtime completion", async () => {
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

    const artifactKinds = spies.createArtifact.mock.calls.map(
      ([input]) => (input as { kind: string }).kind,
    );

    expect(artifactKinds).toEqual([
      "research_packet",
      "spec",
      "receipt",
      "final_build_report",
    ]);
    expect(spies.listArtifacts).toHaveBeenCalledWith({
      workflowRunId: "wrun_test-123",
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
            workspaceMode: "isolated",
            completionPacketValidationStatus: "valid",
            completionPacketReasonCode: null,
            completionPacketSummary:
              "Applied the requested UI change and verified it.",
            changedFileCount: 2,
            verificationCount: 1,
            integrationReady: true,
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
          "Managed worker evidence recorded: executor completed in sandbox session_session-1 with 3 tool calls using isolated workspace policy; completion packet valid.",
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

  // DEFECT A regression: a fatally failed turn that produced no output must
  // persist an outcome marking the triggering request as abandoned. Without
  // this, the next user message — even an unrelated greeting — reads as
  // license to silently resume the failed request (production evidence: chat
  // itSZNUSgb_ikmPSnm7Ukm, issue #1133).
  test("marks a fatally failed, zero-output turn as abandoned on the persisted message", async () => {
    spies.resolveChatSandboxRuntime.mockImplementationOnce(async (params) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      throw new Error("Connect GitHub to access repositories");
    });

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Connect GitHub to access repositories",
    );

    expect(spies.persistAssistantMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        id: "gen-id-1",
        role: "assistant",
        metadata: expect.objectContaining({ abandoned: true }),
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

  test("surfaces the provider-rejection message for a wrapped non-retryable provider error, not the generic setup-failed fallback", async () => {
    // Mirrors how the AI SDK actually delivers a non-retryable APICallError to
    // this app's stream-error capture: wrapped as `.cause` on a generic Error
    // (e.g. NoOutputGeneratedError), not as the bare APICallError itself.
    const apiCallError = Object.assign(new Error("Bad Request"), {
      name: "AI_APICallError",
      statusCode: 400,
      responseBody:
        '{"error":{"message":"reasoning_content is not a valid field"}}',
    });
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.",
      { cause: apiCallError },
    );

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "The model provider rejected this request",
    );

    const setupErrorChunk = writtenChunks.find(
      (chunk) => chunk.type === "text-delta" && chunk.id === "setup-error",
    );
    expect(setupErrorChunk?.type).toBe("text-delta");
    if (setupErrorChunk?.type === "text-delta") {
      expect(setupErrorChunk.delta).not.toContain("Workspace setup failed");
      expect(setupErrorChunk.delta).toContain("HTTP 400");
      expect(setupErrorChunk.delta).toContain("reasoning_content");
      expect(setupErrorChunk.delta).toContain(
        "switch back to the model that last worked",
      );
    }
  });

  test("leaves a wrapped 401 on the normal (non-fatal) error path", async () => {
    // 401 is deliberately excluded from the non-retryable set — it gets its
    // own auth guidance elsewhere, and must not be short-circuited into the
    // provider-rejection message just because it arrives wrapped the same way.
    const apiCallError = Object.assign(new Error("Unauthorized"), {
      name: "AI_APICallError",
      statusCode: 401,
      responseBody: '{"error":{"message":"Invalid API key"}}',
    });
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.",
      { cause: apiCallError },
    );

    await expect(runAgentWorkflow(makeOptions())).rejects.toThrow(
      "Provider error",
    );

    const setupErrorChunk = writtenChunks.find(
      (chunk) => chunk.type === "text-delta" && chunk.id === "setup-error",
    );
    if (setupErrorChunk?.type === "text-delta") {
      expect(setupErrorChunk.delta).not.toContain(
        "The model provider rejected this request",
      );
    }
  });

  test("persists assistant message after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistAssistantMessage).toHaveBeenCalledTimes(1);
    const paCalls = spies.persistAssistantMessage.mock.calls as unknown[][];
    expect(paCalls[0][0]).toBe("chat-1");
  });

  // DEFECT A regression counterpart: a normal, successful turn must not be
  // marked abandoned. Only a fatally failed, zero-output turn sets this flag.
  test("does not mark a normal successful turn as abandoned", async () => {
    await runAgentWorkflow(makeOptions());

    const paCalls = spies.persistAssistantMessage.mock.calls as Array<
      [string, { metadata?: { abandoned?: boolean } }]
    >;
    for (const [, message] of paCalls) {
      expect(message.metadata?.abandoned).not.toBe(true);
    }
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

  test("marks workflow run max_steps when maxSteps is exhausted (#1241)", async () => {
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
    // #1241: a deliberate stop is filed under its own name, distinct from a
    // genuine crash, so get_session's lastRunOutcome can tell them apart.
    expect(workflowRun.status).toBe("max_steps");
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

  test("threads the selected model custom system prompt into agent options", async () => {
    testChatRecord.modelId = "openai/gpt-5.4";
    testPreferences.modelSystemPrompts = {
      "openai/gpt-5.4": "Prefer compact model-specific updates.",
    };

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    expect(opts?.modelSystemPrompt).toBe(
      "Prefer compact model-specific updates.",
    );
  });

  // Regression for a #1230 follow-up defect: `agentOptions: { ...modelRuntime.agentOptions, ...options.agentOptions }`
  // is a shallow spread, so a caller-supplied customInstructions (e.g. the MCP
  // headless instructions) wholesale replaced assistantFileLinkPrompt instead
  // of composing with it — every MCP-started run silently lost the file-link
  // instruction. The fix must compose (base first, caller's second), not
  // clobber.
  test("composes a caller-supplied customInstructions with the base file-link prompt instead of replacing it", async () => {
    const { assistantFileLinkPrompt } =
      await import("@/lib/assistant-file-links");
    const callerInstructions =
      "You are running headless: no human is watching this session.";

    await runAgentWorkflow(
      makeOptions({
        agentOptions: { customInstructions: callerInstructions },
      }),
    );

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const customInstructions = opts?.customInstructions as string | undefined;
    expect(customInstructions).toContain(assistantFileLinkPrompt);
    expect(customInstructions).toContain(callerInstructions);
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
    expect(roster?.executor).toMatchObject({
      modelSelection: { id: "openai/gpt-5.4" },
    });
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
      modelSelection: { id: "openai/gpt-5.4" },
      instructions: "Focus on reading, not writing.",
    });
  });

  // #1157 guard (a): a plain gateway roster id (no inferenceProfileId) must be
  // left completely alone — never handed to a profile resolver. Handing it to
  // the resolver would call a custom endpoint with a model it does not serve.
  test("regression: BT-ROSTER-REG-002 a plain-gateway DB row roster override is never sent through the profile resolver", async () => {
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "executor") {
          return {
            ...makeSyntheticResolvedAgent(
              "executor",
              "anthropic/claude-opus-4",
            ),
            fromDbRow: true,
            inferenceProfileId: null,
          };
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const roster = opts?.subagentRoster as Record<string, unknown> | undefined;
    expect(roster?.executor).toEqual({
      modelSelection: { id: "anthropic/claude-opus-4" },
    });
    expect(spies.getInferenceProfileByIdForUser).not.toHaveBeenCalled();
  });

  // #1157 guard (b): a roster entry with its own inference profile must
  // resolve through THAT profile (never the main model's, never dropped) and
  // end up carrying real provider routing (directInference), not a bare id.
  test("regression: BT-ROSTER-REG-003 a profile-bound DB row resolves through its OWN inference profile into modelSelection", async () => {
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "executor") {
          return {
            ...makeSyntheticResolvedAgent(
              "executor",
              "anthropic/claude-opus-4",
            ),
            fromDbRow: true,
            inferenceProfileId: "profile-executor-own",
            instructions: "Be careful with credentials.",
          };
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const roster = opts?.subagentRoster as Record<string, unknown> | undefined;
    const executorEntry = roster?.executor as
      | { modelSelection?: AgentModelSelection; instructions?: string }
      | undefined;

    expect(executorEntry?.instructions).toBe("Be careful with credentials.");
    expect(executorEntry?.modelSelection).toMatchObject({
      directInference: expect.objectContaining({
        provider: "anthropic",
        apiKey: "decrypted-test-key",
      }),
      attribution: expect.objectContaining({
        inferenceRoute: "user",
        inferenceProfileId: "profile-executor-own",
      }),
    });
    // Resolved through this role's OWN profile id, not the main model's
    // (which has none configured in this test) and not a different role's.
    expect(spies.getInferenceProfileByIdForUser).toHaveBeenCalledWith(
      "user-1",
      "profile-executor-own",
    );
  });

  test("regression: BT-ROSTER-REG-004 a profile-bound roster override that fails to resolve drops the override and emits a structured session event, not a console.warn", async () => {
    spies.getInferenceProfileByIdForUser.mockImplementationOnce(
      async () => null,
    );
    resolveAgentForRoleSpy.mockImplementation(
      async (params: { role: string }) => {
        if (params.role === "executor") {
          return {
            ...makeSyntheticResolvedAgent(
              "executor",
              "anthropic/claude-opus-4",
            ),
            fromDbRow: true,
            inferenceProfileId: "profile-deleted",
          };
        }
        return makeSyntheticResolvedAgent(params.role);
      },
    );

    await runAgentWorkflow(makeOptions());

    const opts = agentStreamOptions as Record<string, unknown> | undefined;
    const roster = opts?.subagentRoster as Record<string, unknown> | undefined;
    // No other field is set for this role, so once the override is dropped no
    // roster entry should be emitted at all — the role inherits the default
    // subagent model instead.
    expect(roster?.executor).toBeUndefined();
    expect(spies.emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "workflow.subagent-roster.profile-fallback",
        status: "info",
        payload: expect.objectContaining({
          role: "executor",
          inferenceProfileId: "profile-deleted",
        }),
      }),
    );
  });

  // #1143 / #1142. The reported incident: a chat turn spent 9 steps and 69.5s
  // re-running a `task` call that failed identically every time, and ended only
  // by exhausting its step budget. Nothing noticed.
  describe("repeated tool failure circuit breaker", () => {
    // The file-wide beforeEach never restores `resolveChatSandboxRuntime`, and
    // earlier tests queue `mockImplementationOnce` behaviors that may go
    // unconsumed. Pin a known sandbox runtime so these multi-step assertions are
    // not decided by whatever an earlier test left in the queue.
    beforeEach(() => {
      spies.resolveChatSandboxRuntime.mockReset();
      spies.resolveChatSandboxRuntime.mockImplementation(
        (params: { assistantId: string }) => {
          writtenChunks.push({ type: "start", messageId: params.assistantId });
          return Promise.resolve(createResolvedChatSandboxRuntime());
        },
      );
    });

    function failingToolPart(
      toolName: string,
      errorText: string,
      toolCallId = "call-1",
    ) {
      return {
        type: `tool-${toolName}`,
        toolCallId,
        state: "output-error",
        preliminary: false,
        input: { task: "List repository files" },
        errorText,
      };
    }

    // Spy history is not cleared between tests in this file, so read the most
    // recent call rather than the first.
    function stepCount() {
      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
      };
      return workflowRun.stepTimings.length;
    }

    // Each step issues a genuinely new tool call, so the ids differ even when the
    // failure is identical. That is what the incident looked like, and it is what
    // keeps "three failures" distinct from "one failure re-read three times".
    function failEveryStep(
      errorText: (call: number) => string,
      toolName = "task",
    ) {
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [failingToolPart(toolName, errorText(call), `call-${call}`)];
      };
    }

    test("stops the turn after three identical tool failures instead of reaching the step cap", async () => {
      agentFinishReason = "tool-calls";
      failEveryStep(() => "No output generated. Check the stream for errors.");

      await runAgentWorkflow(makeOptions({ maxSteps: 9 }));

      expect(stepCount()).toBe(3);
    });

    test("tells the user which tool failed, how it failed, and how many times", async () => {
      agentFinishReason = "tool-calls";
      failEveryStep(
        () => 'subagent_model_failed: model "gemma-4-31b" is unreachable',
      );

      await runAgentWorkflow(makeOptions({ maxSteps: 9 }));

      const persistCalls = spies.persistAssistantMessage.mock
        .calls as unknown[][];
      const persisted = persistCalls.at(-1)?.[1] as {
        parts: Array<{ type: string; text?: string }>;
      };
      const text = persisted.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");

      expect(text).toContain("task");
      expect(text).toContain("gemma-4-31b");
      expect(text).toContain("3");
    });

    // R5 — over-correction guards. A breaker that kills legitimate retries is a
    // worse bug than the one it replaces.
    test("must stay green: a tool that fails once then succeeds is not stopped", async () => {
      agentFinishReason = "tool-calls";
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return call === 1
          ? [failingToolPart("task", "transient blip", "call-1")]
          : [
              {
                type: "tool-task",
                toolCallId: `call-${call}`,
                state: "output-available",
                preliminary: false,
                input: { task: "List repository files" },
                output: { final: [] },
              },
            ];
      };

      await runAgentWorkflow(makeOptions({ maxSteps: 5 }));

      expect(stepCount()).toBe(5);
    });

    test("must stay green: the same tool failing three different ways is not stopped", async () => {
      agentFinishReason = "tool-calls";
      failEveryStep((call) => `failure variant ${call}`);

      await runAgentWorkflow(makeOptions({ maxSteps: 5 }));

      expect(stepCount()).toBe(5);
    });

    // Regression: this previously used maxSteps 4, so the loop ended at 4
    // whether or not the breaker fired — it could not tell the two apart and
    // passed vacuously. The reused detector's cycle arm treats
    // task/A, bash/B, task/A, bash/B as a period-2 cycle and DID stop the turn,
    // contradicting the documented "three identical failures in a row"
    // contract. maxSteps must exceed the step a cycle would trip at.
    test("must stay green: two tools alternating failures is not stopped", async () => {
      agentFinishReason = "tool-calls";
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          failingToolPart(
            call % 2 === 1 ? "task" : "bash",
            "same message",
            `call-${call}`,
          ),
        ];
      };

      await runAgentWorkflow(makeOptions({ maxSteps: 8 }));

      expect(stepCount()).toBe(8);
    });

    // Regression: external tools arrive as `dynamic-tool` parts carrying their
    // real identity in `part.toolName`. Naming them by `part.type` collapsed
    // every one to "dynamic-tool", so three different external tools returning
    // the same generic error looked like one tool failing three times.
    test("must stay green: three external tools failing alike is not stopped", async () => {
      agentFinishReason = "tool-calls";
      const toolNames = ["COMPOSIO_LINEAR", "COMPOSIO_SLACK", "GITHUB_ISSUES"];
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "dynamic-tool",
            toolName: toolNames[(call - 1) % toolNames.length],
            toolCallId: `call-${call}`,
            state: "output-error",
            preliminary: false,
            input: {},
            errorText: "Request failed",
          },
        ];
      };

      await runAgentWorkflow(makeOptions({ maxSteps: 6 }));

      expect(stepCount()).toBe(6);
    });

    test("names the real external tool when one dynamic tool keeps failing", async () => {
      agentFinishReason = "tool-calls";
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "dynamic-tool",
            toolName: "COMPOSIO_LINEAR",
            toolCallId: `call-${call}`,
            state: "output-error",
            preliminary: false,
            input: {},
            errorText: "Request failed",
          },
        ];
      };

      await runAgentWorkflow(makeOptions({ maxSteps: 9 }));

      expect(stepCount()).toBe(3);

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (entry) =>
          entry[0] as { eventName?: string; payload?: Record<string, unknown> },
      );
      const repeated = emitted.findLast(
        (event) => event.eventName === "workflow.tool.repeated-failure",
      );

      expect(repeated?.payload).toMatchObject({ toolName: "COMPOSIO_LINEAR" });
    });

    test("emits workflow.tool.repeated-failure with correlation fields", async () => {
      agentFinishReason = "tool-calls";
      failEveryStep(() => "No output generated.");

      await runAgentWorkflow(makeOptions({ maxSteps: 9 }));

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call) =>
          call[0] as { eventName?: string; payload?: Record<string, unknown> },
      );
      const repeated = emitted.find(
        (event) => event.eventName === "workflow.tool.repeated-failure",
      );

      expect(repeated).toBeDefined();
      expect(repeated?.payload).toMatchObject({
        toolName: "task",
        failureCount: 3,
        reason: "repeat",
      });
    });

    test("says delegation was the only execution path in managed_runtime mode", async () => {
      agentFinishReason = "tool-calls";
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
      failEveryStep(() => "No output generated.");

      await runAgentWorkflow(makeOptions({ maxSteps: 9 }));

      const persistCalls = spies.persistAssistantMessage.mock
        .calls as unknown[][];
      const persisted = persistCalls.at(-1)?.[1] as {
        parts: Array<{ type: string; text?: string }>;
      };
      const text = persisted.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");

      expect(text).toContain("only");
    });
  });

  // #1231: this describe block MUST stay before "recordGoalLedgerClose uses
  // 'canceled' status when workflow is aborted" (below) and every other test
  // that calls `mock.module("@/app/config", ...)`. Those calls permanently
  // replace the module for the rest of this file's single test process — a
  // test placed after one silently inherits its (often broken-on-purpose)
  // agent mock instead of the default `webAgent.stream` set up at the top of
  // this file. See "still clears stream and sends finish even on step error".
  describe("headless MCP run bounding and hibernation (#1231)", () => {
    // #1231 test-cost note: chat.ts's per-step `startStopMonitor` always
    // waits out one real 150ms poll cycle before a step's `finally` block
    // returns (see `runAgentStep`'s `await stopMonitor.done`), so a step loop
    // costs roughly step-count × 150ms even fully mocked — actually driving
    // this run to 501 steps would take over a minute. The behavioral proof
    // that matters is split instead: `lib/chat/start-run.test.ts` proves
    // headless callers no longer get the old hardcoded `maxSteps: 500`
    // default, and this test proves the SEPARATE new mechanism (the
    // no-progress fuse) does not stop a genuinely progressing run — it keeps
    // going well past its own default stale-step budget, which is the only
    // thing left that could bound a headless run now that the fixed cap is
    // gone.
    test("does not stop a headless run merely because it has taken more steps than the no-progress budget allows, as long as the workspace keeps changing", async () => {
      const { DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS } =
        await import("@/lib/chat/headless-progress-budget");
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      const STOP_AT_STEP = DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS + 10;
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [{ type: "text", text: `step ${call}` }];
      };
      // A fresh fingerprint on every probe — the workspace is always
      // "changing", so the no-progress fuse never trips.
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => {
          const fingerprint = `fingerprint-${call}`;
          if (call >= STOP_AT_STEP) {
            agentFinishReason = "stop";
          }
          return Promise.resolve(fingerprint);
        },
      );

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      expect(workflowRun.stepTimings.length).toBeGreaterThan(
        DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
      );
      expect(workflowRun.status).toBe("completed");
    }, 15_000);

    // #1242 regression against the production incident: a read-only run
    // (analysis, review, search, reporting) never changes the git tree by
    // definition, so the fuse must not judge it on git delta alone. Distinct
    // tool-call activity every step (varying input — "review a different PR
    // each time") is a second signal that keeps the run alive well past the
    // old git-only budget.
    test("does not stop a headless run with no git delta as long as tool-call activity keeps varying (#1242)", async () => {
      const { DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS } =
        await import("@/lib/chat/headless-progress-budget");
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      // The workspace never changes — this run is read-only.
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      const STOP_AT_STEP = DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS + 10;
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        if (call >= STOP_AT_STEP) {
          agentFinishReason = "stop";
        }
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { task: `Review PR #${call}` },
            output: { final: [] },
          },
        ];
      };

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      expect(workflowRun.stepTimings.length).toBeGreaterThan(
        DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
      );
      expect(workflowRun.status).toBe("completed");
    }, 15_000);

    // #1242 regression (observability angle): the issue requires "a log
    // line, the transcript, and the API read must never disagree about why
    // a run ended". Distinct from the behavioral test above (which checks
    // the persisted workflowRun.status) — this checks that a read-only run
    // NEVER emits the fuse's `workflow.failed`/no-progress observability
    // trail at all, and that `mcp.run.bounded` logs "completed", not
    // "no_progress". On the pre-fix (git-delta-only) fuse this run trips at
    // DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS and both of these would fire —
    // this test would fail if the #1242 fix were reverted.
    test("regression: a read-only run with varying tool-call activity never emits the no-progress fuse's observability trail (#1242)", async () => {
      const { DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS } =
        await import("@/lib/chat/headless-progress-budget");
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      const STOP_AT_STEP = DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS + 10;
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        if (call >= STOP_AT_STEP) {
          agentFinishReason = "stop";
        }
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { task: `Review PR #${call}` },
            output: { final: [] },
          },
        ];
      };
      const infoSpy = spyOn(console, "info").mockImplementation(
        () => undefined,
      );

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call_) =>
          call_[0] as {
            eventName?: string;
            payload?: Record<string, unknown>;
          },
      );
      expect(
        emitted.find((event) => event.eventName === "workflow.failed"),
      ).toBeUndefined();

      const boundedCall = infoSpy.mock.calls.find((args) =>
        String(args[1]).includes('"event":"mcp.run.bounded"'),
      );
      expect(boundedCall).toBeDefined();
      expect(String(boundedCall?.[1])).toContain('"reason":"completed"');
      expect(String(boundedCall?.[1])).not.toContain('"reason":"no_progress"');

      infoSpy.mockRestore();
    }, 15_000);

    // #1242 wedge contract: a run that keeps calling the SAME tool with the
    // SAME input (no git delta, no varying activity) is the genuine wedge
    // the fuse must still bound — the epic's read-only use case must not
    // reopen the runaway-cost risk #1231 closed.
    test("stops a headless run that repeats an identical tool call with no varying activity (#1242)", async () => {
      const { DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS } =
        await import("@/lib/chat/headless-progress-budget");
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { task: "List repository files" },
            output: { final: [] },
          },
        ];
      };

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      // A window+detectRepetition trailing-repeat check flags once the
      // window holds DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS identical
      // fingerprints — no separate "seed the baseline" step, unlike the old
      // adjacent-comparison budget.
      expect(workflowRun.stepTimings.length).toBe(
        DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
      );
      expect(workflowRun.status).toBe("no_progress_fuse");

      // The stop message must name the SPECIFIC pattern that fired — an
      // identical tool call repeated, not the generic "workspace changes"
      // wording, since this run's tool calls (not the git tree) are what
      // stayed flat.
      const textDeltas = writtenChunks
        .filter(
          (chunk): chunk is { type: "text-delta"; id: string; delta: string } =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join("");
      expect(textDeltas.toLowerCase()).toContain("same tool call");
    }, 10_000);

    // #1242 follow-up wedge contract: alternating between two DISTINCT read
    // calls ("read file A, read file B, repeat") produces a combined
    // fingerprint that differs every step, so the adjacent-only comparison
    // this closes never caught it — and for a headless run that is
    // unbounded (maxSteps is undefined by design, #1231), so nothing else
    // would stop it before the 90-minute sandbox ceiling.
    test("stops a headless run alternating between two distinct tool calls (A/B/A/B cycle) (#1242)", async () => {
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { file: call % 2 === 1 ? "A" : "B" },
            output: { final: [] },
          },
        ];
      };

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      expect(workflowRun.status).toBe("no_progress_fuse");
      // Bounded well before the plain stale-step limit would have caught it
      // (an alternating pair never repeats identically turn-to-turn).
      expect(workflowRun.stepTimings.length).toBeLessThan(10);

      const textDeltas = writtenChunks
        .filter(
          (chunk): chunk is { type: "text-delta"; id: string; delta: string } =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join("");
      expect(textDeltas.toLowerCase()).toContain("repeating");
    }, 10_000);

    // #1242 follow-up: the same wedge shape with a 3-call block (A/B/C
    // repeating) — proves the cycle search isn't hardcoded to period 2.
    test("stops a headless run cycling through a three-call pattern (#1242)", async () => {
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      const files = ["A", "B", "C"];
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { file: files[(call - 1) % files.length] },
            output: { final: [] },
          },
        ];
      };

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      expect(workflowRun.status).toBe("no_progress_fuse");
      expect(workflowRun.stepTimings.length).toBeLessThan(12);
    }, 10_000);

    // #1242 follow-up regression (observability angle, mirrors a9f20a61's
    // discipline for the round-1 fix): distinct from the two behavioral
    // tests above, which check the persisted workflowRun.status — this
    // checks that the A/B/A/B cycle wedge emits the SAME observability
    // trail a strict repeat does (workflow.failed + mcp.run.bounded
    // reason "no_progress"), and that the message specifically says
    // "repeating" rather than the stalled-tree wording. On the pre-cycle-
    // detection code this run never stops at all (unbounded — no
    // workflow.failed event, no "no_progress" log line ever fires), so this
    // test would fail if the cycle-detection fix were reverted.
    test("regression: an A/B/A/B cycle wedge emits the same observability trail as a strict repeat, with a distinct message (#1242)", async () => {
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      let call = 0;
      agentAssistantPartsFactory = () => {
        call += 1;
        return [
          {
            type: "tool-task",
            toolCallId: `call-${call}`,
            state: "output-available",
            preliminary: false,
            input: { file: call % 2 === 1 ? "A" : "B" },
            output: { final: [] },
          },
        ];
      };
      const infoSpy = spyOn(console, "info").mockImplementation(
        () => undefined,
      );

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call_) =>
          call_[0] as {
            eventName?: string;
            payload?: Record<string, unknown>;
          },
      );
      const failedEvent = emitted.findLast(
        (event) => event.eventName === "workflow.failed",
      );
      expect(failedEvent?.payload).toMatchObject({
        stopReason: "no_progress_fuse",
      });

      const boundedCall = infoSpy.mock.calls.find((args) =>
        String(args[1]).includes('"event":"mcp.run.bounded"'),
      );
      expect(boundedCall).toBeDefined();
      expect(String(boundedCall?.[1])).toContain('"reason":"no_progress"');

      const textDeltas = writtenChunks
        .filter(
          (chunk): chunk is { type: "text-delta"; id: string; delta: string } =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join("");
      expect(textDeltas.toLowerCase()).toContain("repeating");
      expect(textDeltas.toLowerCase()).not.toContain(
        "no workspace changes or new tool-call activity",
      );

      infoSpy.mockRestore();
    }, 10_000);

    // Real per-step cost (~150ms, see the note above) × 21 steps ≈ 3s —
    // comfortably under the default 5s timeout, but a generous explicit
    // timeout keeps this from flaking on a slower CI runner.
    test("stops a headless run once the no-progress budget is exhausted, with a legible reason", async () => {
      const { DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS } =
        await import("@/lib/chat/headless-progress-budget");
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";
      // The workspace never changes — every probe returns the same fingerprint.
      spies.probeHeadlessRunGitFingerprint.mockImplementation(
        (): Promise<string | null> => Promise.resolve("frozen-fingerprint"),
      );
      const infoSpy = spyOn(console, "info").mockImplementation(
        () => undefined,
      );

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      // The fuse trips once the trailing window holds
      // DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS identical combined fingerprints.
      expect(workflowRun.stepTimings.length).toBe(
        DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
      );
      // #1241: filed under its own name, not the generic "failed" a crash
      // gets — get_session's lastRunOutcome depends on this distinction.
      expect(workflowRun.status).toBe("no_progress_fuse");

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call) =>
          call[0] as {
            eventName?: string;
            payload?: Record<string, unknown>;
          },
      );
      const failedEvent = emitted.findLast(
        (event) => event.eventName === "workflow.failed",
      );
      expect(failedEvent?.payload).toMatchObject({
        stopReason: "no_progress_fuse",
      });

      // The blocked/fused ending must be legible to a reading agent — a
      // sentence, not a bare code.
      const textDeltas = writtenChunks
        .filter(
          (chunk): chunk is { type: "text-delta"; id: string; delta: string } =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join("");
      expect(textDeltas.toLowerCase()).toContain("stopped");

      // Observability: mcp.run.bounded with reason "no_progress".
      const boundedCall = infoSpy.mock.calls.find((args) =>
        String(args[1]).includes('"event":"mcp.run.bounded"'),
      );
      expect(boundedCall).toBeDefined();
      expect(String(boundedCall?.[1])).toContain('"reason":"no_progress"');

      infoSpy.mockRestore();
    }, 10_000);

    test("hibernates the sandbox only after the active-stream slot is released", async () => {
      const callOrder: string[] = [];
      spies.clearActiveStream.mockImplementationOnce(async () => {
        callOrder.push("clearActiveStream");
      });
      spies.hibernateHeadlessSandboxAtTurnEnd.mockImplementationOnce(
        async () => {
          callOrder.push("hibernate");
          return { action: "hibernated" as const };
        },
      );

      await runAgentWorkflow(
        makeOptions({
          agentOptions: { unattended: true },
          maxSteps: undefined,
        }),
      );

      expect(callOrder).toEqual(["clearActiveStream", "hibernate"]);
      expect(spies.hibernateHeadlessSandboxAtTurnEnd).toHaveBeenCalledWith({
        sessionId: "session-1",
        sandboxName: "session_session-1",
      });
    });

    // A headless send_message to a no-repo session (createSessionCore sets
    // sandboxState: null when there is no repo — create-session.ts:186) has
    // no sandbox to probe: every fingerprint would be null, and the
    // no-progress budget treats null as "unknown, not stale" forever. Without
    // a fallback, that run is unbounded AND unfused — the exact runaway-cost
    // outcome the issue says must not ship. This is that fallback.
    test("stops a headless run with no sandbox at the fixed fallback cap, with a distinct legible reason", async () => {
      const noSandboxCapEnvKey = "HEADLESS_RUN_NO_SANDBOX_STEP_CAP";
      const originalCap = process.env[noSandboxCapEnvKey];
      process.env[noSandboxCapEnvKey] = "3";

      spies.resolveChatSandboxRuntime.mockImplementationOnce(
        (params: { assistantId: string }) => {
          writtenChunks.push({ type: "start", messageId: params.assistantId });
          return Promise.resolve(createResolvedSandboxFreeRuntime());
        },
      );
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";

      try {
        await runAgentWorkflow(
          makeOptions({
            agentOptions: { unattended: true },
            maxSteps: undefined,
          }),
        );
      } finally {
        if (originalCap === undefined) {
          delete process.env[noSandboxCapEnvKey];
        } else {
          process.env[noSandboxCapEnvKey] = originalCap;
        }
      }

      // No sandbox ever existed, so the git-fingerprint probe must never run.
      expect(spies.probeHeadlessRunGitFingerprint).not.toHaveBeenCalled();

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      expect(workflowRun.stepTimings).toHaveLength(3);
      // #1241: distinct from "no_progress_fuse" and from a genuine crash.
      expect(workflowRun.status).toBe("no_sandbox_step_cap");

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call) =>
          call[0] as {
            eventName?: string;
            payload?: Record<string, unknown>;
          },
      );
      const failedEvent = emitted.findLast(
        (event) => event.eventName === "workflow.failed",
      );
      // Distinct from "no_progress_fuse": this run was never probed at all.
      expect(failedEvent?.payload).toMatchObject({
        stopReason: "no_sandbox_step_cap",
      });

      const textDeltas = writtenChunks
        .filter(
          (chunk): chunk is { type: "text-delta"; id: string; delta: string } =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join("");
      expect(textDeltas.toLowerCase()).toContain("stopped");
    });

    // Regression: a browser-started run (the default `agentOptions: {}` from
    // makeOptions, matching the real chat route's payload — see
    // start-run.test.ts's "regression: the browser chat route's workflow
    // payload is unchanged") must keep its exact pre-#1231 behavior. This
    // would fail if `isHeadlessRun` ever became true for a run that didn't
    // opt into `unattended: true`, or if the fuse/hibernate calls stopped
    // being gated by it.
    test("regression: a browser-started run never probes or hibernates, and keeps its fixed step cap", async () => {
      agentFinishReason = "tool-calls";
      agentRawFinishReason = "provider_tool_use";

      await runAgentWorkflow(makeOptions({ maxSteps: 2 }));

      expect(spies.probeHeadlessRunGitFingerprint).not.toHaveBeenCalled();
      expect(spies.hibernateHeadlessSandboxAtTurnEnd).not.toHaveBeenCalled();

      const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
      const workflowRun = rwCalls.at(-1)?.[5] as {
        stepTimings: Array<{ stepNumber: number }>;
        status: string;
      };
      // Unchanged from before #1231: maxSteps:2 still exhausts the run.
      expect(workflowRun.stepTimings).toHaveLength(2);
      // #1241: workflowRuns.status now names the specific stop reason
      // instead of the generic "failed" — this run is a browser-started
      // regression case, not headless, but maxSteps exhaustion applies
      // either way.
      expect(workflowRun.status).toBe("max_steps");

      const emitted = (spies.emitSessionEvent.mock.calls as unknown[][]).map(
        (call) =>
          call[0] as {
            eventName?: string;
            payload?: Record<string, unknown>;
          },
      );
      const failedEvent = emitted.findLast(
        (event) => event.eventName === "workflow.failed",
      );
      expect(failedEvent?.payload).toMatchObject({ stopReason: "max_steps" });
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
