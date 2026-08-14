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
  // #1231: unused by this file's tests (none run a headless/unattended
  // agentOptions), but chat.ts's static import requires the export to exist.
  hibernateHeadlessSandboxAtTurnEnd: mock(() =>
    Promise.resolve({ action: "hibernated" as const }),
  ),
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
  isToolUIPart: (part: { type: string }) =>
    part.type.startsWith("tool-") || part.type === "dynamic-tool",
  pruneMessages: ({ messages }: { messages: Array<Record<string, unknown>> }) =>
    messages,
}));

mock.module("@open-agents/agent", () => ({
  toAnthropicDirectModelId: (_id: string) => null,
  toProviderModelId: (modelId: string) => modelId,
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

  // Reproduces the exact production failure: the workflow engine retried the
  // step three times and rethrew as FatalError, which drops the original
  // InferenceProfileResolutionError name. The remaining signal is the message
  // wording from lib/db/inference-profiles.ts ("can't be decrypted in this
  // environment"), which the classifier used to miss because it only matched
  // "could not be decrypted". Users saw "Workspace setup failed" instead.
  test("retry-wrapped FatalError carrying the decrypt message still surfaces actionable guidance", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        'Step "step//./app/workflows/chat//runAgentStep" failed after 3 retries: ' +
          'The saved API key for inference profile "Basteen" can\'t be decrypted in this environment. ' +
          "Re-enter the API key in Settings -> Models, save the profile, and try again.",
      ),
      { name: "FatalError" },
    );

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

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta.toLowerCase()).toContain("settings");
    // Must not leak the workflow engine's internal step path back to the user.
    expect(delta).not.toContain("runAgentStep");
  });
});

describe("credential failures name the credential that actually failed", () => {
  // An AI Gateway auth failure was being reported to the user as a Composio
  // API key problem, because the untyped-Composio fallback in
  // getSetupErrorMessage matched the bare phrase "Invalid API key" — generic
  // English that any provider emits. Users were sent to change the wrong key.
  test("AI Gateway auth failure does not blame Composio", async () => {
    inferenceProfileError = new Error(
      "AI Gateway authentication failed: Invalid API key.\n\n" +
        "Create a new API key: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys\n\n" +
        "Provide via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.",
    );

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

    expect(delta).not.toContain("Composio");
    expect(delta).not.toContain("COMPOSIO_API_KEY");
    expect(delta).toContain("AI Gateway");
  });

  // Raised in review of PR #1064: other guidance legitimately names the gateway
  // as a destination rather than as the thing that failed. Matching the phrase
  // "AI Gateway" alone would tell these users their gateway key was rejected.
  test("profile-unavailable guidance that merely mentions the gateway is not treated as a gateway auth failure", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        'Step "step//./app/workflows/chat//runAgentStep" failed after 3 retries: ' +
          "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
      ),
      { name: "FatalError" },
    );

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

    const delta = (errorChunk as { delta?: string }).delta ?? "";
    expect(delta).not.toContain("AI_GATEWAY_API_KEY");
    expect(delta).not.toContain("rejected the API key");
  });

  test("a genuine Composio failure still names Composio", async () => {
    inferenceProfileError = new Error(
      'Composio request failed: {"code":10401,"message":"Invalid API key"}',
    );

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

    const delta = (errorChunk as { delta?: string }).delta ?? "";
    expect(delta).toContain("Composio");
  });
});

describe("provider rejection → actionable user message mapping", () => {
  // A provider that refuses the request outright is not a workspace problem.
  // The message is built where the provider's response and the chat's
  // reasoning history are both in scope, then rethrown across a step boundary
  // as FatalError — which drops the error class, so the mapping has to
  // recognise it by its text and pass it through untouched.
  test("retry-wrapped provider rejection reaches the user with both recoveries", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        'Step "step//./app/workflows/chat//runAgentStep" failed: ' +
          "The model provider rejected this request (HTTP 400), so this turn stopped.\n\n" +
          'Provider said: {"message":"unsupported field: reasoning_content"}\n\n' +
          "This chat contains earlier model thinking, which some providers refuse to accept back. " +
          "You can remove the earlier thinking from this chat and send again, or switch back to the model that last worked here.",
      ),
      { name: "FatalError" },
    );

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

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toContain("unsupported field: reasoning_content");
    expect(delta).toContain("remove the earlier thinking");
    expect(delta).toContain("switch back to the model that last worked");
    // The workflow engine's internal step path is operator noise.
    expect(delta).not.toContain("runAgentStep");
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

  test("provider 'No tool output found for function call' surfaces an interrupted-tool message, not the generic fallback", async () => {
    const orphanError = new Error(
      "No tool output found for function call call_vvUJU5OVowt1r60JCAloNNWm.",
    );
    inferenceProfileError = orphanError;

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
    // Must explain the interrupted tool call and tell the user to retry
    expect(delta.toLowerCase()).toContain("interrupted");
    // Must NOT leak the raw function-call id
    expect(delta).not.toContain("call_vvUJU5OVowt1r60JCAloNNWm");
  });

  test("composed 'Provider error: No tool output found for function call' also surfaces the interrupted-tool message", async () => {
    const composedOrphanError = new Error(
      "No output generated from model\n\nProvider error: No tool output found for function call call_abc123.",
    );
    inferenceProfileError = composedOrphanError;

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

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta.toLowerCase()).toContain("interrupted");
    expect(delta).not.toContain("call_abc123");
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

  test("false positive fix: 'disk quota exceeded writing /tmp' does NOT route to billing message", async () => {
    // A sandbox disk-space error that contains "quota exceeded" in a filesystem
    // context must NOT produce provider-billing guidance. This is the composed form
    // that arrives from the agent stream.
    const diskQuotaError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: disk quota exceeded writing /tmp",
    );
    inferenceProfileError = diskQuotaError;

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

    // Must NOT tell the user to check billing — this is a disk space error, not a credit error
    expect(delta.toLowerCase()).not.toContain("billing");
    expect(delta.toLowerCase()).not.toContain("credits");
    // Must be the generic fallback (no specific routing)
    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });

  test("false negative fix: Anthropic 'credit balance is too low' surfaces billing message", async () => {
    // Anthropic returns this exact phrase when the user's credit balance is
    // exhausted. The previous matcher missed it; this ensures it is caught.
    const anthropicCreditError = new Error(
      "Your credit balance is too low to complete this request.",
    );
    inferenceProfileError = anthropicCreditError;

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
    // Must contain actionable guidance about billing/credits
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("bare 'Quota exceeded.' surfaces billing message (generic provider form)", async () => {
    // Generic provider quota error — bare "quota exceeded" with no trailing "for".
    // Previously caught by quota.*exceeded regex; the narrow "quota exceeded for"
    // phrase dropped this. Must route to billing, NOT the generic fallback.
    const bareQuotaError = new Error("Quota exceeded.");
    inferenceProfileError = bareQuotaError;

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
    // Must contain actionable billing guidance
    expect(delta.toLowerCase()).toContain("billing");
  });

  test("error-code form 'quota_exceeded' surfaces billing message", async () => {
    // Provider error-code string used by some APIs (e.g. OpenAI-compatible).
    // Must route to billing guidance, NOT the generic fallback.
    const quotaCodeError = new Error(
      "No output generated from model\n\nProvider error: quota_exceeded",
    );
    inferenceProfileError = quotaCodeError;

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
    // Must contain actionable billing guidance
    expect(delta.toLowerCase()).toContain("billing");
  });

  // Regression guard: the disk-quota false-positive fix must remain intact.
  // This is a copy of the existing false-positive test kept here as a guard
  // alongside the new generic-quota tests.
  test("regression guard: bare 'quota exceeded' inside 'disk quota exceeded' does NOT route to billing", async () => {
    // The disk-quota negative guard must fire when the message contains
    // "disk quota", even though "quota exceeded" is now in the phrase list.
    const diskQuotaError = new Error(
      "No output generated. Check the stream for errors.\n\nProvider error: disk quota exceeded writing /tmp",
    );
    inferenceProfileError = diskQuotaError;

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

    // Must NOT tell the user to check billing — this is a disk space error
    expect(delta.toLowerCase()).not.toContain("billing");
    expect(delta.toLowerCase()).not.toContain("credits");
    // Must be the generic fallback
    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });
});
