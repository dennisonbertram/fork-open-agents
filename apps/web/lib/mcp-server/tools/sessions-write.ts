import { nanoid } from "nanoid";
import { z } from "zod";
import type { WebAgentUIMessage } from "@/app/types";
import type { StartChatRunResult } from "@/lib/chat/start-run";
import {
  getChatById,
  getChatsBySessionId,
  getSessionMetadataById,
} from "@/lib/db/sessions";
import { getAuthBaseURLFallback } from "@/lib/auth/base-url";
import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
} from "@/lib/github/urls";
import { buildChatUrl, McpToolError } from "../context";
import type { McpScope } from "../context";
// Type-only import to avoid an ESM circular value dependency with registry.ts
// — same reasoning as sessions-read.ts's identical `defineTool` shim.
import type { AnyMcpToolDefinition, McpToolDefinition } from "../registry";

function defineTool<TSchema extends z.ZodTypeAny, TOutput>(
  definition: McpToolDefinition<TSchema, TOutput>,
): McpToolDefinition<TSchema, TOutput> {
  return definition;
}

const SESSION_WRITE_SCOPE: McpScope = "sessions:write";
const SESSION_CREATE_RATE_LIMIT = 10;
const SESSION_CREATE_RATE_WINDOW_MS = 60_000;
const TITLE_PREVIEW_CHARS = 80;

type ToolCallerContext = {
  userId: string;
  scopes: string[];
  requestId: string;
};

type OwnedSessionRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionMetadataById>>
>;

async function requireOwnedSession(
  userId: string,
  sessionId: string,
  options: { rejectArchived?: boolean } = {},
): Promise<OwnedSessionRecord> {
  const record = await getSessionMetadataById(sessionId);
  if (!record || record.userId !== userId) {
    throw new McpToolError("not_found", `Session ${sessionId} was not found.`);
  }
  // The browser route refuses a turn on an archived session (its sandbox is
  // torn down), so an MCP token must not be a way around that — otherwise a
  // run bills for work against a workspace that no longer exists. Cancelling
  // an archived session's run stays allowed: stopping is always safe.
  if (options.rejectArchived && record.status === "archived") {
    throw new McpToolError(
      "invalid_request",
      `Session ${sessionId} is archived.`,
    );
  }
  return record;
}

function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > TITLE_PREVIEW_CHARS
    ? `${trimmed.slice(0, TITLE_PREVIEW_CHARS)}...`
    : trimmed;
}

function buildUserMessage(prompt: string): WebAgentUIMessage {
  return {
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  } as WebAgentUIMessage;
}

function requestOrigin(): string {
  return getAuthBaseURLFallback() ?? "http://localhost:3000";
}

/**
 * Defers background work until after the response is sent.
 *
 * The prewarm kick this schedules provisions a real sandbox, which takes
 * minutes. Running it inline holds the MCP response open for that whole time —
 * observed in production as a start_session call that never returned, even
 * though the session had already been created and the run started. The browser
 * route avoids this by passing next/server's `after`; do the same.
 *
 * Imported dynamically so this module stays importable outside a request (its
 * unit tests, and any other non-request caller). If there is no request scope
 * to defer into, SKIP the prewarm rather than falling back to running it
 * inline: prewarming is only a latency optimization, and the workflow
 * provisions the sandbox on demand regardless.
 */
function scheduleAfterResponse(callback: () => Promise<void>): void {
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => callback());
    } catch (error) {
      console.warn(
        "[mcp-server] skipped sandbox prewarm: no request scope to defer into",
        JSON.stringify({
          service: "mcp-server",
          event: "mcp.prewarm.skipped",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  })();
}

/**
 * `startChatRun`'s "resumed" and "conflict" outcomes both mean a run is
 * already live on this chat — a caller sending a new message can't safely
 * layer it on top. Only "started" is a clean result for a write tool.
 */
function requireFreshlyStartedRun(
  result: StartChatRunResult,
  chatId: string,
): string {
  if (result.status === "started") {
    return result.runId;
  }
  throw new McpToolError(
    "conflict",
    `Chat ${chatId} already has a run in progress.`,
    { workflowRunId: result.runId },
  );
}

/**
 * Resolves the chat a send_message/start_session turn runs against: the
 * explicit chatId if given (must belong to the session), otherwise the
 * session's most recently active chat.
 */
async function resolveChatForSend(
  sessionId: string,
  chatId: string | undefined,
): Promise<string> {
  if (chatId) {
    const chat = await getChatById(chatId);
    if (!chat || chat.sessionId !== sessionId) {
      throw new McpToolError("not_found", `Chat ${chatId} was not found.`);
    }
    return chat.id;
  }

  const chats = await getChatsBySessionId(sessionId);
  const mostRecent = chats[0];
  if (!mostRecent) {
    throw new McpToolError("not_found", `Session ${sessionId} has no chats.`);
  }
  return mostRecent.id;
}

/**
 * Resolves the chat + its current activeStreamId for stop_run.
 *
 * Deliberately does NOT throw when an explicit chatId is missing or belongs
 * to a different session — it degrades to `activeStreamId: null`, which
 * `stopChatRun` already treats as a safe no-op. That keeps a guessed/foreign
 * chatId from ever cancelling a run it doesn't own, without stop_run needing
 * its own separate ownership-violation error shape.
 */
async function resolveChatForStop(
  sessionId: string,
  chatId: string | undefined,
): Promise<{ chatId: string; activeStreamId: string | null }> {
  if (chatId) {
    const chat = await getChatById(chatId);
    if (chat && chat.sessionId === sessionId) {
      return { chatId: chat.id, activeStreamId: chat.activeStreamId ?? null };
    }
    return { chatId, activeStreamId: null };
  }

  const chats = await getChatsBySessionId(sessionId);
  const mostRecent = chats[0];
  if (!mostRecent) {
    throw new McpToolError("not_found", `Session ${sessionId} has no chats.`);
  }
  return {
    chatId: mostRecent.id,
    activeStreamId: mostRecent.activeStreamId ?? null,
  };
}

const startSessionInputSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  branch: z.string().min(1).optional(),
  prompt: z.string().min(1),
  runtimeMode: z.enum(["classic", "managed_runtime"]).optional(),
});

export type StartSessionInput = z.infer<typeof startSessionInputSchema>;

export type StartSessionResult = {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  url: string;
  sandboxProvisioning: true;
};

export async function startSession(
  ctx: ToolCallerContext,
  input: StartSessionInput,
): Promise<StartSessionResult> {
  // Dynamic imports below (also used in sendMessage/stopRun) are deliberate,
  // not incidental: registry.ts statically imports this module, so a
  // top-level `import ... from "@/lib/chat/start-run"` etc. here would force
  // every OTHER test that imports the registry (registry.test.ts,
  // sessions-read.test.ts) to also complete a matching mock.module list for
  // modules they never actually exercise — the same Bun mock-completeness
  // gotcha called out project-wide, just one hop further down the graph.
  // Deferring the import into the handler body keeps those unrelated tests'
  // mocks untouched, since they never call these handlers.
  const [
    { getUserIdentity },
    { createSessionCore },
    { startChatRun },
    { checkRateLimit, rateLimitKey },
  ] = await Promise.all([
    import("@/lib/db/users"),
    import("@/lib/sessions/create-session"),
    import("@/lib/chat/start-run"),
    import("@/lib/rate-limit"),
  ]);

  const limited = await checkRateLimit({
    key: rateLimitKey(["sessions-create", ctx.userId]),
    limit: SESSION_CREATE_RATE_LIMIT,
    windowMs: SESSION_CREATE_RATE_WINDOW_MS,
  });
  if (limited) {
    throw new McpToolError(
      "rate_limited",
      "Too many sessions created recently. Try again shortly.",
    );
  }

  // Go through createSessionCore rather than inserting a session and a chat
  // directly. It is the same path the browser uses, so an MCP-started session
  // picks up the user's default model and inference profile (otherwise the run
  // silently executes on the schema default and bills through the platform
  // gateway instead of the user's own key), their repo defaults for branch and
  // auto-commit behavior, and their Composio selection — and it creates the
  // session and its first chat in one transaction rather than two inserts that
  // can leave an orphaned session behind.
  // These strings end up inside a clone URL, so validate them the same way the
  // browser route does before they reach the sandbox.
  if (
    !(
      isValidGitHubRepoOwner(input.repoOwner) &&
      isValidGitHubRepoName(input.repoName)
    )
  ) {
    throw new McpToolError(
      "invalid_request",
      `"${input.repoOwner}/${input.repoName}" is not a valid GitHub repository.`,
    );
  }

  const identity = await getUserIdentity(ctx.userId);
  if (!identity) {
    throw new McpToolError("not_found", "This account was not found.");
  }

  const { session, chat } = await createSessionCore({
    userId: ctx.userId,
    username: identity.username,
    name: identity.name ?? undefined,
    title: deriveTitle(input.prompt),
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    // Without a cloneUrl the sandbox never clones anything: the runtime treats
    // the session as having no repo at all, skips repo-access verification and
    // the installation token, and initializes an empty git repo instead. The
    // run would bill against a sandbox containing none of the code the prompt
    // refers to, while this tool reported success. The browser always sends
    // this for a repo-backed session.
    cloneUrl: `https://github.com/${input.repoOwner}/${input.repoName}`,
    branch: input.branch,
    runtimeMode: input.runtimeMode,
    scheduleBackgroundWork: scheduleAfterResponse,
  });

  const result = await startChatRun({
    chatId: chat.id,
    sessionId: session.id,
    userId: ctx.userId,
    messages: [buildUserMessage(input.prompt)],
    requestUrl: requestOrigin(),
    requestId: ctx.requestId,
    authSession: null,
  });
  const workflowRunId = requireFreshlyStartedRun(result, chat.id);

  return {
    sessionId: session.id,
    chatId: chat.id,
    workflowRunId,
    url: buildChatUrl(session.id, chat.id),
    sandboxProvisioning: true,
  };
}

const sendMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1).optional(),
  prompt: z.string().min(1),
});

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export type SendMessageResult = {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  url: string;
};

export async function sendMessage(
  ctx: ToolCallerContext,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  // See the comment in startSession for why these are dynamic imports.
  const [{ startChatRun }, { buildMessagesFromDb }] = await Promise.all([
    import("@/lib/chat/start-run"),
    import("@/lib/chat/messages-from-db"),
  ]);

  const record = await requireOwnedSession(ctx.userId, input.sessionId, {
    rejectArchived: true,
  });
  const chatId = await resolveChatForSend(record.id, input.chatId);
  const userMessage = buildUserMessage(input.prompt);
  const messages = await buildMessagesFromDb(chatId, userMessage);

  const result = await startChatRun({
    chatId,
    sessionId: record.id,
    userId: ctx.userId,
    messages,
    requestUrl: requestOrigin(),
    requestId: ctx.requestId,
    authSession: null,
  });
  const workflowRunId = requireFreshlyStartedRun(result, chatId);

  return {
    sessionId: record.id,
    chatId,
    workflowRunId,
    url: buildChatUrl(record.id, chatId),
  };
}

const stopRunInputSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1).optional(),
});

export type StopRunInput = z.infer<typeof stopRunInputSchema>;

export type StopRunResult = {
  sessionId: string;
  chatId: string;
  stopped: boolean;
  workflowRunId: string | null;
};

export async function stopRun(
  ctx: ToolCallerContext,
  input: StopRunInput,
): Promise<StopRunResult> {
  // See the comment in startSession for why this is a dynamic import.
  const { stopChatRun } = await import("@/lib/chat/start-run");

  const record = await requireOwnedSession(ctx.userId, input.sessionId);
  const { chatId, activeStreamId } = await resolveChatForStop(
    record.id,
    input.chatId,
  );

  const result = await stopChatRun({ chatId, activeStreamId });

  return {
    sessionId: record.id,
    chatId,
    stopped: result.stopped,
    workflowRunId: result.workflowRunId,
  };
}

export const sessionWriteTools: readonly AnyMcpToolDefinition[] = [
  defineTool({
    name: "start_session",
    description:
      "Create a new session against a repo and start an agent run with the given prompt. Returns immediately without waiting for the sandbox — sandboxProvisioning is always true, so poll get_session until it reports ready before assuming the sandbox is usable.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: startSessionInputSchema,
    handler: startSession,
  }),
  defineTool({
    name: "send_message",
    description:
      "Send a message to an existing session's chat and start an agent run. Fails with a conflict error (carrying the live workflowRunId) if a run is already active on that chat.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: sendMessageInputSchema,
    handler: sendMessage,
  }),
  defineTool({
    name: "stop_run",
    description:
      "Cancel the active agent run on a session's chat. Idempotent — stopped:false with no error means nothing was running.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: stopRunInputSchema,
    handler: stopRun,
  }),
];
