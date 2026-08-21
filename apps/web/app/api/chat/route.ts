import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { checkBotProtection } from "@/lib/botid";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
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
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import {
  persistLatestUserMessage,
  reconcileChatRunSlot,
  startChatRun,
} from "@/lib/chat/start-run";
import { getServerSession } from "@/lib/session/get-server-session";
import { isProductSurfaceExposed } from "@/lib/product-surfaces/config";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { persistAssistantMessagesWithToolResults } from "./_lib/persist-tool-results";
import { restoreAbandonedTurnFlags } from "./_lib/restore-abandoned-turns";
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
    return Response.json(
      { error: "Access denied", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  // Chat is higher-volume than generate-title (10/min), so it gets a higher
  // ceiling: 30 requests/min per user.
  const limited = await checkRateLimit({
    key: rateLimitKey(["chat", userId]),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
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

  const { sessionRecord } = chatContext;

  if (sessionRecord.status === "archived") {
    return Response.json(
      { error: "Session is archived", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  // Reconcile the active-stream slot BEFORE deciding whether this is a
  // genuinely fresh turn. Verified Build routing and workflow-input
  // validation must never run concurrently with an already-active stream for
  // this chat (that would risk starting a second, billable run alongside
  // it) — but a stale-but-clearable stream id must not skip this block
  // either, since `startChatRun` goes on to start a fresh run for it. Gating
  // on the reconciled result (not the raw `chats.active_stream_id` column)
  // is what keeps those two cases apart.
  const reconciled = await reconcileChatRunSlot(chatId);

  if (reconciled.action === "conflict") {
    return Response.json(
      {
        error: "Another workflow is already running for this chat",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  if (reconciled.action === "resume") {
    const stream = await buildRunStream(reconciled.runId as string, {
      swallowLookupFailure: true,
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "x-workflow-run-id": reconciled.runId as string },
    });
  }

  // reconciled.action === "ready" — a genuinely fresh turn.
  let validatedWorkflowInput:
    | { redactedValues: Record<string, unknown>; workflowId: string }
    | undefined;

  await Promise.all([
    persistLatestUserMessage(chatId, messages),
    persistAssistantMessagesWithToolResults(chatId, messages),
  ]);

  if (isProductSurfaceExposed("verifiedBuild")) {
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
          {
            error: "A user message is required",
            errorKind: "invalid_request",
          },
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
            errorKind: "upstream_unavailable",
            requestId,
          },
          { status: 502, headers: { "X-Request-ID": requestId } },
        );
      }
    }
  }

  // ── Workflow input validation gate (#46 FIX 2) ───────────────────────────
  // Architecture: validate BEFORE start(), persist AFTER start() with the
  // REAL run.runId. This fixes two critical issues:
  //   (a) FK violation: workflow_runs row doesn't exist at validate time
  //   (b) run-id mismatch: using a pre-generated nanoid that never matches
  //       run.runId
  //
  // Flow:
  //   1. VALIDATE (pure) — if invalid, return 422/403 and do NOT start.
  //   2. startChatRun(...) → get the real runId.
  //   3. PERSIST (best-effort) with workflowRunId = runId.
  //      A persist failure here must NOT kill the already-started run.
  //
  // Backward compat: freeform chat runs (no workflowId) bypass this gate
  // entirely and proceed directly to startChatRun(...).
  //
  // Schema lookup: client-supplied workflowSchema (no #30 catalog yet).
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

    // Stash the redacted values; we'll persist after start() with the
    // real runId.
    validatedWorkflowInput = {
      redactedValues: validationResult.redactedValues,
      workflowId,
    };
  }

  // Issue #1133: the client's copy of a fatally failed assistant turn never
  // received `metadata.abandoned` — the live stream carries text chunks only.
  // Re-derive it from the persisted row so the flag survives a second turn
  // sent from the same open chat, and so a stale or altered client copy cannot
  // clear it. See `_lib/restore-abandoned-turns`.
  const workflowMessages = await restoreAbandonedTurnFlags(chatId, messages);

  // Step 2: start the durable workflow (only reached, for a fresh start,
  // after validation passes). The active-stream slot was already reconciled
  // above, so startChatRun must not reconcile it again.
  const result = await startChatRun({
    chatId,
    sessionId,
    userId,
    messages: workflowMessages,
    requestUrl: req.url,
    requestId,
    authSession: session ?? null,
    maxSteps: 500,
    skipReconcile: true,
  });

  if (result.status === "conflict") {
    return Response.json(
      {
        error: "Another workflow is already running for this chat",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  if (result.status === "resumed") {
    // Defensive: `skipReconcile` means startChatRun cannot itself detect a
    // resumable run, so this should be unreachable in practice. Handled for
    // type-exhaustiveness and in case a future caller flips the flag.
    const stream = await buildRunStream(result.runId, {
      swallowLookupFailure: true,
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "x-workflow-run-id": result.runId },
    });
  }

  // The run is freshly started, so take its readable from the handle
  // `start()` returned rather than re-deriving it with `getRun(runId)`. A
  // second lookup is a separate operation that can fail on its own — and it
  // does exactly that when the previous slot held a run the runtime can no
  // longer load, which is precisely the case the reconcile just cleaned up.
  const stream = createCancelableReadableStream(
    result.readable() as ReadableStream<WebAgentUIMessageChunk>,
  );

  // Step 3 (#46 FIX 2 + final-fix A): Best-effort persist of the redacted
  // snapshot with the REAL runId (available only after startChatRun
  // returns). persistWorkflowInputSnapshot NEVER throws — it returns
  // {success:false} on DB error. Branch on the returned result so persist
  // failures are observable. A persist failure must NOT kill the
  // already-started run. Log field keys / ids only — NEVER raw input values.
  if (validatedWorkflowInput) {
    const persistResult = await persistWorkflowInputSnapshot({
      workflowRunId: result.runId,
      workflowId: validatedWorkflowInput.workflowId,
      schemaVersion: workflowSchemaVersion ?? null,
      redactedValues: validatedWorkflowInput.redactedValues,
      persistedAt: new Date(),
    });

    if (!persistResult.success) {
      // Best-effort — do NOT fail the response after the run has started.
      // Log ids/field-keys only; raw input values are NEVER logged.
      console.warn(
        "[chat/route] workflow input snapshot persist failed after run start",
        {
          workflowRunId: result.runId,
          workflowId: validatedWorkflowInput.workflowId,
        },
      );
    }
  }

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": result.runId,
      "x-request-id": requestId,
    },
  });
}

/**
 * Looks up the live readable stream for a run that is resuming or has just
 * started. `startChatRun`/`reconcileChatRunSlot` only return a runId (never
 * the run handle itself), so the route re-derives the stream via `getRun`.
 *
 * `swallowLookupFailure` controls what happens when that lookup throws:
 *   - true (resumed runs): degrade to an already-closed stream rather than
 *     fail the whole response — the run was already live before this
 *     request, so a lookup hiccup here should not surface as an error.
 *   - false (freshly started runs): rethrow. The run is already started and
 *     billing; swallowing the failure would return an HTTP 200 with an
 *     empty stream and hide that money is being spent on a run the caller
 *     never sees.
 */
async function buildRunStream(
  runId: string,
  options: { swallowLookupFailure: boolean },
): Promise<ReadableStream<WebAgentUIMessageChunk>> {
  try {
    const { getRun } = await import("workflow/api");
    return createCancelableReadableStream(
      getRun(runId).getReadable<WebAgentUIMessageChunk>(),
    );
  } catch (error) {
    if (!options.swallowLookupFailure) {
      throw error;
    }
    return new ReadableStream<WebAgentUIMessageChunk>({
      start(controller) {
        controller.close();
      },
    });
  }
}
