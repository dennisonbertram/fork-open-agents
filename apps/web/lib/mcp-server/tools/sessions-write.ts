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
 * Observability for #1230's Definition of Done: lets an operator confirm a
 * given session ran headless via
 * `grep '"event":"mcp.run.started"' logs | grep '"sessionId":"<id>"'`.
 * Ids and counts only — `deniedToolNames` is a fixed tool-name list, never
 * prompt or message text.
 */
function logMcpRunStarted(input: {
  requestId: string;
  userId: string;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  deniedToolNames: readonly string[];
  autoCommit: boolean | null;
  autoCreatePr: boolean | null;
}): void {
  console.info(
    "[mcp-server] headless run started",
    JSON.stringify({
      service: "mcp-server",
      event: "mcp.run.started",
      requestId: input.requestId,
      userId: input.userId,
      sessionId: input.sessionId,
      chatId: input.chatId,
      workflowRunId: input.workflowRunId,
      unattended: true,
      deniedToolNames: input.deniedToolNames,
      autoCommit: input.autoCommit,
      autoCreatePr: input.autoCreatePr,
    }),
  );
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
/**
 * Resolve which chat to stop, and the run slot it currently holds.
 *
 * The slot is read as-is and handed to `stopChatRun`, which distinguishes a
 * run the runtime no longer has (stale slot — cleared, reported as nothing to
 * stop) from a failure it cannot classify (propagated). Reconciling here
 * instead would be wrong in the dangerous direction:
 * `reconcileChatRunSlot` treats ANY status-lookup rejection as staleness and
 * clears the slot, so one transient error would make a live, billed run look
 * like nothing to stop — and drop its tracking slot on the way out.
 */
async function resolveChatForStop(
  sessionId: string,
  chatId: string | undefined,
): Promise<{ chatId: string; activeStreamId: string | null }> {
  if (chatId) {
    const chat = await getChatById(chatId);
    if (!chat || chat.sessionId !== sessionId) {
      return { chatId, activeStreamId: null };
    }
    return { chatId: chat.id, activeStreamId: chat.activeStreamId ?? null };
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

const startSessionInputSchema = z
  .object({
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    branch: z.string().min(1).optional(),
    prompt: z.string().min(1),
    runtimeMode: z.enum(["classic", "managed_runtime"]).optional(),
    // Forwarded straight into createSessionCore's own precedence (request
    // body > repo defaults > user preferences) and persisted on the session
    // row (autoCommitPushOverride / autoCreatePrOverride) — every later run
    // on this session, including send_message, inherits it. No per-run
    // workflow plumbing needed.
    autoCommit: z.boolean().optional(),
    autoCreatePr: z.boolean().optional(),
  })
  .strict();

export type StartSessionInput = z.infer<typeof startSessionInputSchema>;

export type StartSessionResult = {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  url: string;
  sandboxProvisioning: true;
};

const startSessionOutputSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  workflowRunId: z.string(),
  url: z.string(),
  sandboxProvisioning: z.literal(true),
});

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
    { buildHeadlessAgentOptions, HEADLESS_DENIED_TOOL_NAMES },
  ] = await Promise.all([
    import("@/lib/db/users"),
    import("@/lib/sessions/create-session"),
    import("@/lib/chat/start-run"),
    import("@/lib/rate-limit"),
    import("../headless-run-options"),
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
    autoCommitPush: input.autoCommit,
    autoCreatePr: input.autoCreatePr,
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
    agentOptions: buildHeadlessAgentOptions(),
  });
  const workflowRunId = requireFreshlyStartedRun(result, chat.id);
  logMcpRunStarted({
    requestId: ctx.requestId,
    userId: ctx.userId,
    sessionId: session.id,
    chatId: chat.id,
    workflowRunId,
    deniedToolNames: HEADLESS_DENIED_TOOL_NAMES,
    autoCommit: input.autoCommit ?? null,
    autoCreatePr: input.autoCreatePr ?? null,
  });

  return {
    sessionId: session.id,
    chatId: chat.id,
    workflowRunId,
    url: buildChatUrl(session.id, chat.id),
    sandboxProvisioning: true,
  };
}

const sendMessageInputSchema = z
  .object({
    sessionId: z.string().min(1),
    chatId: z.string().min(1).optional(),
    prompt: z.string().min(1),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export type SendMessageResult = {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  url: string;
};

const sendMessageOutputSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  workflowRunId: z.string(),
  url: z.string(),
});

export async function sendMessage(
  ctx: ToolCallerContext,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  // See the comment in startSession for why these are dynamic imports.
  const [
    { startChatRun },
    { buildMessagesFromDb },
    { buildHeadlessAgentOptions, HEADLESS_DENIED_TOOL_NAMES },
  ] = await Promise.all([
    import("@/lib/chat/start-run"),
    import("@/lib/chat/messages-from-db"),
    import("../headless-run-options"),
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
    agentOptions: buildHeadlessAgentOptions(),
  });
  const workflowRunId = requireFreshlyStartedRun(result, chatId);
  logMcpRunStarted({
    requestId: ctx.requestId,
    userId: ctx.userId,
    sessionId: record.id,
    chatId,
    workflowRunId,
    deniedToolNames: HEADLESS_DENIED_TOOL_NAMES,
    // send_message has no per-message auto-commit/PR override — the
    // session-level default from start_session already applies.
    autoCommit: null,
    autoCreatePr: null,
  });

  return {
    sessionId: record.id,
    chatId,
    workflowRunId,
    url: buildChatUrl(record.id, chatId),
  };
}

const stopRunInputSchema = z
  .object({
    sessionId: z.string().min(1),
    chatId: z.string().min(1).optional(),
  })
  .strict();

export type StopRunInput = z.infer<typeof stopRunInputSchema>;

export type StopRunResult = {
  sessionId: string;
  chatId: string;
  stopped: boolean;
  workflowRunId: string | null;
};

const stopRunOutputSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  stopped: z.boolean(),
  workflowRunId: z.string().nullable(),
});

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
    name: "open_agents_start_session",
    title: "Start Open Agents Session",
    description:
      "Open Agents: create a new Open Agents session against a GitHub repo — provisions a fresh cloud sandbox and starts a billed agent run with the given prompt. Not idempotent: every call spins up a new sandbox and a new run, even with identical inputs. Returns immediately, before the sandbox finishes provisioning; poll `open_agents_get_session` until its `workspace` field reports ready before assuming the sandbox is usable.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: startSessionInputSchema,
    outputSchema: startSessionOutputSchema,
    annotations: {
      readOnlyHint: false,
      // The spec's default is destructive, and that default is correct here:
      // the run this launches inherits the user's auto-commit/auto-PR
      // settings, so it can delete files, rewrite a branch, and push. Claiming
      // otherwise is what lets a client auto-approve it without asking.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: startSession,
  }),
  defineTool({
    name: "open_agents_send_message",
    title: "Send Message to Open Agents Session",
    description:
      "open_agents_send_message sends a prompt into an existing Open Agents cloud coding session's chat and starts a new billed agent run — it is not a chat, email, or Slack message to a person. Omit `chatId` to target the session's most recently active chat; the result's `chatId` field always reports which chat the run actually used. Fails with a conflict error (carrying the live `workflowRunId`) if a run is already active on that chat.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: sendMessageInputSchema,
    outputSchema: sendMessageOutputSchema,
    annotations: {
      readOnlyHint: false,
      // The spec's default is destructive, and that default is correct here:
      // the run this launches inherits the user's auto-commit/auto-PR
      // settings, so it can delete files, rewrite a branch, and push. Claiming
      // otherwise is what lets a client auto-approve it without asking.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: sendMessage,
  }),
  defineTool({
    name: "open_agents_stop_run",
    title: "Stop Open Agents Run",
    description:
      "Open Agents: cancel the active agent run on an Open Agents session's chat. Idempotent — calling it twice, or calling it when nothing is running, is safe: it resolves with `stopped` false and `workflowRunId` null rather than an error. Omit `chatId` to target the session's most recently active chat; the result's `chatId` field reports which chat was targeted.",
    scope: SESSION_WRITE_SCOPE,
    inputSchema: stopRunInputSchema,
    outputSchema: stopRunOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: stopRun,
  }),
];
