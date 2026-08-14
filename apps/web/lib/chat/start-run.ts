import type { OpenAgentCallOptions } from "@open-agents/agent";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { runAgentWorkflow } from "@/app/workflows/chat";
import {
  claimChatActiveStreamId,
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  isFirstChatMessage,
  touchChat,
  updateChat,
} from "@/lib/db/sessions";

// Re-exported so MCP tools (and any other caller) can import the whole
// durable-run handshake — start and stop — from one module path. The
// implementation lives in ./stop-run since it's a distinct concern (cancel +
// slot release vs. claim + start).
export { stopChatRun } from "./stop-run";
export type { StopChatRunInput, StopChatRunResult } from "./stop-run";

export type StartChatRunInput = {
  chatId: string;
  sessionId: string;
  userId: string;
  messages: WebAgentUIMessage[];
  requestUrl: string;
  requestId?: string;
  authSession: unknown;
  maxSteps?: number;
  // Per-run agent-call overrides (e.g. the MCP write tools' headless
  // unattended/allowlist/instructions — see lib/mcp-server/headless-run-options.ts).
  // Undefined = today's behavior; the browser chat route never sets this.
  agentOptions?: Omit<OpenAgentCallOptions, "sandbox" | "skills">;
  // Set by a caller (the chat route) that already called
  // `reconcileChatRunSlot` for this request and confirmed the slot is
  // "ready" — skips a redundant reconcile here. MCP tool callers, which
  // invoke `startChatRun` directly with no prior reconcile, must leave this
  // unset so the handshake below still runs.
  skipReconcile?: boolean;
};

export type StartChatRunResult =
  | {
      status: "started";
      runId: string;
      /**
       * The readable for the run we just started, taken from the handle
       * `start()` returned.
       *
       * Callers must not re-derive this with `getRun(runId)`. The route used
       * to hold the handle directly, and a second lookup is a different
       * operation that can fail on its own — that regressed the "existing run
       * cannot be loaded" case, where `getRun` throws for every call and the
       * route nonetheless has a perfectly good handle in hand. Streaming
       * callers use this; fire-and-forget callers (the MCP tools) ignore it.
       */
      readable: () => ReadableStream<unknown>;
    }
  | { status: "resumed"; runId: string }
  | {
      status: "conflict";
      /** The run that actually holds the slot — never one we just cancelled. */
      runId: string;
      /** Set when we started a run and then lost the claim race for it. */
      cancelledRunId?: string;
    };

export type ReconcileChatRunSlotResult = {
  action: "resume" | "ready" | "conflict";
  // Non-null whenever action is "resume" or "conflict"; null for "ready".
  runId: string | null;
};

const ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS = 3;

type ReconcileResult =
  | { action: "resume"; runId: string }
  | { action: "conflict"; runId: string }
  | { action: "ready" };

/**
 * Resolves an existing `chats.active_stream_id` against the workflow
 * runtime: resumes it when it is still live, clears it (via CAS) and reports
 * "ready" to start a new run when it is stale/unknown, or reports "conflict"
 * after bounded retries when another writer keeps re-claiming the slot.
 */
async function reconcileExistingActiveStream(
  chatId: string,
  activeStreamId: string,
): Promise<ReconcileResult> {
  const { getRun } = await import("workflow/api");
  let currentStreamId: string | null = activeStreamId;

  for (
    let attempt = 1;
    currentStreamId && attempt <= ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const existingRun = getRun(currentStreamId);
      const status = await existingRun.status;
      if (status === "running" || status === "pending") {
        return { action: "resume", runId: currentStreamId };
      }
    } catch {
      // Workflow not found or inaccessible — try to clear the stale stream ID.
    }

    const cleared = await compareAndSetChatActiveStreamId(
      chatId,
      currentStreamId,
      null,
    );
    if (cleared) {
      return { action: "ready" };
    }

    const latestChat = await getChatById(chatId);
    currentStreamId = latestChat?.activeStreamId ?? null;
  }

  return currentStreamId
    ? { action: "conflict", runId: currentStreamId }
    : { action: "ready" };
}

/**
 * Resolves `chats.active_stream_id` against the workflow runtime without
 * starting anything: "resume" (still live), "ready" (slot was already empty,
 * or the stale id was just cleared via CAS — safe to start a fresh run), or
 * "conflict" (another writer keeps re-claiming the slot after bounded
 * retries).
 *
 * Any caller that gates other work (Verified Build routing, workflow-input
 * validation) on "is this a genuinely fresh turn" must call this — not read
 * `chats.active_stream_id` directly — because a stale-but-clearable id reads
 * non-null on the raw column right up until this function clears it.
 */
export async function reconcileChatRunSlot(
  chatId: string,
): Promise<ReconcileChatRunSlotResult> {
  const chat = await getChatById(chatId);
  const activeStreamId = chat?.activeStreamId ?? null;

  if (!activeStreamId) {
    return { action: "ready", runId: null };
  }

  const reconciled = await reconcileExistingActiveStream(
    chatId,
    activeStreamId,
  );
  if (reconciled.action === "ready") {
    return { action: "ready", runId: null };
  }
  return { action: reconciled.action, runId: reconciled.runId };
}

export async function persistLatestUserMessage(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "user") {
    return;
  }

  try {
    const created = await createChatMessageIfNotExists({
      id: latestMessage.id,
      chatId,
      role: "user",
      parts: latestMessage,
    });

    if (!created) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id);
    if (!shouldSetTitle) {
      return;
    }

    const textContent = latestMessage.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length === 0) {
      return;
    }

    const title =
      textContent.length > 80 ? `${textContent.slice(0, 80)}...` : textContent;
    await updateChat(chatId, { title });
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }
}

/**
 * The durable-run handshake for starting a chat turn: resume an existing
 * live run, clear a stale one and start fresh, or report a conflict when
 * another writer is racing us for the same chat's active-stream slot.
 *
 * Money-safety note: `chats.active_stream_id` is the only thing that stops
 * one chat from spawning two concurrent (billable) workflow runs. Every
 * change here must keep that guarantee.
 */
export async function startChatRun(
  input: StartChatRunInput,
): Promise<StartChatRunResult> {
  if (!input.skipReconcile) {
    const reconciled = await reconcileChatRunSlot(input.chatId);
    if (reconciled.action === "resume") {
      // Invariant: reconcileChatRunSlot only returns "resume" with a runId.
      return { status: "resumed", runId: reconciled.runId as string };
    }
    if (reconciled.action === "conflict") {
      // Invariant: reconcileChatRunSlot only returns "conflict" with a runId.
      return { status: "conflict", runId: reconciled.runId as string };
    }
    // action === "ready" — the slot was already empty, or the stale value
    // was just cleared; start a new run below.
  }

  await persistLatestUserMessage(input.chatId, input.messages);

  const run = await start(runAgentWorkflow, [
    {
      messages: input.messages,
      chatId: input.chatId,
      sessionId: input.sessionId,
      userId: input.userId,
      requestUrl: input.requestUrl,
      requestId: input.requestId,
      // The workflow never reads `authSession` (verified: only the Options
      // type and this pass-through reference it). It's typed `unknown` here
      // so callers outside the HTTP route (e.g. MCP tools) aren't forced to
      // fabricate a session shape they don't have.
      authSession: input.authSession as Parameters<
        typeof runAgentWorkflow
      >[0]["authSession"],
      // #1231: no default. The browser chat route always sets this
      // explicitly (500); MCP headless callers never set it, and the chat
      // step loop treats `undefined` as unbounded — a progress-based fuse
      // (lib/progress-budget.ts) bounds a headless run instead. Do not
      // reintroduce a fallback here without also removing/adjusting the fuse.
      maxSteps: input.maxSteps,
      // Only present when a caller (currently: the MCP write tools) sets it —
      // omitted entirely, not `agentOptions: undefined`, so the browser chat
      // route's payload shape is byte-identical to before #1230.
      ...(input.agentOptions ? { agentOptions: input.agentOptions } : {}),
    },
  ]);

  // Idempotently claim the activeStreamId slot for the workflow we just
  // started. This succeeds both when the slot is still null and when the
  // workflow already self-claimed it from inside its first step.
  const claimed = await claimChatActiveStreamId(input.chatId, run.runId);

  if (!claimed) {
    // Another request or workflow run owns the slot — cancel our duplicate.
    try {
      const { getRun } = await import("workflow/api");
      // Awaited deliberately: an un-awaited cancel that rejects asynchronously
      // escapes this try/catch, and the duplicate run keeps executing and
      // billing with nothing retrying it. Log the runId so an orphaned run is
      // findable if the cancel itself fails.
      await getRun(run.runId).cancel();
    } catch (error) {
      console.warn(
        "[chat] failed to cancel a duplicate run after losing the claim",
        JSON.stringify({
          service: "chat",
          event: "chat.run.duplicate_cancel_failed",
          chatId: input.chatId,
          runId: run.runId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    // Report the run that actually holds the slot, not the one we just
    // cancelled. A caller that logs or surfaces this id would otherwise point
    // at a dead run. Falls back to ours only if the slot cannot be re-read.
    const latest = await getChatById(input.chatId).catch(() => undefined);
    return {
      status: "conflict",
      runId: latest?.activeStreamId ?? run.runId,
      cancelledRunId: run.runId,
    };
  }

  return {
    status: "started",
    runId: run.runId,
    readable: () => run.getReadable(),
  };
}
