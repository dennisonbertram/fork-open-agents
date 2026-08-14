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
  recordGoalLedgerStart: mock(() => Promise.resolve("goal-mr-setup-test")),
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
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_mr-setup-test" }),
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
  generateId: () => "gen-id-mr-setup",
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
    inferenceProfileId: "profile-mr-xyz",
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
      id: "profile-mr-xyz",
      name: "Managed Runtime Test Profile",
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
  spies.resolveComposioToolsForChat.mockImplementation(async () => ({
    status: "off" as const,
  }));
  spies.claimActiveStream.mockImplementation(() => Promise.resolve("claimed"));
  spies.emitSessionEvent.mockImplementation(() => Promise.resolve(null));
  spies.recordGoalLedgerStart.mockImplementation(() =>
    Promise.resolve("goal-mr-setup-test"),
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

function getSetupErrorDelta(): string {
  const errorChunk = writtenChunks.find(
    (chunk) =>
      chunk.type === "text-delta" &&
      "id" in chunk &&
      chunk.id === "setup-error",
  );
  return (errorChunk as { delta?: string } | undefined)?.delta ?? "";
}

describe("managed runtime profile setup failure → actionable user message mapping", () => {
  // Reproduces production session DCaiJUlpmOobs2Yp18O6R: a required managed
  // runtime setup command (installing agent-browser) failed. The thrown
  // WorkspaceSetupError message is already specific, but getSetupErrorMessage
  // had no branch that recognised it, so it fell through to the generic
  // "Workspace setup failed. Try again in a moment." — which is actively wrong
  // here, since a missing execute bit never succeeds on a bare retry.
  test("real production managed-runtime setup failure surfaces the failing command and the real next action, not the generic fallback", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        "Managed runtime profile setup failed while running Install agent-browser " +
          "for browser smoke checks for Web app with Bun and browser checks " +
          "(web-bun-agent-browser). agent-browser lets the managed runtime open " +
          "preview URLs, inspect the UI, capture browser errors, and run browser " +
          "smoke checks after the app starts. Command output: agent-browser native " +
          "binary was not found after install: " +
          "/root/.bun/install/global/node_modules/agent-browser/bin/agent-browser-linux-x64",
      ),
      { name: "WorkspaceSetupError" },
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected — the workflow throws after writing the error chunk
    }

    const delta = getSetupErrorDelta();

    // Must NOT be the generic fallback, and must NOT tell the user to
    // "try again in a moment" — a missing execute bit never fixes itself.
    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    // Must name the failing setup command.
    expect(delta).toContain("Install agent-browser");
    // Must carry the real next action, not vague retry advice.
    expect(delta).toContain(
      "Fix the failing setup command in the profile editor, then run setup again.",
    );
  });

  // Same defect, but reproduced through the workflow engine's retry-wrapped
  // FatalError, which drops the original WorkspaceSetupError name (see the
  // comment on the InferenceSecretDecryptionError branch in chat.ts for the
  // same pattern). The message text is the only signal left, so the new
  // branch must key on the unique prefix
  // "Managed runtime profile setup failed while running", not on name/instanceof.
  test("retry-wrapped FatalError carrying the managed-runtime setup message still surfaces actionable guidance", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        'Step "step//./app/workflows/chat//runAgentStep" failed after 3 retries: ' +
          "Managed runtime profile setup failed while running Install agent-browser " +
          "for browser smoke checks for Web app with Bun and browser checks " +
          "(web-bun-agent-browser). agent-browser lets the managed runtime open " +
          "preview URLs, inspect the UI, capture browser errors, and run browser " +
          "smoke checks after the app starts. Command output: agent-browser native " +
          "binary was not found after install.",
      ),
      { name: "FatalError" },
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toContain("Install agent-browser");
    expect(delta).toContain(
      "Fix the failing setup command in the profile editor, then run setup again.",
    );
    // The workflow engine's internal step path is operator noise.
    expect(delta).not.toContain("runAgentStep");
  });

  // Negative control: the new branch must not be so broad that it swallows
  // unrelated errors that merely mention "runtime" or "setup".
  test("unrelated error still produces the generic fallback (new branch is not over-broad)", async () => {
    inferenceProfileError = new Error(
      "Something completely unexpected happened",
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toBe("Workspace setup failed. Try again in a moment.");
  });

  // Reproduces the P2 review on this PR: chat-sandbox-runtime-impl.ts has a
  // SECOND throw site that shares this exact same
  // "Managed runtime profile setup failed while running..." prefix — the one
  // that fires when `sandbox.exec()` itself throws before the setup command
  // ever ran (errorKind "setup_exec_error"), as opposed to the command
  // running and failing (errorKind "setup_command_failed"). Sending users to
  // "the profile editor" for an infrastructure failure is wrong: there is
  // nothing to fix there. This must get sandbox/infra guidance instead.
  test("exec-infrastructure failure (sandbox.exec itself threw) does not get profile-editor guidance", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        "Managed runtime profile setup failed while running Install agent-browser " +
          "for browser smoke checks for Web app with Bun and browser checks " +
          "(web-bun-agent-browser). agent-browser lets the managed runtime open " +
          "preview URLs, inspect the UI, capture browser errors, and run browser " +
          "smoke checks after the app starts. Error: connect ECONNREFUSED sandbox control plane",
      ),
      { name: "WorkspaceSetupError" },
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toContain("Install agent-browser");
    // Must NOT hand out profile-editor guidance — nothing in the profile is
    // broken when the sandbox couldn't even run the command.
    expect(delta).not.toContain(
      "Fix the failing setup command in the profile editor",
    );
    // Must carry guidance appropriate to an infrastructure failure instead.
    expect(delta).toContain("sandbox");
  });

  // Same defect as above, reproduced through the workflow engine's
  // retry-wrapped FatalError, which drops the original WorkspaceSetupError
  // name — the message text is the only signal left.
  test("retry-wrapped FatalError carrying the exec-infrastructure message still avoids profile-editor guidance", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        'Step "step//./app/workflows/chat//runAgentStep" failed after 3 retries: ' +
          "Managed runtime profile setup failed while running Install agent-browser " +
          "for browser smoke checks for Web app with Bun and browser checks " +
          "(web-bun-agent-browser). agent-browser lets the managed runtime open " +
          "preview URLs, inspect the UI, capture browser errors, and run browser " +
          "smoke checks after the app starts. Error: sandbox timed out starting command",
      ),
      { name: "FatalError" },
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).not.toBe("Workspace setup failed. Try again in a moment.");
    expect(delta).toContain("Install agent-browser");
    expect(delta).not.toContain(
      "Fix the failing setup command in the profile editor",
    );
    expect(delta).toContain("sandbox");
    expect(delta).not.toContain("runAgentStep");
  });

  // A setup_command_failed message can legitimately contain command output
  // that itself starts with the word "Error:" (many CLIs print that to
  // stderr) — this must not be misread as an exec-infrastructure failure and
  // still needs to route to profile-editor guidance.
  test("command output containing the word 'Error:' still gets profile-editor guidance, not infra guidance", async () => {
    inferenceProfileError = Object.assign(
      new Error(
        "Managed runtime profile setup failed while running Install agent-browser " +
          "for browser smoke checks for Web app with Bun and browser checks " +
          "(web-bun-agent-browser). agent-browser lets the managed runtime open " +
          "preview URLs, inspect the UI, capture browser errors, and run browser " +
          "smoke checks after the app starts. Command output: Error: exit code 126: " +
          "permission denied",
      ),
      { name: "WorkspaceSetupError" },
    );

    try {
      await runAgentWorkflow(makeOptions());
    } catch {
      // expected
    }

    const delta = getSetupErrorDelta();

    expect(delta).toContain(
      "Fix the failing setup command in the profile editor, then run setup again.",
    );
  });
});
