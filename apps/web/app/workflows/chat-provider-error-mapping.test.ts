import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// ── Spy state ──────────────────────────────────────────────────────

const writtenChunks: UIMessageChunk[] = [];
let runStatus: string = "running";

// Controls what error webAgent.stream throws (null = no throw, uses default stub)
let agentStreamError: Error | null = null;

const spies = {
  persistUserMessage: mock(() => Promise.resolve()),
  persistAssistantMessageWithToolResults: mock(() => Promise.resolve()),
  persistAssistantMessage: mock(() => Promise.resolve()),
  persistSandboxState: mock(() => Promise.resolve()),
  resolveChatSandboxRuntime: mock((params: { assistantId: string }) => {
    writtenChunks.push({ type: "start", messageId: params.assistantId });
    return Promise.resolve({
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
      sessionTitle: "Test Session",
      repoOwner: "acme",
      repoName: "repo",
    });
  }),
  claimActiveStream: mock(() => Promise.resolve("claimed")),
  closeStream: mock((writable: WritableStream<UIMessageChunk>) =>
    writable.close(),
  ),
  clearActiveStream: mock(() => Promise.resolve()),
  sendFinish: mock(async (writable: WritableStream<UIMessageChunk>) => {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "finish", finishReason: "stop" });
    } finally {
      writer.releaseLock();
    }
  }),
  recordWorkflowUsage: mock(() => Promise.resolve()),
  refreshDiffCache: mock(() => Promise.resolve()),
  refreshLifecycleActivity: mock(() => Promise.resolve()),
  hasAutoCommitChangesStep: mock(() => Promise.resolve(false)),
  runAutoCommitStep: mock(() =>
    Promise.resolve({ committed: false, pushed: false }),
  ),
  runAutoCreatePrStep: mock(() =>
    Promise.resolve({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "no commit",
    }),
  ),
  emitSessionEvent: mock(() => Promise.resolve(null)),
  resolveComposioToolsForChat: mock(async () => ({ status: "off" as const })),
  listManagedServices: mock(async () => []),
  listManagedBrowserRuns: mock(async () => []),
  recordGoalLedgerStart: mock(() => Promise.resolve("goal-provider-test")),
  recordGoalLedgerEvent: mock(() => Promise.resolve()),
  recordGoalLedgerClose: mock(() => Promise.resolve()),
};

// ── Module mocks ───────────────────────────────────────────────────

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_provider-test" }),
  getWritable: () =>
    new WritableStream<UIMessageChunk>({
      write(chunk) {
        writtenChunks.push(chunk);
      },
    }),
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
    stream: async () => {
      if (agentStreamError) {
        throw agentStreamError;
      }
      throw new Error(
        "agent stream should not be called without a configured error",
      );
    },
  },
}));

mock.module("ai", () => ({
  convertToModelMessages: async (msgs: Array<Record<string, unknown>>) =>
    msgs.map((m) => ({ role: m.role, content: [] })),
  generateId: () => "gen-id-provider",
  isToolUIPart: () => false,
  pruneMessages: ({ messages }: { messages: Array<Record<string, unknown>> }) =>
    messages,
}));

mock.module("@open-agents/agent", () => ({
  toAnthropicDirectModelId: (_id: string) => null,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => ({
    id: "chat-1",
    sessionId: "session-1",
    modelId: "anthropic/claude-sonnet",
    // No inference profile so resolveStepInferenceProfileModel is not called
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
    defaultModelId: "anthropic/claude-sonnet",
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
  // No inference profile used in these tests — provider errors come from the
  // agent stream itself, not from key decryption.
  getInferenceProfileByIdForUser: async () => null,
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

mock.module("@/lib/workflows/goal-ledger-recorder", () => ({
  recordGoalLedgerStart: spies.recordGoalLedgerStart,
  recordGoalLedgerEvent: spies.recordGoalLedgerEvent,
  recordGoalLedgerClose: spies.recordGoalLedgerClose,
}));

mock.module("@/lib/workflows/goal-validation", () => ({
  validateGoalCompletion: () => ({ ok: true }),
}));

const { runAgentWorkflow } = await import("./chat");

function makeOptions() {
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
    maxSteps: 1,
  } as Parameters<typeof runAgentWorkflow>[0];
}

// Helper to extract the setup-error delta from written chunks
function getSetupErrorDelta(): string | undefined {
  const errorChunk = writtenChunks.find(
    (chunk) =>
      chunk.type === "text-delta" &&
      "id" in chunk &&
      chunk.id === "setup-error",
  );
  return (errorChunk as { delta?: string } | undefined)?.delta;
}

beforeEach(() => {
  writtenChunks.length = 0;
  runStatus = "running";
  agentStreamError = null;
  for (const spy of Object.values(spies)) {
    spy.mockClear();
  }
  spies.resolveComposioToolsForChat.mockImplementation(async () => ({
    status: "off" as const,
  }));
  spies.claimActiveStream.mockImplementation(() => Promise.resolve("claimed"));
  spies.emitSessionEvent.mockImplementation(() => Promise.resolve(null));
  spies.recordGoalLedgerStart.mockImplementation(() =>
    Promise.resolve("goal-provider-test"),
  );
  spies.recordGoalLedgerEvent.mockImplementation(() => Promise.resolve());
  spies.recordGoalLedgerClose.mockImplementation(() => Promise.resolve());
  spies.persistAssistantMessage.mockImplementation(() => Promise.resolve());
  spies.persistUserMessage.mockImplementation(() => Promise.resolve());
  spies.persistAssistantMessageWithToolResults.mockImplementation(() =>
    Promise.resolve(),
  );
  spies.recordWorkflowUsage.mockImplementation(() => Promise.resolve());
  spies.clearActiveStream.mockImplementation(() => Promise.resolve());
  spies.sendFinish.mockImplementation(
    async (writable: WritableStream<UIMessageChunk>) => {
      const writer = writable.getWriter();
      try {
        await writer.write({ type: "finish", finishReason: "stop" });
      } finally {
        writer.releaseLock();
      }
    },
  );
  spies.closeStream.mockImplementation(
    (writable: WritableStream<UIMessageChunk>) => writable.close(),
  );
  spies.resolveChatSandboxRuntime.mockImplementation(
    (params: { assistantId: string }) => {
      writtenChunks.push({ type: "start", messageId: params.assistantId });
      return Promise.resolve({
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
        sessionTitle: "Test Session",
        repoOwner: "acme",
        repoName: "repo",
      });
    },
  );
  spies.hasAutoCommitChangesStep.mockImplementation(() =>
    Promise.resolve(false),
  );
  spies.listManagedServices.mockImplementation(async () => []);
  spies.listManagedBrowserRuns.mockImplementation(async () => []);
});

describe("provider auth error → actionable user message mapping (BT-011)", () => {
  // BT-011a: raw "Invalid or revoked access token" provider auth error
  // getUserFacingWorkflowErrorMessage must produce an actionable message
  // directing the user to Settings → Models, NOT the generic fallback.
  test("BT-011a: raw provider auth error surfaces actionable message, not generic fallback", async () => {
    agentStreamError = new Error("Invalid or revoked access token");

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected — workflow throws after writing the error chunk
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must mention Settings (actionable guidance)
    expect(delta?.toLowerCase()).toContain("settings");
    // Must NOT expose the raw token error string
    expect(delta).not.toContain("Invalid or revoked access token");
  });

  // BT-011b: the COMPOSED form produced by the agent step error-compose block:
  //   "No output generated. Check the stream for errors.\n\nProvider error: Invalid or revoked access token"
  // This is the real-world shape of the error that reaches getUserFacingWorkflowErrorMessage.
  test("BT-011b: composed provider auth error (No output generated + Provider error) surfaces actionable message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: Invalid or revoked access token",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta?.toLowerCase()).toContain("settings");
  });
});

describe("provider credits/quota error → actionable user message mapping (BT-012)", () => {
  // BT-012a: provider out-of-credits error (e.g. 402 / "out of credits")
  test("BT-012a: provider out-of-credits error surfaces actionable credit message, not generic fallback", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: 402 out of credits",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must mention credits or quota
    expect(delta?.toLowerCase()).toMatch(/credit|quota/);
  });

  // BT-012b: provider quota-exceeded error (OpenAI wording)
  test("BT-012b: provider quota-exceeded error surfaces actionable credit message, not generic fallback", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: exceeded your current quota, please check your plan and billing details",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta?.toLowerCase()).toMatch(/credit|quota/);
  });

  // BT-012c: "insufficient" credits error
  test("BT-012c: provider insufficient-credits error surfaces actionable credit message, not generic fallback", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: insufficient credits",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta?.toLowerCase()).toMatch(/credit|quota/);
  });
});

describe("guard: unrelated errors still return generic fallback (BT-013)", () => {
  // BT-013: an unrelated error that doesn't mention provider signals must still
  // return the generic "Workspace setup failed." fallback, not the provider message.
  // (This guards against over-broad matching.)
  test("BT-013: unrelated workspace error still returns generic fallback, not provider message", async () => {
    agentStreamError = new Error("some random workspace failure");

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBeDefined();
    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });
});

describe("false-positive guard: over-broad credit/auth phrases must NOT match (BT-014)", () => {
  const GENERIC_FALLBACK = "Workspace setup failed. Try again in a moment.";
  const CREDIT_MSG_PATTERN = /credit|quota/i;
  const AUTH_MSG_PATTERN = /settings.*model|api key|revoked/i;

  // BT-014a: "402" in an ECONNREFUSED address must NOT be treated as a credit error.
  test("BT-014a: ECONNREFUSED with 402 port does NOT surface credit message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: ECONNREFUSED 10.0.0.5:402",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    // Must NOT be the credit/quota message
    expect(delta).not.toMatch(CREDIT_MSG_PATTERN);
    expect(delta).not.toMatch(AUTH_MSG_PATTERN);
    // Must be the generic fallback
    expect(delta).toBe(GENERIC_FALLBACK);
  });

  // BT-014b: "insufficient permissions" must NOT be treated as an out-of-credits error.
  test("BT-014b: insufficient permissions does NOT surface credit message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: insufficient permissions to read file",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toMatch(CREDIT_MSG_PATTERN);
    expect(delta).toBe(GENERIC_FALLBACK);
  });

  // BT-014c: "disk quota exceeded" must NOT be treated as a provider credits error.
  test("BT-014c: disk quota exceeded does NOT surface credit message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: disk quota exceeded writing /tmp",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toMatch(CREDIT_MSG_PATTERN);
    expect(delta).toBe(GENERIC_FALLBACK);
  });
});

describe("precedence: Gateway free-credits branch wins over generic credit branch (BT-015)", () => {
  // BT-015: when the error message contains the Gateway free-credits phrase, the
  // FIRST branch (Gateway) must fire, not the new credit branch. The message
  // must mention "Gateway" or "free credits".
  test("BT-015: Gateway free-credits error returns Gateway message, not generic credit fallback", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: Free credits temporarily have restricted access to this resource.",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    // Must mention Gateway or free credits (the first-branch message)
    const lc = delta?.toLowerCase() ?? "";
    expect(lc.includes("gateway") || lc.includes("free credit")).toBe(true);
  });
});

describe("new provider wording support (BT-016)", () => {
  const CREDIT_MSG_PATTERN = /credit|quota/i;
  const AUTH_MSG_PATTERN = /settings.*model|api key|revoked/i;

  // BT-016a: Anthropic "credit balance is too low"
  test("BT-016a: Anthropic credit_balance_too_low surfaces credit message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: credit balance is too low",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toMatch(CREDIT_MSG_PATTERN);
  });

  // BT-016b: OpenAI "Incorrect API key provided"
  test("BT-016b: OpenAI incorrect API key surfaces auth message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: Incorrect API key provided",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toMatch(AUTH_MSG_PATTERN);
  });

  // BT-016c: "authentication_error" provider error keyword
  test("BT-016c: authentication_error keyword surfaces auth message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: authentication_error: invalid credentials",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toMatch(AUTH_MSG_PATTERN);
  });

  // BT-016d: "invalid_api_key" error code
  test("BT-016d: invalid_api_key error code surfaces auth message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: invalid_api_key",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toMatch(AUTH_MSG_PATTERN);
  });

  // BT-016e: "401 unauthorized" anchored phrase (NOT bare "401")
  test("BT-016e: 401 unauthorized surfaces auth message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: 401 unauthorized",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toMatch(AUTH_MSG_PATTERN);
  });

  // BT-016f: bare "401" alone must NOT surface auth message (not anchored)
  test("BT-016f: bare 401 error code does NOT surface auth message", async () => {
    agentStreamError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: error code 401 from upstream",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();
    expect(delta).toBeDefined();
    // Must be the generic fallback, not an auth message
    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });
});
