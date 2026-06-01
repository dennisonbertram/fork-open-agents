/**
 * RED tests for issue-46 final targeted fixes (A, B-route-level, C)
 *
 * Fix A (MEDIUM — REQUIRED): persist-after-start failure observability
 *   The dead try/catch around persistWorkflowInputSnapshot must be replaced
 *   with a branch on the returned {success:false} result.
 *   Tests: (a) run STILL succeeds on persist failure, (b) console.warn is called.
 *
 * Written BEFORE implementation — all tests in this file must fail initially.
 * Run with: bun test apps/web/app/api/chat/route.final-fixes.test.ts
 */
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Shared module-level state ────────────────────────────────────────────────

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  cloneUrl: string;
  repoOwner: string;
  repoName: string;
  status: "running" | "archived";
  prNumber?: number | null;
  autoCommitPushOverride?: boolean | null;
  autoCreatePrOverride?: boolean | null;
  sandboxState: { type: "vercel" };
}

interface TestChatRecord {
  sessionId: string;
  modelId: string | null;
  activeStreamId: string | null;
}

let sessionRecord: TestSessionRecord | null;
let chatRecord: TestChatRecord | null;
let currentAuthSession: {
  user: { id: string; email?: string };
} | null;

// Control what persistWorkflowInputSnapshot returns
let persistShouldFail = false;
// Control what validateWorkflowInputs returns
let validateShouldFail = false;

let startCalls: unknown[][] = [];

// ── Module mocks — all must be declared BEFORE the dynamic import ───────────

mock.module("next/server", () => ({
  after: (task: Promise<unknown>) => {
    void Promise.resolve(task);
  },
}));

mock.module("ai", () => ({
  createUIMessageStreamResponse: ({
    stream,
    headers,
  }: {
    stream: ReadableStream;
    headers?: Record<string, string>;
  }) => new Response(stream, { status: 200, headers }),
  isToolUIPart: (part: { type: string }) =>
    part.type === "tool-invocation" || part.type.startsWith("tool-"),
}));

mock.module("workflow/api", () => ({
  start: async (...args: unknown[]) => {
    startCalls.push(args);
    return {
      runId: "wrun_final-fix-test-456",
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    };
  },
  getRun: () => ({
    status: Promise.resolve("completed"),
    getReadable: () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    cancel: () => Promise.resolve(),
  }),
}));

mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow: async () => {},
}));

mock.module("@/lib/chat/create-cancelable-readable-stream", () => ({
  createCancelableReadableStream: (stream: ReadableStream) => stream,
}));

mock.module("@open-agents/agent", () => ({
  discoverSkills: async () => [],
  gateway: () => "mock-model",
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/vercel/sandbox",
    exec: async () => ({ success: true, stdout: "", stderr: "" }),
    getState: () => ({
      type: "vercel",
      sandboxId: "sandbox-1",
      expiresAt: Date.now() + 60_000,
    }),
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  claimChatActiveStreamId: async () => true,
  compareAndSetChatActiveStreamId: async () => true,
  createChatMessageIfNotExists: async ({ id }: { id: string }) => ({ id }),
  getChatById: async () => chatRecord,
  getSessionById: async () => sessionRecord,
  isFirstChatMessage: async () => false,
  touchChat: async () => {},
  updateChat: async () => {},
  updateChatActiveStreamId: async () => {},
  updateChatAssistantActivity: async () => {},
  updateSession: async (_sessionId: string, patch: Record<string, unknown>) =>
    patch,
  upsertChatMessageScoped: async () => ({ status: "inserted" as const }),
}));

mock.module("@/lib/harness/run-mapping", () => ({
  getVerifiedBuildRunByIdForUser: async () => null,
  getLatestVerifiedBuildRunForChat: async () => null,
  getVerifiedBuildEventsForRun: async () => [],
  startVerifiedBuildRun: async () => ({}),
  updateVerifiedBuildRunFromHarnessStatus: async () => {},
  toVerifiedBuildRunSnapshot: (run: unknown) => run,
  toVerifiedBuildEventSnapshot: (event: unknown) => event,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    autoCommitPush: true,
    autoCreatePr: false,
    modelVariants: [],
  }),
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => null,
  setCachedSkills: async () => {},
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_PORTS: [],
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => true,
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

// Fix A: mock @/lib/workflows/run-start so we can control persist behavior
mock.module("@/lib/workflows/run-start", () => ({
  validateWorkflowInputs: async (args: {
    workflowId?: string | null;
    schema: unknown;
    schemaVersion?: string | null;
    inputValues: Record<string, unknown>;
    userId: string | null | undefined;
  }) => {
    if (validateShouldFail) {
      return {
        valid: false as const,
        errorKind: "workflow_input_invalid" as const,
        fieldErrors: [{ key: "name", message: "name is required" }],
      };
    }
    // Return a valid result with one redacted value
    return {
      valid: true as const,
      redactedValues: { name: args.inputValues["name"] ?? "test" },
    };
  },
  persistWorkflowInputSnapshot: async (_args: {
    workflowRunId: string;
    workflowId?: string | null;
    schemaVersion?: string | null;
    redactedValues: Record<string, unknown>;
    persistedAt: Date;
  }) => {
    if (persistShouldFail) {
      // This is what the REAL function returns on DB error — never throws
      return { success: false as const };
    }
    return { success: true as const, snapshotId: "snap-001" };
  },
  WorkflowInputSnapshotError: class WorkflowInputSnapshotError extends Error {},
}));

// Lazy-import after all mocks
const routeModulePromise = import("./route");

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL) => {
  return new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function createWorkflowRequest() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "session=abc",
    },
    body: JSON.stringify({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowId: "wf-test",
      workflowSchema: {
        fields: [
          { key: "name", label: "Name", kind: "string", required: true, sensitive: false },
        ],
      },
      inputValues: { name: "Alice" },
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Run workflow" }],
        },
      ],
    }),
  });
}

describe("Fix A: persist-failure observability — branch on returned result (not dead try/catch)", () => {
  beforeEach(() => {
    persistShouldFail = false;
    validateShouldFail = false;
    startCalls = [];

    currentAuthSession = { user: { id: "user-1" } };

    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session title",
      status: "running",
      cloneUrl: "https://github.com/acme/repo.git",
      repoOwner: "acme",
      repoName: "repo",
      prNumber: null,
      autoCommitPushOverride: null,
      autoCreatePrOverride: null,
      sandboxState: { type: "vercel" },
    };

    chatRecord = {
      sessionId: "session-1",
      modelId: null,
      activeStreamId: null,
    };
  });

  // BT-A-001: When persist returns {success:false}, the run STILL succeeds
  test("BT-A-001: run succeeds (200) even when persistWorkflowInputSnapshot returns {success:false}", async () => {
    persistShouldFail = true;

    const { POST } = await routeModulePromise;
    const response = await POST(createWorkflowRequest());

    // The run must succeed — persist failure must NOT cause a 500
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    // The workflow must have been started
    expect(startCalls).toHaveLength(1);
  });

  // BT-A-002: When persist returns {success:false}, console.warn is called with
  // the workflowRunId and workflowId (field keys only, never raw input values)
  test("BT-A-002: console.warn is called with workflowRunId and workflowId when persist fails", async () => {
    persistShouldFail = true;

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { POST } = await routeModulePromise;
      await POST(createWorkflowRequest());

      // console.warn must have been called at least once
      expect(warnSpy).toHaveBeenCalled();

      // Find the persist-failure warning call
      const warnCalls = warnSpy.mock.calls as unknown[][];
      const persistWarnCall = warnCalls.find(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("persist"),
      );
      expect(persistWarnCall).toBeDefined();

      // The warning context must include the runId (field key, not raw input value)
      const warnContext = persistWarnCall?.[1] as Record<string, unknown> | undefined;
      expect(warnContext).toBeDefined();
      // Must include workflowRunId
      expect(Object.keys(warnContext ?? {})).toContain("workflowRunId");
      // Must include workflowId
      expect(Object.keys(warnContext ?? {})).toContain("workflowId");
    } finally {
      warnSpy.mockRestore();
    }
  });

  // BT-A-003: When persist succeeds, console.warn is NOT called for persist failure
  test("BT-A-003: console.warn is NOT called for persist failure when persist succeeds", async () => {
    persistShouldFail = false;

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { POST } = await routeModulePromise;
      const response = await POST(createWorkflowRequest());

      expect(response.ok).toBe(true);

      // Find any persist-failure warning
      const warnCalls = warnSpy.mock.calls as unknown[][];
      const persistWarnCall = warnCalls.find(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("persist"),
      );
      // No persist-failure warning should be logged on success
      expect(persistWarnCall).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // BT-A-004: When there is no workflowId (freeform chat), persist is never called
  // and the run still succeeds without any warning
  test("BT-A-004: freeform chat (no workflowId) skips persist path entirely", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { POST } = await routeModulePromise;
      const freeformRequest = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: "session=abc" },
        body: JSON.stringify({
          sessionId: "session-1",
          chatId: "chat-1",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Hello world" }],
            },
          ],
        }),
      });

      const response = await POST(freeformRequest);

      expect(response.ok).toBe(true);
      expect(startCalls).toHaveLength(1);

      // No persist-failure warning for freeform chat
      const warnCalls = warnSpy.mock.calls as unknown[][];
      const persistWarnCall = warnCalls.find(
        (args) =>
          typeof args[0] === "string" &&
          args[0].includes("persist"),
      );
      expect(persistWarnCall).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
