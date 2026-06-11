import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// ── Spy state ──────────────────────────────────────────────────────

const writtenChunks: UIMessageChunk[] = [];
let runStatus: string = "running";

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
  recordGoalLedgerStart: mock(() => Promise.resolve("goal-decrypt-test")),
  recordGoalLedgerEvent: mock(() => Promise.resolve()),
  recordGoalLedgerClose: mock(() => Promise.resolve()),
};

// Control which error getInferenceProfileByIdForUser throws
let inferenceProfileError: Error | null = null;

// ── Module mocks ───────────────────────────────────────────────────

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_decrypt-test" }),
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
      throw new Error("agent stream should not be called in this test");
    },
  },
}));

mock.module("ai", () => ({
  convertToModelMessages: async (msgs: Array<Record<string, unknown>>) =>
    msgs.map((m) => ({ role: m.role, content: [] })),
  generateId: () => "gen-id-decrypt",
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
    inferenceProfileId: "profile-dec-xyz",
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
  getInferenceProfileByIdForUser: async () => {
    if (inferenceProfileError) {
      throw inferenceProfileError;
    }

    return {
      id: "profile-dec-xyz",
      name: "Decrypt Test Profile",
      provider: "anthropic",
      enabled: true,
    };
  },
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

beforeEach(() => {
  writtenChunks.length = 0;
  runStatus = "running";
  inferenceProfileError = null;
  for (const spy of Object.values(spies)) {
    spy.mockClear();
  }
  // Re-apply the resolveComposioToolsForChat mock
  spies.resolveComposioToolsForChat.mockImplementation(async () => ({
    status: "off" as const,
  }));
  spies.claimActiveStream.mockImplementation(() => Promise.resolve("claimed"));
  spies.emitSessionEvent.mockImplementation(() => Promise.resolve(null));
  spies.recordGoalLedgerStart.mockImplementation(() =>
    Promise.resolve("goal-decrypt-test"),
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

describe("decrypt error → actionable user message mapping (BT-009)", () => {
  // BT-009: When the inference profile data layer throws InferenceProfileResolutionError
  // (because the stored key can't be decrypted), getUserFacingWorkflowErrorMessage
  // must surface the actionable "re-enter in Settings → Models" message, NOT the
  // generic "Workspace setup failed. Try again in a moment."
  test("BT-009: decrypt failure surfaces actionable message, not generic Workspace setup failed", async () => {
    const decryptResolutionError = Object.assign(
      new Error(
        'The saved API key for inference profile "Decrypt Test Profile" can\'t be decrypted in this environment — re-enter it in Settings → Models.',
      ),
      { name: "InferenceProfileResolutionError" },
    );
    inferenceProfileError = decryptResolutionError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected — the workflow throws after writing the error chunk
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain the actionable guidance
    expect(delta.toLowerCase()).toContain("settings");
    // Must NOT expose raw crypto error text
    expect(delta).not.toContain(
      "Unsupported state or unable to authenticate data",
    );
  });

  // BT-010: raw "Unsupported state or unable to authenticate data" crypto error
  // is also caught by the defense-in-depth branch in getSetupErrorMessage
  test("BT-010: raw crypto auth error is caught by defense-in-depth branch and surfaced as actionable message", async () => {
    const rawCryptoError = new Error(
      "Unsupported state or unable to authenticate data",
    );
    inferenceProfileError = rawCryptoError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain the actionable guidance about re-entering the key
    expect(delta.toLowerCase()).toContain("settings");
  });
});

describe("provider auth / credit error → actionable user message mapping", () => {
  // When a model provider returns an auth or credit/quota error, the
  // setup-error delta must surface an actionable message instead of the
  // generic "Workspace setup failed. Try again in a moment."

  test("provider auth failure 'Invalid or revoked access token' surfaces actionable message", async () => {
    const authError = new Error("Invalid or revoked access token");
    inferenceProfileError = authError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about API key
    expect(delta.toLowerCase()).toContain("api key");
    // Must NOT expose the raw token-like phrase
    expect(delta).not.toContain("access token");
  });

  test("provider auth failure composed 'No output generated' + 'Provider error:' surfaces actionable message", async () => {
    const composedAuthError = new Error(
      "No output generated from model\n\nProvider error: Invalid or revoked access token",
    );
    inferenceProfileError = composedAuthError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about API key
    expect(delta.toLowerCase()).toContain("api key");
    // Must NOT expose the raw token-like phrase
    expect(delta).not.toContain("access token");
  });

  test("provider credit/quota failure with 'insufficient' surfaces actionable message", async () => {
    const creditError = new Error("Insufficient credits for this request");
    inferenceProfileError = creditError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about billing/quota
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("provider credit/quota failure with 'quota' surfaces actionable message", async () => {
    const quotaError = new Error("Quota exceeded for this model");
    inferenceProfileError = quotaError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about billing/quota
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("provider credit/quota failure with 'credits' surfaces actionable message", async () => {
    const creditError = new Error("Out of credits");
    inferenceProfileError = creditError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about billing/quota
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("provider credit/quota failure with 402 status surfaces actionable message", async () => {
    const http402Error = new Error("HTTP 402: Payment Required");
    inferenceProfileError = http402Error;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about billing/quota
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("generic fallback is preserved for unknown errors", async () => {
    const unknownError = new Error("Something completely unexpected happened");
    inferenceProfileError = unknownError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must BE the generic fallback for unknown errors
    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });

  test("composed 'No output generated' + 'Provider error: 429' does NOT route to auth-key message", async () => {
    // A rate-limit error must NOT produce the auth-key guidance
    const rateLimitError = new Error(
      "No output generated from model\n\nProvider error: 429 Too Many Requests",
    );
    inferenceProfileError = rateLimitError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT tell the user to check their API key — it is a rate-limit, not an auth error
    expect(delta.toLowerCase()).not.toContain("api key");
    // Must NOT be the billing/quota message either
    expect(delta.toLowerCase()).not.toContain("billing");
  });

  test("'insufficient permissions' does NOT route to billing message", async () => {
    // An OAuth/ACL scope error must NOT produce billing guidance
    const permissionsError = new Error(
      "insufficient permissions: the access token does not have write permission",
    );
    inferenceProfileError = permissionsError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT tell the user to check billing/credits — it is an OAuth error, not billing
    expect(delta.toLowerCase()).not.toContain("billing");
    expect(delta.toLowerCase()).not.toContain("credits");
  });

  test("'finished in 401ms' duration string does NOT route to auth-key message", async () => {
    // A timing log containing 401 must NOT produce auth-key guidance
    const timingError = new Error(
      "No output generated from model\n\nProvider error: request finished in 401ms",
    );
    inferenceProfileError = timingError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT tell the user to check their API key — 401ms is a duration, not an HTTP status
    expect(delta.toLowerCase()).not.toContain("api key");
  });

  test("'ran 4020 steps' string does NOT route to billing message", async () => {
    // A message containing 4020 must NOT produce billing guidance
    const stepsError = new Error(
      "No output generated from model\n\nProvider error: agent ran 4020 steps",
    );
    inferenceProfileError = stepsError;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT tell the user to check billing/credits — 4020 is a step count, not an HTTP status
    expect(delta.toLowerCase()).not.toContain("billing");
    expect(delta.toLowerCase()).not.toContain("credits");
  });

  test("'HTTP 401' surfaces auth-key message", async () => {
    const http401Error = new Error(
      "No output generated from model\n\nProvider error: HTTP 401 Unauthorized",
    );
    inferenceProfileError = http401Error;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about API key
    expect(delta.toLowerCase()).toContain("api key");
  });

  test("'401 Unauthorized' surfaces auth-key message", async () => {
    const status401Error = new Error(
      "No output generated from model\n\nProvider error: 401 Unauthorized",
    );
    inferenceProfileError = status401Error;

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const errorChunk = writtenChunks.find(
      (chunk) =>
        chunk.type === "text-delta" &&
        "id" in chunk &&
        chunk.id === "setup-error",
    );

    expect(errorChunk).toBeDefined();
    const delta = (errorChunk as { delta?: string }).delta ?? "";

    // Must NOT be the generic fallback
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must contain actionable guidance about API key
    expect(delta.toLowerCase()).toContain("api key");
  });
});
