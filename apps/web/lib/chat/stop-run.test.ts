import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const cancel = mock(async () => undefined as unknown);
const getRun = mock((_runId: string) => ({ cancel }));
mock.module("workflow/api", () => ({ getRun }));

const compareAndSetChatActiveStreamId = mock(
  async (_chatId: string, _expected: string | null, _next: string | null) =>
    true,
);
mock.module("@/lib/db/sessions", () => ({ compareAndSetChatActiveStreamId }));

const modulePromise = import("./stop-run");

/** The shape `cancelRun` produces: a wrapper Error carrying the real cause. */
function wrappedNotFoundError(runId: string): Error {
  const notFound = new Error(`Workflow run "${runId}" not found`);
  notFound.name = "WorkflowRunNotFoundError";
  return new Error(`Failed to cancel run ${runId}: ${notFound.message}`, {
    cause: notFound,
  });
}

beforeEach(() => {
  cancel.mockClear();
  cancel.mockImplementation(async () => undefined);
  getRun.mockClear();
  compareAndSetChatActiveStreamId.mockClear();
  compareAndSetChatActiveStreamId.mockImplementation(async () => true);
});

describe("stopChatRun", () => {
  test("an empty slot resolves as nothing to stop", async () => {
    const { stopChatRun } = await modulePromise;

    const result = await stopChatRun({
      chatId: "chat-1",
      activeStreamId: null,
    });

    expect(result).toEqual({ stopped: false, workflowRunId: null });
    expect(cancel).not.toHaveBeenCalled();
  });

  test("a live run is cancelled and its slot cleared", async () => {
    const { stopChatRun } = await modulePromise;

    const result = await stopChatRun({
      chatId: "chat-1",
      activeStreamId: "run-1",
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ stopped: true, workflowRunId: "run-1" });
    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-1",
      null,
    );
  });

  test("a run the runtime no longer has resolves as nothing to stop, and clears the stale slot", async () => {
    // Production holds one chat whose active_stream_id was last touched 60
    // days ago. Cancelling it must not surface as an error to the caller —
    // stop_run documents that stopping when nothing is running is safe — and
    // the dead slot should not be left behind to block the next turn.
    const { stopChatRun } = await modulePromise;
    cancel.mockImplementation(async () => {
      throw wrappedNotFoundError("run-gone");
    });

    const result = await stopChatRun({
      chatId: "chat-1",
      activeStreamId: "run-gone",
    });

    expect(result).toEqual({ stopped: false, workflowRunId: null });
    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-gone",
      null,
    );
  });

  test("a transient failure propagates instead of reporting nothing was running", async () => {
    // The dangerous direction. If a status/cancel call rejects transiently and
    // we answer "stopped: false", the caller is told no run existed while a
    // billed agent keeps working — and would reasonably start another one.
    const { stopChatRun } = await modulePromise;
    cancel.mockImplementation(async () => {
      throw new Error("Failed to cancel run run-1: fetch failed");
    });

    await expect(
      stopChatRun({ chatId: "chat-1", activeStreamId: "run-1" }),
    ).rejects.toThrow();
  });
});
