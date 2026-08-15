import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

mock.module("server-only", () => ({}));

// --- workflow/api (start-run.ts imports `getRun` lazily via
// `await import("workflow/api")`, mirroring route.ts; `start` is a normal
// static import) ---
// `start()` returns a run handle, and the started result must carry that
// handle's readable through to the caller — the chat route streams from it
// instead of re-deriving one with getRun(), which can fail independently.
const startWorkflow = mock(
  async (_workflow: unknown, _args: unknown[]) =>
    ({
      runId: "run-new",
      getReadable: () => new ReadableStream(),
    }) as { runId: string; getReadable: () => ReadableStream },
);

const runStatusByRunId = new Map<string, string>();
const cancelSpy = mock(async () => {});

const getRun = mock((runId: string) => {
  if (!runStatusByRunId.has(runId)) {
    throw new Error(`workflow run not found: ${runId}`);
  }
  return {
    status: Promise.resolve(runStatusByRunId.get(runId)),
    cancel: cancelSpy,
  };
});

mock.module("workflow/api", () => ({
  start: startWorkflow,
  getRun,
}));

// --- @/app/workflows/chat ---
const runAgentWorkflow = mock(() => {});
mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow,
}));

// --- @/lib/db/sessions ---
const getChatById = mock(async () => undefined as unknown);
const createChatMessageIfNotExists = mock(
  async (data: { id: string }) => ({ id: data.id }) as unknown,
);
const touchChat = mock(async () => {});
const isFirstChatMessage = mock(async () => false);
// Declare the mocks with their real signatures. A zero-arg factory fixes the
// inferred mock type, so a later `.mockImplementation` that reads arguments —
// which several of these tests need in order to assert on them — fails to
// typecheck against it.
const updateChat = mock(
  async (_chatId: string, _patch: { title: string }) => undefined,
);
const compareAndSetChatActiveStreamId = mock(
  async (_chatId: string, _expected: string | null, _next: string | null) =>
    true,
);
const claimChatActiveStreamId = mock(async () => true);

mock.module("@/lib/db/sessions", () => ({
  getChatById,
  createChatMessageIfNotExists,
  touchChat,
  isFirstChatMessage,
  updateChat,
  compareAndSetChatActiveStreamId,
  claimChatActiveStreamId,
}));

// --- @/lib/db/schema + @/lib/db/client (#1275: reconcileChatRunSlot's own
// app-owned "has this run already recorded a terminal outcome" check) ---
// Minimal stub schema, same pattern as session-event-lookup.test.ts: a plain
// string stand-in for the column is enough for `eq()` to build a filter
// object without needing the real drizzle-orm column shape, since `db`
// itself is fully mocked below and never actually executes SQL.
mock.module("@/lib/db/schema", () => ({
  workflowRuns: {
    id: "id",
  },
}));

// Controls whether the currently-reconciled run already has a recorded
// terminal outcome row (written once, at the very end of that run's own
// execution — see recordWorkflowRun in chat-post-finish-impl.ts). undefined
// (the default) means "no row yet", matching a genuinely still-live run.
let workflowRunRecordResult: { id: string } | undefined;
const findFirstWorkflowRun = mock(async (_opts: unknown) => {
  void _opts;
  return workflowRunRecordResult;
});

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      workflowRuns: {
        findFirst: findFirstWorkflowRun,
      },
    },
  },
}));

const moduleUnderTestPromise = import("./start-run");

function userMessage(text: string, id = "msg-1"): WebAgentUIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as WebAgentUIMessage;
}

type StartChatRunInput = {
  chatId: string;
  sessionId: string;
  userId: string;
  messages: WebAgentUIMessage[];
  requestUrl: string;
  requestId?: string;
  authSession: unknown;
  maxSteps?: number;
  agentOptions?: Record<string, unknown>;
  expectFileChanges?: boolean;
  expectedFiles?: string[];
};

function baseInput(
  overrides: Partial<StartChatRunInput> = {},
): StartChatRunInput {
  return {
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    messages: [userMessage("hello there")],
    requestUrl: "https://mcp.test/api/chat",
    requestId: "req-1",
    authSession: null,
    ...overrides,
  };
}

beforeEach(() => {
  startWorkflow.mockClear();
  startWorkflow.mockImplementation(async () => ({
    runId: "run-new",
    getReadable: () => new ReadableStream(),
  }));
  runStatusByRunId.clear();
  getRun.mockClear();
  cancelSpy.mockClear();
  runAgentWorkflow.mockClear();
  getChatById.mockClear();
  getChatById.mockImplementation(async () => ({
    id: "chat-1",
    activeStreamId: null,
  }));
  createChatMessageIfNotExists.mockClear();
  createChatMessageIfNotExists.mockImplementation(
    async (data: { id: string }) => ({ id: data.id }),
  );
  touchChat.mockClear();
  touchChat.mockImplementation(async () => {});
  isFirstChatMessage.mockClear();
  isFirstChatMessage.mockImplementation(async () => false);
  updateChat.mockClear();
  updateChat.mockImplementation(async () => {});
  compareAndSetChatActiveStreamId.mockClear();
  compareAndSetChatActiveStreamId.mockImplementation(async () => true);
  claimChatActiveStreamId.mockClear();
  claimChatActiveStreamId.mockImplementation(async () => true);
  workflowRunRecordResult = undefined;
  findFirstWorkflowRun.mockClear();
});

describe("startChatRun: existing active stream", () => {
  test("a running run is resumed and no new workflow is started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-live", "running");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-live",
    }));

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "resumed", runId: "run-live" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(claimChatActiveStreamId).not.toHaveBeenCalled();
    expect(createChatMessageIfNotExists).not.toHaveBeenCalled();
  });

  test("a pending run is resumed and no new workflow is started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-live", "pending");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-live",
    }));

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "resumed", runId: "run-live" });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("a dead/unknown run clears the slot via compare-and-set and starts a new run", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    // getRun throws for any runId not seeded into runStatusByRunId — "run-dead"
    // is never seeded, so getRun("run-dead") throws, matching an unknown run.
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-dead",
    }));
    compareAndSetChatActiveStreamId.mockImplementation(
      async (_chatId: string, expected: string | null) =>
        expected === "run-dead",
    );

    const result = await startChatRun(baseInput());

    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-dead",
      null,
    );
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "started", runId: "run-new" });
    // The started result must carry the readable from the handle `start()`
    // returned, so a streaming caller never re-derives it with getRun().
    expect(typeof (result as { readable?: unknown }).readable).toBe("function");
  });

  test("a terminal (non-running) run also clears the slot and starts a new run", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-done", "completed");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-done",
    }));
    compareAndSetChatActiveStreamId.mockImplementation(
      async (_chatId: string, expected: string | null) =>
        expected === "run-done",
    );

    const result = await startChatRun(baseInput());

    expect(result).toMatchObject({ status: "started", runId: "run-new" });
    // The started result must carry the readable from the handle `start()`
    // returned, so a streaming caller never re-derives it with getRun().
    expect(typeof (result as { readable?: unknown }).readable).toBe("function");
  });

  test("compare-and-set losing repeatedly against a still-held slot returns conflict after bounded retries, with no new run started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-stuck", "completed");
    // Every refetch of the chat still reports the same held slot.
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-stuck",
    }));
    // The CAS never wins — another writer keeps re-claiming it.
    compareAndSetChatActiveStreamId.mockImplementation(async () => false);

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "conflict", runId: "run-stuck" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(claimChatActiveStreamId).not.toHaveBeenCalled();
    // Bounded: exactly 3 attempts, not unbounded polling.
    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledTimes(3);
    expect(getRun).toHaveBeenCalledTimes(3);
  });

  // #1275: a run that ended by pausing for tool approval returns normally
  // from runAgentWorkflow, same as any other finish — but the workflow
  // platform's own status vocabulary (pending/running/completed/failed/
  // cancelled, see @workflow/world's WorkflowRunStatusSchema) has no separate
  // state for "paused for approval", and can still read "running" for such a
  // run. reconcileExistingActiveStream must not take that read at face value
  // forever: once this app's own workflowRuns row for the SAME run id exists
  // (only ever written at the very end of that run's own execution), the run
  // is definitively finished regardless of what the platform reports.
  describe("a run reported 'running' by the platform but already finished per this app's own record (#1275)", () => {
    test("clears the slot and starts a new run instead of resuming", async () => {
      const { startChatRun } = await moduleUnderTestPromise;
      runStatusByRunId.set("run-paused", "running");
      workflowRunRecordResult = { id: "run-paused" };
      getChatById.mockImplementation(async () => ({
        id: "chat-1",
        activeStreamId: "run-paused",
      }));
      compareAndSetChatActiveStreamId.mockImplementation(
        async (_chatId: string, expected: string | null) =>
          expected === "run-paused",
      );

      const result = await startChatRun(baseInput());

      // Accepted, not refused as a conflict and not silently resumed onto a
      // dead run — a fresh turn (e.g. the user's approval answer, or a
      // headless caller's next send_message) starts cleanly.
      expect(result).toMatchObject({ status: "started", runId: "run-new" });
      expect(compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
        "chat-1",
        "run-paused",
        null,
      );
    });

    // Regression: the money-safety invariant this whole handshake exists for.
    // If a future change makes isWorkflowRunAlreadyRecorded too eager (e.g.
    // matching on chatId instead of the specific run id, or ignoring the
    // "no row yet" case), a genuinely still-executing run would have its slot
    // ripped out from under it and a second, concurrent, billable run would
    // start alongside it. This test fails if that guard is ever loosened.
    test("regression: a genuinely still-live run (status running, no recorded outcome yet) still resumes, not started — the double-run guard holds", async () => {
      const { startChatRun } = await moduleUnderTestPromise;
      runStatusByRunId.set("run-live", "running");
      // workflowRunRecordResult stays undefined (default): no row exists yet
      // for a run that has not finished its own execution — exactly the
      // state of a run that is still mid-turn, e.g. a live interactive
      // approve-in-browser resume.
      getChatById.mockImplementation(async () => ({
        id: "chat-1",
        activeStreamId: "run-live",
      }));

      const result = await startChatRun(baseInput());

      expect(result).toEqual({ status: "resumed", runId: "run-live" });
      expect(startWorkflow).not.toHaveBeenCalled();
      expect(compareAndSetChatActiveStreamId).not.toHaveBeenCalled();
      expect(findFirstWorkflowRun).toHaveBeenCalledTimes(1);
    });
  });
});

describe("startChatRun: happy path with no active stream", () => {
  test("persists the user message, starts the workflow, claims the slot, and returns started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const message = userMessage("hello there", "msg-42");

    const result = await startChatRun(
      baseInput({ messages: [message], maxSteps: 250 }),
    );

    expect(result).toMatchObject({ status: "started", runId: "run-new" });
    // The started result must carry the readable from the handle `start()`
    // returned, so a streaming caller never re-derives it with getRun().
    expect(typeof (result as { readable?: unknown }).readable).toBe("function");

    expect(createChatMessageIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "msg-42",
        chatId: "chat-1",
        role: "user",
      }),
    );
    expect(touchChat).toHaveBeenCalledWith("chat-1");

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [workflowFn, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(workflowFn).toBe(runAgentWorkflow);
    expect(args[0]).toMatchObject({
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      requestUrl: "https://mcp.test/api/chat",
      requestId: "req-1",
      authSession: null,
      maxSteps: 250,
      messages: [message],
    });

    expect(claimChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-new",
      "browser",
    );
  });

  // #1288: the declared expectation set on open_agents_start_session must
  // reach the workflow's own Options so the circling detector and the
  // acceptance check can act on it.
  test("forwards expectFileChanges and expectedFiles to the workflow payload when the caller sets them (#1288)", async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(
      baseInput({
        expectFileChanges: true,
        expectedFiles: ["src/a.ts", "src/b.ts"],
      }),
    );

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0].expectFileChanges).toBe(true);
    expect(args[0].expectedFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("omits expectFileChanges/expectedFiles from the workflow payload when the caller does not set them — every existing caller is unaffected (#1288)", async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(baseInput());

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0].expectFileChanges).toBeUndefined();
    expect(args[0].expectedFiles).toBeUndefined();
  });

  test("forwards agentOptions to the workflow payload when the caller sets it (#1230: MCP headless runs)", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const agentOptions = {
      unattended: true,
      allowedBuiltinToolNames: ["bash", "read"],
      customInstructions: "run headless",
    };

    await startChatRun(baseInput({ agentOptions }));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0].agentOptions).toEqual(agentOptions);
  });

  test('#1269: claims the slot with source "mcp" for an unattended (MCP headless) run', async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(baseInput({ agentOptions: { unattended: true } }));

    expect(claimChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-new",
      "mcp",
    );
  });

  test('#1269: claims the slot with source "browser" for a run without unattended options', async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(baseInput());

    expect(claimChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-new",
      "browser",
    );
  });

  test("does not default maxSteps to 500 for a caller that omits it (#1231: headless MCP runs must not inherit the browser step cap)", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const agentOptions = { unattended: true };

    await startChatRun(baseInput({ agentOptions }));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    // Undefined, not 500 — the chat step loop treats undefined maxSteps as
    // unbounded and a progress-based fuse takes over for headless runs.
    expect(args[0].maxSteps).toBeUndefined();
  });

  test("defaults maxSteps to 500 for a NON-headless caller that omits it (safety net for any future caller besides the browser route and MCP)", async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    // No agentOptions at all — not headless — and no maxSteps override.
    await startChatRun(baseInput());

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0].maxSteps).toBe(500);
  });

  test("defaults maxSteps to 500 for a caller whose agentOptions is set but not unattended", async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(baseInput({ agentOptions: { unattended: false } }));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0].maxSteps).toBe(500);
  });

  test("omits agentOptions from the workflow payload entirely when the caller does not set it — the browser chat route's shape", async () => {
    const { startChatRun } = await moduleUnderTestPromise;

    await startChatRun(baseInput());

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    // Exact key check (not toMatchObject): a stray `agentOptions: undefined`
    // key would still change the payload's own shape even though it reads as
    // falsy, and this is the guard that the browser chat route — which never
    // sets agentOptions — gets byte-identical behavior to before #1230.
    expect(Object.hasOwn(args[0], "agentOptions")).toBe(false);
  });

  test("regression: the browser chat route's workflow payload is unchanged by #1230", async () => {
    // app/api/chat/route.ts calls startChatRun with exactly this field set
    // (no agentOptions, no autoCommitEnabled/autoCreatePrEnabled) and always
    // has. If this test fails after #1230, the browser's interactive runs
    // silently changed shape.
    const { startChatRun } = await moduleUnderTestPromise;
    const message = userMessage("hello there", "msg-browser");

    await startChatRun({
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      messages: [message],
      requestUrl: "https://app.test/api/chat",
      requestId: "req-browser",
      authSession: { user: { id: "user-1" } },
      maxSteps: 500,
    });

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(args[0]).toEqual({
      messages: [message],
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      requestUrl: "https://app.test/api/chat",
      requestId: "req-browser",
      authSession: { user: { id: "user-1" } },
      maxSteps: 500,
    });
  });

  test("the claim losing the race cancels the just-started run and reports the LIVE run, not the cancelled one", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-new", "running");
    claimChatActiveStreamId.mockImplementation(async () => false);
    // The slot starts empty (so we start a run), and by the time the claim
    // fails another writer owns it — that winner is what a caller must be
    // told about. Reporting our own cancelled id would point them at a dead
    // run.
    let chatReads = 0;
    getChatById.mockImplementation(async () => {
      chatReads += 1;
      return {
        id: "chat-1",
        activeStreamId: chatReads === 1 ? null : "run-winner",
      };
    });

    const result = await startChatRun(baseInput());

    expect(result).toEqual({
      status: "conflict",
      runId: "run-winner",
      cancelledRunId: "run-new",
    });
    expect(getRun).toHaveBeenCalledWith("run-new");
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  test("a lost claim still reports our own run id when the slot cannot be re-read", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-new", "running");
    claimChatActiveStreamId.mockImplementation(async () => false);
    let chatReads = 0;
    getChatById.mockImplementation(async () => {
      chatReads += 1;
      if (chatReads === 1) {
        return { id: "chat-1", activeStreamId: null };
      }
      throw new Error("db down");
    });

    const result = await startChatRun(baseInput());

    expect(result).toMatchObject({ status: "conflict", runId: "run-new" });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  test("the first user message sets the chat title, truncated at 80 characters", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const longText = "x".repeat(120);
    isFirstChatMessage.mockImplementation(async () => true);

    await startChatRun(
      baseInput({ messages: [userMessage(longText, "msg-long")] }),
    );

    expect(updateChat).toHaveBeenCalledTimes(1);
    const [, patch] = updateChat.mock.calls[0];
    expect(patch.title).toBe(`${"x".repeat(80)}...`);
    expect(patch.title.length).toBe(83);
  });

  test("an already-persisted message id is not double-inserted, and the run still starts", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    // onConflictDoNothing semantics: nothing created, message already existed.
    createChatMessageIfNotExists.mockImplementation(async () => undefined);

    const result = await startChatRun(baseInput());

    expect(touchChat).not.toHaveBeenCalled();
    expect(isFirstChatMessage).not.toHaveBeenCalled();
    expect(updateChat).not.toHaveBeenCalled();
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "started", runId: "run-new" });
    // The started result must carry the readable from the handle `start()`
    // returned, so a streaming caller never re-derives it with getRun().
    expect(typeof (result as { readable?: unknown }).readable).toBe("function");
  });
});
