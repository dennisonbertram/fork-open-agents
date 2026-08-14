import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  status: "running" | "completed" | "failed" | "archived";
  lifecycleState:
    | "provisioning"
    | "active"
    | "hibernating"
    | "hibernated"
    | "restoring"
    | "archived"
    | "failed";
  sandboxState: {
    type: "vercel";
    sandboxName: string;
    expiresAt: number;
  };
  hibernateAfter: Date | null;
  lastActivityAt: Date | null;
  sandboxExpiresAt: Date | null;
  updatedAt: Date;
}

let sessionRecord: TestSessionRecord | null = null;
let chatsInSession: Array<{ id: string; activeStreamId: string | null }> = [];

const stopSpy = mock(async () => undefined);

const spies = {
  getChatsBySessionId: mock(
    async (_sessionId: string) => chatsInSession as never,
  ),
  getSessionById: mock(async (_sessionId: string) => sessionRecord as never),
  updateSession: mock(
    async (_sessionId: string, patch: Record<string, unknown>) => patch,
  ),
  connectSandbox: mock(async () => ({
    stop: stopSpy,
  })),
  stop: stopSpy,
};

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: spies.getChatsBySessionId,
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

const { evaluateSandboxLifecycle } = await import("./lifecycle");

function makeDueSession(): TestSessionRecord {
  const nowMs = Date.now();

  return {
    id: "session-1",
    status: "running",
    lifecycleState: "active",
    sandboxState: {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: nowMs + 5 * 60_000,
    },
    hibernateAfter: new Date(nowMs - 1_000),
    lastActivityAt: new Date(nowMs - 60_000),
    sandboxExpiresAt: null,
    updatedAt: new Date(nowMs - 60_000),
  };
}

beforeEach(() => {
  sessionRecord = makeDueSession();
  chatsInSession = [];

  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("evaluateSandboxLifecycle", () => {
  test("skips hibernation whenever any chat still has an activeStreamId", async () => {
    chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-running-1" }];

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.connectSandbox).not.toHaveBeenCalled();
    expect(spies.updateSession).not.toHaveBeenCalled();
    expect(spies.stop).not.toHaveBeenCalled();
  });

  test("rechecks for activeStreamId before stopping and restores active lifecycle state", async () => {
    spies.connectSandbox.mockImplementationOnce(async () => {
      chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-raced-in-1" }];
      return {
        stop: stopSpy,
      };
    });

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.getChatsBySessionId).toHaveBeenCalledTimes(2);
    expect(spies.stop).not.toHaveBeenCalled();

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch).toEqual({
      lifecycleState: "hibernating",
      lifecycleError: null,
    });
    expect(finalPatch.lifecycleState).toBe("active");
    expect(finalPatch.lifecycleError).toBeNull();
    expect(finalPatch.sandboxExpiresAt).toBeInstanceOf(Date);
    expect(finalPatch).not.toHaveProperty("lastActivityAt");
    expect(finalPatch).not.toHaveProperty("hibernateAfter");
  });

  test("skips hibernation when lifecycle timing is refreshed before stopping", async () => {
    spies.connectSandbox.mockImplementationOnce(async () => {
      if (!sessionRecord) {
        throw new Error("sessionRecord must be set");
      }

      const refreshedAt = new Date();
      sessionRecord = {
        ...sessionRecord,
        lastActivityAt: refreshedAt,
        hibernateAfter: new Date(refreshedAt.getTime() + 60_000),
      };

      return {
        stop: stopSpy,
      };
    });

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "not-due-yet" });
    expect(spies.stop).not.toHaveBeenCalled();

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch).toEqual({
      lifecycleState: "hibernating",
      lifecycleError: null,
    });
    expect(finalPatch.lifecycleState).toBe("active");
    expect(finalPatch.lifecycleError).toBeNull();
    expect(finalPatch.sandboxExpiresAt).toBeInstanceOf(Date);
    expect(finalPatch).not.toHaveProperty("lastActivityAt");
    expect(finalPatch).not.toHaveProperty("hibernateAfter");
  });

  test("hibernates by stopping the persistent sandbox session", async () => {
    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "hibernated" });
    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.stop).toHaveBeenCalledTimes(1);

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch.lifecycleState).toBe("hibernating");
    expect(finalPatch).toEqual(
      expect.objectContaining({
        lifecycleState: "hibernated",
        snapshotUrl: null,
        snapshotCreatedAt: null,
        sandboxState: {
          type: "vercel",
          sandboxName: "session_session-1",
        },
      }),
    );
  });

  // #1231: headless MCP runs force hibernation immediately at turn end by
  // setting hibernateAfter to now and driving this SAME function with a new
  // "headless-turn-end" reason — no new bypass. These two tests prove that
  // reuse is safe: the reason is accepted, and the existing race protection
  // (recheck for an active stream right before stopping) applies unchanged,
  // so a `send_message` that lands in the race window still wins.
  test("accepts the headless-turn-end reason and hibernates exactly like any other reason", async () => {
    const result = await evaluateSandboxLifecycle(
      "session-1",
      "headless-turn-end",
    );

    expect(result).toEqual({ action: "hibernated" });
    expect(spies.stop).toHaveBeenCalledTimes(1);
  });

  test("a send_message that claims the active stream during the headless-turn-end race wins over hibernation", async () => {
    spies.connectSandbox.mockImplementationOnce(async () => {
      // Simulates a follow-up send_message's startChatRun claiming the
      // active-stream slot in the window between the first due-check and
      // the sandbox connect completing.
      chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-follow-up" }];
      return { stop: stopSpy };
    });

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "headless-turn-end",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.stop).not.toHaveBeenCalled();
  });
});
