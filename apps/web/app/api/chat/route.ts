import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { checkBotProtection } from "@/lib/botid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { createHarnessClient } from "@/lib/harness/client";
import { getHarnessConfig } from "@/lib/harness/config";
import { logHarnessEvent } from "@/lib/harness/logger";
import { getRequestId } from "@/lib/harness/request-id";
import {
  startVerifiedBuildRun,
  toVerifiedBuildRunSnapshot,
} from "@/lib/harness/run-mapping";
import type { VerifiedBuildRunSnapshot } from "@/lib/harness/types";
import { classifyVerifiedBuildTask } from "@/lib/verified-build/task-classifier";
import { decideVerifiedBuildMode } from "@/lib/verified-build/mode-policy";
import {
  claimChatActiveStreamId,
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  isFirstChatMessage,
  touchChat,
  updateChat,
} from "@/lib/db/sessions";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { runAgentWorkflow } from "@/app/workflows/chat";
import { persistAssistantMessagesWithToolResults } from "./_lib/persist-tool-results";
import {
  validateWorkflowInputs,
  persistWorkflowInputSnapshot,
} from "@/lib/workflows/run-start";

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

function getLatestUserMessage(messages: WebAgentUIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return null;
}

function createVerifiedBuildStartedStream(params: {
  run: VerifiedBuildRunSnapshot;
  requestId: string;
  reason: string;
}): ReadableStream<WebAgentUIMessageChunk> {
  return new ReadableStream<WebAgentUIMessageChunk>({
    start(controller) {
      const assistantMessageId = crypto.randomUUID();
      const textId = `${assistantMessageId}:text`;
      controller.enqueue({ type: "start", messageId: assistantMessageId });
      controller.enqueue({
        type: "data-verified-build",
        id: `${assistantMessageId}:verified-build`,
        data: {
          status: params.run.status,
          runId: params.run.id,
          harnessRunId: params.run.harnessRunId,
          mode: params.run.mode,
          reason: params.reason,
          requestId: params.requestId,
        },
      });
      controller.enqueue({ type: "text-start", id: textId });
      controller.enqueue({
        type: "text-delta",
        id: textId,
        delta:
          "I’m routing this through Verified Build so the code-changing work runs with gates, evidence, and a final go/no-go report.",
      });
      controller.enqueue({ type: "text-end", id: textId });
      controller.enqueue({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });
}

export async function POST(req: Request) {
  // 1. Validate session
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;
  const session = await getServerSession();

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const {
    messages,
    workflowId,
    inputValues,
    workflowSchema,
    workflowSchemaVersion,
  } = parsedBody.body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;
  const requestId = getRequestId(req.headers);

  // 3. Verify session + chat ownership
  const chatContext = await requireOwnedSessionChat({
    userId,
    sessionId,
    chatId,
    forbiddenMessage: "Unauthorized",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { sessionRecord, chat } = chatContext;

  if (sessionRecord.status === "archived") {
    return Response.json({ error: "Session is archived" }, { status: 400 });
  }

  // Guard: if a workflow is already running for this chat, reconnect to it
  // instead of starting a duplicate. This prevents auto-submit from spawning
  // parallel workflows when the client sees completed tool calls mid-loop.
  if (chat.activeStreamId) {
    const existingStreamResolution = await reconcileExistingActiveStream(
      chatId,
      chat.activeStreamId,
    );

    if (existingStreamResolution.action === "resume") {
      return createUIMessageStreamResponse({
        stream: existingStreamResolution.stream,
        headers: { "x-workflow-run-id": existingStreamResolution.runId },
      });
    }

    if (existingStreamResolution.action === "conflict") {
      return Response.json(
        { error: "Another workflow is already running for this chat" },
        { status: 409 },
      );
    }
  }

  await Promise.all([
    persistLatestUserMessage(chatId, messages),
    persistAssistantMessagesWithToolResults(chatId, messages),
  ]);

  const harnessConfig = getHarnessConfig();
  const classification = classifyVerifiedBuildTask(messages);
  const modeDecision = decideVerifiedBuildMode({
    classification,
    config: harnessConfig,
  });

  logHarnessEvent("info", {
    event: "verified_build.mode.selected",
    request_id: requestId,
    session_id: sessionId,
    chat_id: chatId,
    mode: classification.mode,
    reason_code: classification.reasonCode,
    confidence: classification.confidence,
    direct_mode_allowed: harnessConfig.allowedDirectMode,
  });

  if (
    modeDecision.action === "start_verified_build" ||
    modeDecision.action === "start_investigation"
  ) {
    const latestUserMessage = getLatestUserMessage(messages);
    if (!latestUserMessage) {
      return Response.json(
        { error: "A user message is required" },
        { status: 400 },
      );
    }

    try {
      const run = await startVerifiedBuildRun({
        client: createHarnessClient(harnessConfig),
        input: {
          sessionId,
          chatId,
          userId,
          latestUserMessageId: latestUserMessage.id,
          intentSummary: classification.summary,
          selectionReason: modeDecision.reason,
          mode:
            modeDecision.action === "start_investigation"
              ? "investigation"
              : "verified_build",
          requestId,
        },
      });

      return createUIMessageStreamResponse({
        stream: createVerifiedBuildStartedStream({
          run: toVerifiedBuildRunSnapshot(run),
          requestId,
          reason: modeDecision.reason,
        }),
        headers: {
          "x-verified-build-run-id": run.id,
          "x-request-id": requestId,
        },
      });
    } catch {
      return Response.json(
        {
          error: "Verified Build could not be started",
          requestId,
        },
        { status: 502, headers: { "X-Request-ID": requestId } },
      );
    }
  }

  // ── Workflow input validation gate (#46 FIX 2) ───────────────────────────
  // Architecture: validate BEFORE start(), persist AFTER start() with the REAL
  // run.runId. This fixes two critical issues:
  //   (a) FK violation: workflow_runs row doesn't exist at validate time
  //   (b) run-id mismatch: using a pre-generated nanoid that never matches run.runId
  //
  // Flow:
  //   1. VALIDATE (pure) — if invalid, return 422/403 and do NOT call start().
  //   2. start(runAgentWorkflow, ...) → get run.runId.
  //   3. PERSIST (best-effort) with workflowRunId = run.runId.
  //      A persist failure here must NOT kill the already-started run.
  //
  // Backward compat: freeform chat runs (no workflowId) bypass this gate
  // entirely and proceed directly to start(runAgentWorkflow, ...).
  //
  // Schema lookup: client-supplied workflowSchema (no #30 catalog yet).
  let validatedWorkflowInput:
    | { redactedValues: Record<string, unknown>; workflowId: string }
    | undefined;

  if (workflowId !== undefined && workflowId !== null && workflowId !== "") {
    // Step 1: VALIDATE (pure — does not start the run)
    const validationResult = await validateWorkflowInputs({
      workflowId,
      schema: workflowSchema,
      schemaVersion: workflowSchemaVersion ?? null,
      inputValues: (inputValues ?? {}) as Record<string, unknown>,
      userId,
    });

    if (!validationResult.valid) {
      switch (validationResult.errorKind) {
        case "workflow_input_invalid":
          return Response.json(
            {
              error: "Workflow input validation failed",
              errorKind: validationResult.errorKind,
              fieldErrors: validationResult.fieldErrors,
            },
            { status: 422 },
          );
        case "workflow_input_unauthorized":
          return Response.json(
            {
              error: "Unauthorized to start this workflow run",
              errorKind: validationResult.errorKind,
            },
            { status: 403 },
          );
        case "workflow_version_mismatch":
          return Response.json(
            {
              error: "Workflow schema version mismatch",
              errorKind: validationResult.errorKind,
            },
            { status: 409 },
          );
      }
    }

    // Stash the redacted values; we'll persist after start() with the real runId.
    validatedWorkflowInput = {
      redactedValues: validationResult.redactedValues,
      workflowId,
    };
  }

  // Step 2: Start the durable workflow (only reached after validation passes)
  const run = await start(runAgentWorkflow, [
    {
      messages,
      chatId,
      sessionId,
      userId,
      requestUrl: req.url,
      requestId,
      authSession: session ?? null,
      maxSteps: 500,
    },
  ]);

  // Step 3 (#46 FIX 2): Best-effort persist of the redacted snapshot with the
  // REAL run.runId (available only after start() returns). A persist failure
  // must NOT kill the already-started run — log field keys only, continue.
  if (validatedWorkflowInput) {
    try {
      await persistWorkflowInputSnapshot({
        workflowRunId: run.runId,
        workflowId: validatedWorkflowInput.workflowId,
        schemaVersion: workflowSchemaVersion ?? null,
        redactedValues: validatedWorkflowInput.redactedValues,
        persistedAt: new Date(),
      });
    } catch {
      // Best-effort — do NOT fail the response after the run has started.
      // Log field keys only; raw values are never logged.
      console.warn(
        "[chat/route] workflow input snapshot persist failed after run start",
        { workflowRunId: run.runId, workflowId: validatedWorkflowInput.workflowId },
      );
    }
  }

  // Idempotently claim the activeStreamId slot for the workflow we just
  // started. This succeeds both when the slot is still null and when the
  // workflow already self-claimed it from inside its first step.
  const claimed = await claimChatActiveStreamId(chatId, run.runId);

  if (!claimed) {
    // Another request or workflow run owns the slot — cancel our duplicate.
    try {
      const { getRun } = await import("workflow/api");
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cleanup.
    }
    return Response.json(
      { error: "Another workflow is already running for this chat" },
      { status: 409 },
    );
  }

  const stream = createCancelableReadableStream(
    run.getReadable<WebAgentUIMessageChunk>(),
  );

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": run.runId,
      "x-request-id": requestId,
    },
  });
}

type ExistingActiveStreamResolution =
  | {
      action: "resume";
      runId: string;
      stream: ReadableStream<WebAgentUIMessageChunk>;
    }
  | {
      action: "ready";
    }
  | {
      action: "conflict";
    };

const ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS = 3;

async function reconcileExistingActiveStream(
  chatId: string,
  activeStreamId: string,
): Promise<ExistingActiveStreamResolution> {
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
        return {
          action: "resume",
          runId: currentStreamId,
          stream: createCancelableReadableStream(
            existingRun.getReadable<WebAgentUIMessageChunk>(),
          ),
        };
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

  return currentStreamId ? { action: "conflict" } : { action: "ready" };
}

async function persistLatestUserMessage(
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
