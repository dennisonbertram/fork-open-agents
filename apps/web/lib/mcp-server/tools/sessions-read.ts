import { z } from "zod";
import {
  countChatMessages,
  countSessionsByUserId,
  getChatById,
  getChatSummariesBySessionId,
  getChatsBySessionId,
  getRecentChatMessages,
  getSessionDiffById,
  getSessionMetadataById,
  getSessionsWithUnreadByUserId,
  // Type-only: db/sessions.ts is mocked wholesale in every test that loads
  // this module (transitively via registry.ts), so pulling in a runtime
  // value this module doesn't otherwise use would require every one of
  // those mocks to also export it, or module evaluation throws before any
  // test in this file runs. `SESSION_SORTS` (the runtime array) is
  // deliberately re-declared locally below instead of imported for the same
  // reason.
  type SessionsSort,
} from "@/lib/db/sessions";
import { getLatestWorkflowRunStatusBySessionId } from "@/lib/db/workflow-runs";
import { getLatestSessionEventByNames } from "@/lib/observability/session-event-lookup";
import {
  buildChatUrl,
  buildSessionUrl,
  MCP_SCOPES,
  McpToolError,
} from "../context";
import type { McpScope } from "../context";
import {
  isResumable,
  type McpActivityState,
  type McpLastRunOutcome,
  type McpSessionState,
  type McpWorkspaceState,
  toActivityState,
  toLastRunOutcome,
  toSessionState,
  toWorkspaceState,
} from "../session-state";
import { toIsoString } from "../timestamps";
import { toRunUpdate, type McpRunUpdate } from "./session-updates";
import {
  buildToolTrace,
  type McpToolTraceEntry,
  type RawMessagePart,
} from "../tool-trace";
// Type-only: registry.ts imports the VALUE `sessionReadTools` from this
// module, so a runtime import back (e.g. `defineMcpTool`) would create an
// ESM circular value dependency that throws a TDZ ReferenceError whenever
// this module is the load entry (as in this file's own test). `defineMcpTool`
// is a pure identity function, so a local equivalent is behaviorally
// identical without reintroducing the cycle.
import type {
  AnyMcpToolDefinition,
  McpToolAnnotations,
  McpToolDefinition,
} from "../registry";

function defineTool<TSchema extends z.ZodTypeAny, TOutput>(
  definition: McpToolDefinition<TSchema, TOutput>,
): McpToolDefinition<TSchema, TOutput> {
  return definition;
}

export const DEFAULT_SESSION_LIMIT = 20;
export const MAX_SESSION_LIMIT = 50;
export const DEFAULT_MESSAGE_LIMIT = 20;
export const MAX_MESSAGE_LIMIT = 50;
// Ceiling on the optional per-message cap a client can request for a cheap
// scan — bounds the input, not a default; full text is returned unless a
// caller asks for less.
export const MAX_MESSAGE_CHAR_LIMIT = 20_000;
// Response-level character budget for get_messages. A 20-message window
// measured at roughly 30k characters in production; this leaves headroom for
// full text plus opt-in tool traces while still bounding the worst case (raw
// `parts` JSON has reached 464,565 characters for a single message).
// ponytail: a flat char budget, not a real token/byte accounting — revisit if
// it starts tripping on ordinary windows in practice.
export const RESPONSE_CHAR_BUDGET = 200_000;
export const MAX_DIFF_FILES = 100;

const SESSION_READ_SCOPE: McpScope = "sessions:read";

// All six tools in this file only read Open Agents data — none of them can
// mutate a session, so every one gets the same read-only annotation pair.
const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

// `runMcpTool` always hands handlers a real `McpToolContext`, whose `scopes`
// field is narrowed to `McpScope[]`. These exported handlers are also called
// directly (bypassing the registry) with a plain `string[]` scopes array —
// exactly the type `McpToolContext` structurally widens to, since
// `McpScope[]` is assignable to `string[]`. Accepting that wider shape here
// keeps both call sites type-safe without weakening `McpToolContext` itself.
type ToolCallerContext = {
  userId: string;
  scopes: string[];
  requestId: string;
};

export type McpSessionSummary = {
  id: string;
  title: string;
  /** Free-text tag the calling agent supplied at creation to group a
   * fan-out batch of sessions. Null when the session has none — not a
   * state, not a status, carries no behavior. */
  label: string | null;
  state: McpSessionState;
  workspace: McpWorkspaceState;
  resumable: boolean;
  activity: McpActivityState;
  /** How the session's most recently recorded run ended, or null when it has
   * no run yet. A third axis, distinct from `state` and `activity` — see
   * `toLastRunOutcome` in session-state.ts. Caution when reading alongside
   * `activity`: at turn end `activity` clears to idle a moment before this
   * field is written, so a just-finished session can briefly pair
   * `activity: "idle"` with a null here, same as a never-run session — re-read
   * shortly before concluding "never ran". */
  lastRunOutcome: McpLastRunOutcome | null;
  repo: string | null;
  branch: string | null;
  linesAdded: number;
  linesRemoved: number;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  hasUnread: boolean;
  isStreaming: boolean;
  latestChatId: string | null;
  lastActivityAt: string;
  createdAt: string;
  url: string;
};

export type McpChatSummary = {
  id: string;
  title: string;
  isStreaming: boolean;
  hasUnread: boolean;
  lastAssistantMessageAt: string | null;
  createdAt: string;
  url: string;
};

// Exact event names app/workflows/chat.ts emits for auto-commit / auto-PR
// outcomes (#1246). Re-declared here by hand rather than imported — chat.ts
// is a Next.js workflow route module, not a library this package can import
// from, and re-declaring is how the rest of this file already handles the
// analogous SESSION_SORTS drift risk (see its comment above). Reusing these
// literal strings, instead of a new enum, is the "keep the event vocabulary"
// instruction from #1246: session_events already carries the exact reason an
// auto-commit or auto-PR attempt failed or was skipped; get_session below
// only adds a read path for it.
const AUTO_COMMIT_EVENT_NAMES = [
  "workflow.auto_commit.started",
  "workflow.auto_commit.succeeded",
  "workflow.auto_commit.failed",
  "workflow.auto_commit.skipped",
] as const;
const AUTO_PR_EVENT_NAMES = [
  "workflow.auto_pr.started",
  "workflow.auto_pr.succeeded",
  "workflow.auto_pr.failed",
  "workflow.auto_pr.skipped",
] as const;

// Mirrors sessionEvents.status (apps/web/lib/db/schema.ts) exactly — the
// point of this field is to expose that same vocabulary, not a new one.
export type McpGitAutomationEventStatus =
  | "started"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped"
  | "info";

export type McpGitAutomationEvent = {
  eventName: string;
  status: McpGitAutomationEventStatus;
  summary: string | null;
  occurredAt: string;
};

export type McpSessionDetail = {
  id: string;
  title: string;
  state: McpSessionState;
  workspace: McpWorkspaceState;
  resumable: boolean;
  activity: McpActivityState;
  /** How the session's most recently recorded run ended, or null when it has
   * no run yet. A third axis, distinct from `state` and `activity` — see
   * `toLastRunOutcome` in session-state.ts. Caution when reading alongside
   * `activity`: at turn end `activity` clears to idle a moment before this
   * field is written, so a just-finished session can briefly pair
   * `activity: "idle"` with a null here, same as a never-run session — re-read
   * shortly before concluding "never ran". */
  lastRunOutcome: McpLastRunOutcome | null;
  /** The most recently recorded auto-commit attempt for this session (start,
   * success, failure, or "no changes to commit"), or null when auto-commit
   * has never run. `status: "failed"` is the #1246 signal: session_events
   * already carried the exact push-rejection reason, but nothing surfaced it
   * to an MCP client — a run could complete while its work was never saved. */
  lastAutoCommitEvent: McpGitAutomationEvent | null;
  /** The most recently recorded auto-PR attempt, same shape and same
   * null-when-never-run rule as `lastAutoCommitEvent`. `status: "skipped"`
   * covers both a benign skip (nothing to open a PR for) and a downstream
   * skip caused by a failed auto-commit — check `lastAutoCommitEvent` first
   * to tell them apart. */
  lastAutoPrEvent: McpGitAutomationEvent | null;
  repo: string | null;
  branch: string | null;
  /** The branch a new working `branch` was cut from (#1251), or null when
   * either this session doesn't work on a new branch (`isNewBranch: false`)
   * or no base was recorded (a session created before this field existed, or
   * one where neither the caller nor repo settings named a starting
   * branch — the repository default applied instead). */
  baseBranch: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  linesAdded: number;
  linesRemoved: number;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  runtimeMode: "classic" | "managed_runtime";
  hasUnread: boolean;
  isStreaming: boolean;
  chats: McpChatSummary[];
};

export type McpMessageSummary = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  /** Full message text — never cut except by an explicit `messageCharLimit`
   * or the response-level budget, both of which set `capped` / `truncated`. */
  text: string;
  /** The true length of `text` before any capping, so a capped caller still
   * knows how much was left out. */
  chars: number;
  /** True when `text` was cut short by the caller's own `messageCharLimit`. */
  capped: boolean;
  hasToolCalls: boolean;
  /** Present only when the caller passed `includeToolTrace: true`. */
  toolTrace?: McpToolTraceEntry[];
};

export type McpDiffFileSummary = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
};

export type WhoamiResult = {
  userId: string;
  scopes: McpScope[];
  requestId: string;
};

// Kept in sync with `SESSION_SORTS` (lib/db/sessions.ts) by hand rather than
// imported — see the `SessionsSort` type-only import above for why a runtime
// import here would break every test that mocks `@/lib/db/sessions`.
// `satisfies` still catches drift: this fails to typecheck the moment the two
// diverge.
const SESSION_SORTS = [
  "created_desc",
  "created_asc",
  "activity_desc",
  "activity_asc",
] as const satisfies readonly SessionsSort[];

const listSessionsInputSchema = z
  .object({
    status: z.enum(["all", "active", "archived"]).default("active"),
    // Exact match against the free-text label set at creation. Omitting it
    // returns every session matching `status`, same as before this filter
    // existed.
    label: z.string().min(1).optional(),
    // Defaults to created_desc — the fixed ordering every existing caller
    // already saw, so omitting `sort` changes nothing.
    sort: z.enum(SESSION_SORTS).default("created_desc"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SESSION_LIMIT)
      .default(DEFAULT_SESSION_LIMIT),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

// `sort` carries a zod `.default()`, so the schema's own parsed-output type
// (what `z.infer` gives) makes it required — accurate for the real
// runMcpTool path, which always parses through the schema first. Handlers
// are also called directly in tests, bypassing that parse, so `sort` is
// re-declared optional here; `listSessions` defaults it itself for that
// case (see the comment at its call site).
export type ListSessionsInput = Omit<
  z.infer<typeof listSessionsInputSchema>,
  "sort"
> & {
  sort?: SessionsSort;
};

export type ListSessionsResult = {
  sessions: McpSessionSummary[];
  /** Rows on this page. */
  returned: number;
  /** Sessions matching the same status filter across the whole account. */
  total: number;
  limit: number;
  offset: number;
};

const getSessionInputSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export type GetSessionInput = z.infer<typeof getSessionInputSchema>;

const getMessagesInputSchema = z
  .object({
    sessionId: z.string().min(1),
    chatId: z.string().min(1).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_MESSAGE_LIMIT)
      .default(DEFAULT_MESSAGE_LIMIT),
    // Optional, no default: omitting it returns full text. When set, each
    // message's `text` is cut to this many characters and flagged `capped`;
    // `chars` still reports the true length.
    messageCharLimit: z
      .number()
      .int()
      .min(1)
      .max(MAX_MESSAGE_CHAR_LIMIT)
      .optional(),
    // Optional, no default: the trace is opt-in because a tool-heavy window
    // costs materially more of the response budget.
    includeToolTrace: z.boolean().optional(),
  })
  .strict();

export type GetMessagesInput = z.infer<typeof getMessagesInputSchema>;

export type GetMessagesResult = {
  sessionId: string;
  chatId: string;
  url: string;
  total: number;
  returned: number;
  messages: McpMessageSummary[];
  /** Ids of messages whose `text` was cut further by the response budget
   * (on top of any `messageCharLimit` capping already applied). */
  truncated: string[];
  /** Ids of messages dropped entirely from `messages` by the response
   * budget. Never silent — a client can tell exactly what it did not get. */
  omitted: string[];
};

const getDiffSummaryInputSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export type GetDiffSummaryInput = z.infer<typeof getDiffSummaryInputSchema>;

export type GetDiffSummaryResult = {
  sessionId: string;
  url: string;
  hasCachedDiff: boolean;
  computedAt: string | null;
  baseRef: string | null;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: McpDiffFileSummary[];
  truncated: boolean;
};

// Types derived from the real db helpers so we never duplicate (and drift
// from) their row shapes, and never resort to `any`.
type SessionMetadataRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionMetadataById>>
>;
type SessionDiffRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionDiffById>>
>;
type SessionWithUnreadRow = Awaited<
  ReturnType<typeof getSessionsWithUnreadByUserId>
>[number];
type ChatSummaryRow = Awaited<
  ReturnType<typeof getChatSummariesBySessionId>
>[number];
type ChatMessageRow = Awaited<ReturnType<typeof getRecentChatMessages>>[number];

function toRepo(
  repoOwner: string | null,
  repoName: string | null,
): string | null {
  return repoOwner && repoName ? `${repoOwner}/${repoName}` : null;
}

function toGitAutomationEvent(
  event: Awaited<ReturnType<typeof getLatestSessionEventByNames>>,
): McpGitAutomationEvent | null {
  if (!event) {
    return null;
  }
  return {
    eventName: event.eventName,
    status: event.status,
    summary: event.summary,
    occurredAt: event.createdAt,
  };
}

/**
 * get_session's primary job — session state, chats, workspace — must not go
 * down because this side lookup did. A transient DB error here degrades to
 * "no recorded event" rather than failing the whole get_session call.
 */
async function safeLatestGitAutomationEvent(params: {
  sessionId: string;
  eventNames: readonly string[];
}): Promise<Awaited<ReturnType<typeof getLatestSessionEventByNames>>> {
  try {
    return await getLatestSessionEventByNames(params);
  } catch (error) {
    console.error(
      "[mcp-server] failed to load git-automation event",
      JSON.stringify({
        service: "mcp-server",
        event: "mcp.get_session.git_automation_lookup_failed",
        sessionId: params.sessionId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

function toSessionSummary(row: SessionWithUnreadRow): McpSessionSummary {
  const state = toSessionState(row.status);
  return {
    id: row.id,
    title: row.title,
    label: row.label ?? null,
    state,
    workspace: toWorkspaceState({
      lifecycleState: row.lifecycleState,
      sandboxExpiresAt: row.sandboxExpiresAt,
      lifecycleUpdatedAt: row.updatedAt,
    }),
    resumable: isResumable(state),
    activity: toActivityState({
      hasActiveRunSlot: row.hasStreaming,
      // Deliberately not `lastActivityAt`: that is the newest activity across
      // every chat in the session, which would mask a stale slot on one chat
      // behind a fresh message on another.
      lastActivityAt: row.activeRunSlotAt,
    }),
    lastRunOutcome: toLastRunOutcome(row.lastRunStatus),
    repo: toRepo(row.repoOwner, row.repoName),
    branch: row.branch,
    linesAdded: row.linesAdded ?? 0,
    linesRemoved: row.linesRemoved ?? 0,
    prNumber: row.prNumber,
    prStatus: row.prStatus,
    hasUnread: row.hasUnread,
    isStreaming: row.hasStreaming,
    latestChatId: row.latestChatId,
    lastActivityAt:
      toIsoString(row.lastActivityAt) ?? toIsoString(row.createdAt) ?? "",
    createdAt: toIsoString(row.createdAt) ?? "",
    url: buildSessionUrl(row.id),
  };
}

function toChatSummary(
  sessionId: string,
  chat: ChatSummaryRow,
): McpChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    isStreaming: chat.isStreaming,
    hasUnread: chat.hasUnread,
    lastAssistantMessageAt: chat.lastAssistantMessageAt
      ? toIsoString(chat.lastAssistantMessageAt)
      : null,
    createdAt: toIsoString(chat.createdAt) ?? "",
    url: buildChatUrl(sessionId, chat.id),
  };
}

async function requireOwnedSessionMetadata(
  ctx: { userId: string },
  sessionId: string,
): Promise<SessionMetadataRecord> {
  const record = await getSessionMetadataById(sessionId);
  if (!record || record.userId !== ctx.userId) {
    throw new McpToolError("not_found", `Session ${sessionId} was not found.`);
  }
  return record;
}

async function requireOwnedSessionDiff(
  ctx: { userId: string },
  sessionId: string,
): Promise<SessionDiffRecord> {
  const record = await getSessionDiffById(sessionId);
  if (!record || record.userId !== ctx.userId) {
    throw new McpToolError("not_found", `Session ${sessionId} was not found.`);
  }
  return record;
}

// A message's `parts` jsonb column holds either the parts array directly, or
// the whole persisted UIMessage object with an array at `.parts`.
function extractMessageParts(raw: unknown): RawMessagePart[] {
  if (Array.isArray(raw)) {
    return raw as RawMessagePart[];
  }
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { parts?: unknown }).parts)
  ) {
    return (raw as { parts: RawMessagePart[] }).parts;
  }
  return [];
}

function buildMessageText(parts: RawMessagePart[]): string {
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasToolCallParts(parts: RawMessagePart[]): boolean {
  return parts.some(
    (part) =>
      typeof part?.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "dynamic-tool"),
  );
}

function toMessageSummary(
  row: ChatMessageRow,
  options: { messageCharLimit?: number; includeToolTrace: boolean },
): McpMessageSummary {
  const parts = extractMessageParts(row.parts);
  const fullText = buildMessageText(parts);
  const chars = fullText.length;
  const capped =
    options.messageCharLimit !== undefined && chars > options.messageCharLimit;
  const text = capped ? fullText.slice(0, options.messageCharLimit) : fullText;

  const summary: McpMessageSummary = {
    id: row.id,
    role: row.role,
    createdAt: toIsoString(row.createdAt) ?? "",
    text,
    chars,
    capped,
    hasToolCalls: hasToolCallParts(parts),
  };
  if (options.includeToolTrace) {
    summary.toolTrace = buildToolTrace(parts);
  }
  return summary;
}

// Rough per-message JSON envelope cost (id/role/timestamp/braces) counted
// against the response budget alongside text and tool-trace chars.
// ponytail: an approximation, not exact byte accounting.
const MESSAGE_OVERHEAD_CHARS = 100;

function toolTraceCost(trace: McpToolTraceEntry[] | undefined): number {
  if (!trace) {
    return 0;
  }
  return trace.reduce(
    (sum, entry) => sum + entry.input.length + entry.output.length,
    0,
  );
}

function messageCost(message: McpMessageSummary): number {
  return (
    message.text.length +
    toolTraceCost(message.toolTrace) +
    MESSAGE_OVERHEAD_CHARS
  );
}

/**
 * Fit `messages` (oldest-to-newest) inside RESPONSE_CHAR_BUDGET, preferring
 * the newest messages intact since a headless check-in cares most about what
 * just happened. Anything that does not fit is reported, never silently cut:
 * a message that partially fits has its `text` shortened and its id added to
 * `truncated`; a message with no room at all is dropped and its id added to
 * `omitted`.
 */
function applyResponseBudget(messages: McpMessageSummary[]): {
  messages: McpMessageSummary[];
  truncated: string[];
  omitted: string[];
} {
  let remaining = RESPONSE_CHAR_BUDGET;
  const kept: McpMessageSummary[] = [];
  const truncated: string[] = [];
  const omitted: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) {
      continue;
    }
    const cost = messageCost(message);
    if (cost <= remaining) {
      kept.unshift(message);
      remaining -= cost;
      continue;
    }

    const overhead = MESSAGE_OVERHEAD_CHARS + toolTraceCost(message.toolTrace);
    const textBudget = remaining - overhead;
    if (textBudget > 0) {
      kept.unshift({ ...message, text: message.text.slice(0, textBudget) });
      truncated.push(message.id);
    } else {
      omitted.push(message.id);
    }
    remaining = 0;
    for (let j = i - 1; j >= 0; j--) {
      const older = messages[j];
      if (older) {
        omitted.push(older.id);
      }
    }
    break;
  }

  omitted.reverse();
  return { messages: kept, truncated, omitted };
}

function logMessagesRead(fields: {
  requestId: string;
  userId: string;
  sessionId: string;
  chatId: string;
  returned: number;
  total: number;
  chars: number;
  omitted: number;
  truncated: number;
}): void {
  // Never log message text, tool inputs, or tool outputs — only counts and
  // ids-worth of shape, none of which carries repository content.
  console.info(
    "[mcp-server] mcp.messages.read",
    JSON.stringify({
      service: "mcp-server",
      event: "mcp.messages.read",
      ...fields,
    }),
  );
}

// Cached diff (sessions.cachedDiff) is untyped jsonb — narrow defensively
// rather than trusting the persisted shape.
type CachedDiffShape = {
  files: McpDiffFileSummary[];
  baseRef?: string;
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
};

function isDiffFileLike(value: unknown): value is McpDiffFileSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    (candidate.status === "added" ||
      candidate.status === "modified" ||
      candidate.status === "deleted" ||
      candidate.status === "renamed") &&
    typeof candidate.additions === "number" &&
    typeof candidate.deletions === "number"
  );
}

function isCachedDiffLike(value: unknown): value is CachedDiffShape {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.files) ||
    !candidate.files.every(isDiffFileLike)
  ) {
    return false;
  }
  if (!candidate.summary || typeof candidate.summary !== "object") {
    return false;
  }
  const summary = candidate.summary as Record<string, unknown>;
  return (
    typeof summary.totalFiles === "number" &&
    typeof summary.totalAdditions === "number" &&
    typeof summary.totalDeletions === "number"
  );
}

export function whoami(
  ctx: ToolCallerContext,
  _input: Record<string, never>,
): Promise<WhoamiResult> {
  return Promise.resolve({
    userId: ctx.userId,
    // ctx.scopes is already validated McpScope[] on the real (runMcpTool)
    // call path; ToolCallerContext only widens the declared param type.
    scopes: ctx.scopes as McpScope[],
    requestId: ctx.requestId,
  });
}

/**
 * Observability: lets an operator tell whether a client is paging a filtered
 * or unfiltered list via
 * `grep '"event":"mcp.sessions.listed"' logs | grep '"userId":"<id>"'`.
 * `label` is deliberately a presence boolean, never the filter's own value —
 * it is user-supplied free text, so it is content, not an id or a count.
 */
function logSessionsListed(fields: {
  requestId: string;
  userId: string;
  label: boolean;
  sort: SessionsSort;
  returned: number;
  total: number;
}): void {
  console.info(
    "[mcp-server] mcp.sessions.listed",
    JSON.stringify({
      service: "mcp-server",
      event: "mcp.sessions.listed",
      ...fields,
    }),
  );
}

export async function listSessions(
  ctx: ToolCallerContext,
  input: ListSessionsInput,
): Promise<ListSessionsResult> {
  const labelFilter = input.label ? { label: input.label } : {};
  // `sort` carries a zod `.default()`, which only fills in on the real
  // runMcpTool path (its schema.parse call). Defaulting again here keeps a
  // direct handler call (as the tools' own unit tests make, bypassing
  // runMcpTool) behaving identically to an omitted `sort` over MCP.
  const sort = input.sort ?? "created_desc";

  const rows = await getSessionsWithUnreadByUserId(ctx.userId, {
    status: input.status,
    limit: input.limit,
    offset: input.offset,
    sort,
    ...labelFilter,
  });

  const sessions = rows.map(toSessionSummary);

  // The total rides along on the page query as COUNT(*) OVER (), so page and
  // total always describe one snapshot. Issuing a separate COUNT would let the
  // two observe different states — the count running before an insert and the
  // page after it — and a client told to stop at offset + returned >= total
  // would silently skip the new session. An empty page carries no window
  // value, so that one case falls back to a count query; a caller already at
  // or past the end cannot skip anything with a slightly stale total.
  const total =
    rows[0]?.totalCount ??
    (await countSessionsByUserId(ctx.userId, {
      status: input.status,
      ...labelFilter,
    }));

  logSessionsListed({
    requestId: ctx.requestId,
    userId: ctx.userId,
    label: Boolean(input.label),
    sort,
    returned: sessions.length,
    total,
  });

  return {
    sessions,
    returned: sessions.length,
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function getSession(
  ctx: ToolCallerContext,
  input: GetSessionInput,
): Promise<McpSessionDetail> {
  const record = await requireOwnedSessionMetadata(ctx, input.sessionId);
  // Independent lookups: a merged query filtered on both event-name sets at
  // once would let a more recent auto-PR row win "most recent" over an
  // older, still-relevant auto-commit failure (or vice versa) — see the
  // regression test for this in sessions-read.test.ts.
  const [chatRows, lastAutoCommitEvent, lastAutoPrEvent] = await Promise.all([
    getChatSummariesBySessionId(record.id, ctx.userId),
    safeLatestGitAutomationEvent({
      sessionId: record.id,
      eventNames: AUTO_COMMIT_EVENT_NAMES,
    }),
    safeLatestGitAutomationEvent({
      sessionId: record.id,
      eventNames: AUTO_PR_EVENT_NAMES,
    }),
  ]);
  const chats = chatRows.map((chat) => toChatSummary(record.id, chat));
  const state = toSessionState(record.status);
  // get_session's own single-row lookup only, per its own doc comment —
  // list_sessions gets the same field from a batched join in
  // getSessionsWithUnreadByUserId (lib/db/sessions.ts) instead, so neither
  // path turns a page of sessions into an N+1.
  const lastRunStatus = await getLatestWorkflowRunStatusBySessionId(record.id);

  return {
    id: record.id,
    title: record.title,
    state,
    workspace: toWorkspaceState({
      lifecycleState: record.lifecycleState,
      sandboxExpiresAt: record.sandboxExpiresAt,
      lifecycleUpdatedAt: record.updatedAt,
    }),
    resumable: isResumable(state),
    lastRunOutcome: toLastRunOutcome(lastRunStatus),
    lastAutoCommitEvent: toGitAutomationEvent(lastAutoCommitEvent),
    lastAutoPrEvent: toGitAutomationEvent(lastAutoPrEvent),
    // Bounded per chat: a run slot last touched longer ago than any run can
    // live is stale, not live work.
    activity: chatRows.some(
      (chat) =>
        toActivityState({
          hasActiveRunSlot: chat.isStreaming,
          lastActivityAt: chat.updatedAt,
        }) === "working",
    )
      ? "working"
      : "idle",
    repo: toRepo(record.repoOwner, record.repoName),
    branch: record.branch,
    baseBranch: record.baseBranch,
    url: buildSessionUrl(record.id),
    createdAt: toIsoString(record.createdAt) ?? "",
    updatedAt: toIsoString(record.updatedAt) ?? "",
    lastActivityAt: record.lastActivityAt
      ? toIsoString(record.lastActivityAt)
      : null,
    linesAdded: record.linesAdded ?? 0,
    linesRemoved: record.linesRemoved ?? 0,
    prNumber: record.prNumber,
    prStatus: record.prStatus,
    runtimeMode: record.runtimeMode,
    hasUnread: chats.some((chat) => chat.hasUnread),
    isStreaming: chats.some((chat) => chat.isStreaming),
    chats,
  };
}

export async function getMessages(
  ctx: ToolCallerContext,
  input: GetMessagesInput,
): Promise<GetMessagesResult> {
  const record = await requireOwnedSessionMetadata(ctx, input.sessionId);

  let chatId: string;
  if (input.chatId) {
    const chat = await getChatById(input.chatId);
    if (!chat || chat.sessionId !== record.id) {
      throw new McpToolError(
        "not_found",
        `Chat ${input.chatId} was not found.`,
      );
    }
    chatId = chat.id;
  } else {
    const chats = await getChatsBySessionId(record.id);
    const mostRecent = chats[0];
    if (!mostRecent) {
      throw new McpToolError("not_found", `Session ${record.id} has no chats.`);
    }
    chatId = mostRecent.id;
  }

  // Two reads on separate connections, so a message committed between them can
  // make `total` disagree with the returned window by one while a turn is
  // streaming. Accepted: this is a read-only reporting tool and the alternative
  // (one transaction) costs a connection round trip on every call.
  const [rows, total] = await Promise.all([
    getRecentChatMessages(chatId, input.limit),
    countChatMessages(chatId),
  ]);
  const rawMessages = rows.map((row) =>
    toMessageSummary(row, {
      messageCharLimit: input.messageCharLimit,
      includeToolTrace: input.includeToolTrace ?? false,
    }),
  );
  const { messages, truncated, omitted } = applyResponseBudget(rawMessages);

  logMessagesRead({
    requestId: ctx.requestId,
    userId: ctx.userId,
    sessionId: record.id,
    chatId,
    returned: messages.length,
    total,
    chars: messages.reduce((sum, message) => sum + message.text.length, 0),
    omitted: omitted.length,
    truncated: truncated.length,
  });

  return {
    sessionId: record.id,
    chatId,
    url: buildChatUrl(record.id, chatId),
    total,
    returned: messages.length,
    messages,
    truncated,
    omitted,
  };
}

export async function getDiffSummary(
  ctx: ToolCallerContext,
  input: GetDiffSummaryInput,
): Promise<GetDiffSummaryResult> {
  const record = await requireOwnedSessionDiff(ctx, input.sessionId);
  const url = buildSessionUrl(record.id);
  const cached: unknown = record.cachedDiff;

  if (!isCachedDiffLike(cached)) {
    return {
      sessionId: record.id,
      url,
      hasCachedDiff: false,
      computedAt: null,
      baseRef: null,
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: [],
      truncated: false,
    };
  }

  const files = cached.files.slice(0, MAX_DIFF_FILES).map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }));

  return {
    sessionId: record.id,
    url,
    hasCachedDiff: true,
    computedAt: record.cachedDiffUpdatedAt
      ? toIsoString(record.cachedDiffUpdatedAt)
      : null,
    baseRef: cached.baseRef ?? null,
    totalFiles: cached.summary.totalFiles,
    totalAdditions: cached.summary.totalAdditions,
    totalDeletions: cached.summary.totalDeletions,
    files,
    truncated: cached.files.length > MAX_DIFF_FILES,
  };
}

const getUpdatesInputSchema = z
  .object({
    // ISO 8601 timestamp. Everything after this counts as "new since the last
    // poll"; pass back the previous call's `cursor` here.
    since: z
      .string()
      .min(1)
      .refine((value) => Number.isFinite(new Date(value).getTime()), {
        message: "since must be an ISO 8601 timestamp",
      }),
    // Exact match against the free-text batch label, same as list_sessions and
    // start_session's `label` — narrows the answer to one fan-out batch.
    label: z.string().min(1).optional(),
    // Same default and ceiling as the other list tools in this file.
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_SESSION_LIMIT)
      .default(DEFAULT_SESSION_LIMIT),
  })
  .strict();

export type GetUpdatesInput = z.infer<typeof getUpdatesInputSchema>;

export type GetUpdatesResult = {
  /** The server's own "as of" timestamp. Pass this back as `since` on the next
   * poll rather than computing a boundary from the rows — the server picks a
   * monotonically-safe moment so nothing that finishes after it is re-asked for
   * and nothing already reported is silently repeated. */
  cursor: string;
  /** How many sessions' runs finished in the window, independent of any cap:
   * this is the true window count (COUNT(*) OVER()), so a caller for whom
   * `count > changes.length` knows the response was capped and can re-poll.
   * An explicit count (plus `note`) is what keeps an empty result unambiguous. */
  count: number;
  changes: McpRunUpdate[];
  /** A plainly-worded no-changes indication, non-null exactly when nothing
   * finished in the window — so an empty `changes` array is never ambiguous
   * against "the query failed". */
  note: string | null;
};

/**
 * Report which of the caller's sessions had a run finish since `since` — the
 * "what changed while I was away" read (#1270). MCP cannot push to a client, so
 * this is a cheap read the client polls; the caller passes the previous
 * response's `cursor` as the next `since`.
 *
 * Source of truth is `workflowRuns` filtered by the calling user and
 * `finishedAt > since` — deliberately NOT `session_events`, which fire
 * throughout a run and would report activity rather than completion.
 */
export async function getUpdates(
  ctx: ToolCallerContext,
  input: GetUpdatesInput,
): Promise<GetUpdatesResult> {
  // The server's "as of" moment, captured before the query so the window it
  // anchors never needs a client-computed boundary.
  const cursor = new Date().toISOString();
  // Loaded lazily (not a static import): this module is imported by registry
  // tests that mock `@/lib/db/workflow-runs` to just
  // getLatestWorkflowRunStatusBySessionId, and a static value import of the new
  // query would blow up their module graph at load time. Only the handler —
  // which those tests never invoke — touches it.
  const { getWorkflowRunsFinishedSince } =
    await import("@/lib/db/workflow-runs");
  const rows = await getWorkflowRunsFinishedSince({
    userId: ctx.userId,
    since: new Date(input.since),
    limit: input.limit,
    ...(input.label ? { label: input.label } : {}),
  });

  // Independent lookups, so a more recent auto-commit row can't mask an older
  // auto-PR outcome or vice versa — same rule as get_session.
  const changes = await Promise.all(
    rows.map(async (row) => {
      const [autoCommitEvent, autoPrEvent] = await Promise.all([
        safeLatestGitAutomationEvent({
          sessionId: row.sessionId,
          eventNames: AUTO_COMMIT_EVENT_NAMES,
        }),
        safeLatestGitAutomationEvent({
          sessionId: row.sessionId,
          eventNames: AUTO_PR_EVENT_NAMES,
        }),
      ]);
      return toRunUpdate(row, {
        lastAutoCommitEvent: toGitAutomationEvent(autoCommitEvent),
        lastAutoPrEvent: toGitAutomationEvent(autoPrEvent),
      });
    }),
  );

  const count = rows[0]?.totalCount ?? 0;
  const note =
    count === 0 ? `No sessions finished since ${input.since}.` : null;

  return { cursor, count, changes, note };
}

const sessionStateOutputSchema = z.enum(["active", "archived"]);
const workspaceStateOutputSchema = z.enum([
  "ready",
  "hibernated",
  "provisioning",
  "restoring",
  "failed",
  "none",
]);
const activityStateOutputSchema = z.enum(["working", "idle"]);
const lastRunOutcomeOutputSchema = z
  .enum([
    "completed",
    "aborted",
    "failed",
    "no_progress_fuse",
    "no_sandbox_step_cap",
    "max_steps",
    "repeated_tool_failure",
    "truncated",
    "awaiting_tool_approval",
    "ended_unexpectedly",
    // #1288
    "no_file_changes",
    "step_ceiling",
    "diff_violation",
  ])
  .nullable();
const prStatusOutputSchema = z.enum(["open", "merged", "closed"]).nullable();
const gitAutomationEventOutputSchema = z
  .object({
    eventName: z.string(),
    status: z.enum([
      "started",
      "running",
      "succeeded",
      "failed",
      "blocked",
      "skipped",
      "info",
    ]),
    summary: z.string().nullable(),
    occurredAt: z.string(),
  })
  .nullable();

const sessionSummaryOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  label: z.string().nullable(),
  state: sessionStateOutputSchema,
  workspace: workspaceStateOutputSchema,
  resumable: z.boolean(),
  activity: activityStateOutputSchema,
  lastRunOutcome: lastRunOutcomeOutputSchema,
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  prNumber: z.number().nullable(),
  prStatus: prStatusOutputSchema,
  hasUnread: z.boolean(),
  isStreaming: z.boolean(),
  latestChatId: z.string().nullable(),
  lastActivityAt: z.string(),
  createdAt: z.string(),
  url: z.string(),
});

const chatSummaryOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  isStreaming: z.boolean(),
  hasUnread: z.boolean(),
  lastAssistantMessageAt: z.string().nullable(),
  createdAt: z.string(),
  url: z.string(),
});

const toolTraceEntryOutputSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  state: z.string(),
  input: z.string(),
  inputTruncated: z.boolean(),
  output: z.string(),
  outputTruncated: z.boolean(),
});

const messageSummaryOutputSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  createdAt: z.string(),
  text: z.string(),
  chars: z.number(),
  capped: z.boolean(),
  hasToolCalls: z.boolean(),
  toolTrace: z.array(toolTraceEntryOutputSchema).optional(),
});

const diffFileSummaryOutputSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number(),
  deletions: z.number(),
});

const whoamiOutputSchema = z.object({
  userId: z.string(),
  scopes: z.array(z.enum(MCP_SCOPES)),
  requestId: z.string(),
});

const listSessionsOutputSchema = z.object({
  sessions: z.array(sessionSummaryOutputSchema),
  returned: z.number(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const getSessionOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: sessionStateOutputSchema,
  workspace: workspaceStateOutputSchema,
  resumable: z.boolean(),
  activity: activityStateOutputSchema,
  lastRunOutcome: lastRunOutcomeOutputSchema,
  lastAutoCommitEvent: gitAutomationEventOutputSchema,
  lastAutoPrEvent: gitAutomationEventOutputSchema,
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().nullable(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  prNumber: z.number().nullable(),
  prStatus: prStatusOutputSchema,
  runtimeMode: z.enum(["classic", "managed_runtime"]),
  hasUnread: z.boolean(),
  isStreaming: z.boolean(),
  chats: z.array(chatSummaryOutputSchema),
});

const getMessagesOutputSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  url: z.string(),
  total: z.number(),
  returned: z.number(),
  messages: z.array(messageSummaryOutputSchema),
  truncated: z.array(z.string()),
  omitted: z.array(z.string()),
});

const getDiffSummaryOutputSchema = z.object({
  sessionId: z.string(),
  url: z.string(),
  hasCachedDiff: z.boolean(),
  computedAt: z.string().nullable(),
  baseRef: z.string().nullable(),
  totalFiles: z.number(),
  totalAdditions: z.number(),
  totalDeletions: z.number(),
  files: z.array(diffFileSummaryOutputSchema),
  truncated: z.boolean(),
});

const runUpdateOutputSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  label: z.string().nullable(),
  lastRunOutcome: lastRunOutcomeOutputSchema,
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  prNumber: z.number().nullable(),
  prStatus: prStatusOutputSchema,
  lastAutoCommitEvent: gitAutomationEventOutputSchema,
  lastAutoPrEvent: gitAutomationEventOutputSchema,
  url: z.string(),
  finishedAt: z.string(),
});

const getUpdatesOutputSchema = z.object({
  cursor: z.string(),
  count: z.number(),
  changes: z.array(runUpdateOutputSchema),
  note: z.string().nullable(),
});

export const sessionReadTools: readonly AnyMcpToolDefinition[] = [
  defineTool({
    name: "open_agents_whoami",
    title: "Open Agents Identity",
    description:
      "Return the authenticated Open Agents identity for this MCP connection — Open Agents' own `userId`, granted `scopes`, and `requestId` — with no I/O against Open Agents data. Not the calling client's own identity or session.",
    scope: SESSION_READ_SCOPE,
    inputSchema: z.object({}).strict(),
    outputSchema: whoamiOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: whoami,
  }),
  defineTool({
    name: "open_agents_list_sessions",
    title: "List Open Agents Sessions",
    description:
      "List the caller's coding sessions in Open Agents — this MCP server's own sessions, not the calling client's own session — with lightweight `state`, `workspace`, `resumable`, `activity`, and `lastRunOutcome` fields plus repo and PR summaries. `state` (active/archived) is filing and matches the `status` input filter. `workspace` is the sandbox's own status (ready, hibernated, provisioning, restoring, failed, or none): only ready means a sandbox is live right now, and hibernated is the normal resting state — the sandbox is parked to stop billing and is restored automatically on the next message. `resumable` is true for every non-archived session, whatever its `workspace` says, because accepting new work is gated on filing alone; a hibernated or failed workspace is rebuilt on demand. `activity` is working only while a run is genuinely live. `lastRunOutcome` is a third, distinct axis from `state` and `activity`, reusing get_session's own vocabulary (`completed`, `aborted`, `failed`, the deliberate headless stops such as `no_progress_fuse` and `awaiting_tool_approval`, and the rest — see open_agents_get_session's description for the full list) or null when the session has no run yet. This is the field to check when fanning out several sessions: `activity: \"idle\"` alone cannot tell a healthy finish apart from a run stalled waiting on something, such as `awaiting_tool_approval` — only `lastRunOutcome` does. Same transient as get_session: `activity` clears to idle a moment before `lastRunOutcome` is written, so a just-finished session can briefly pair `activity: \"idle\"` with a null `lastRunOutcome`, indistinguishable from never-run; re-read shortly rather than concluding never-run. Pass `label` to narrow the page (and `total`) to sessions sharing that exact free-text tag — the same one `open_agents_start_session` accepts — which is how a client that did not start a fan-out batch can find it later. `sort` picks the page order (default `created_desc`); every option is stable across pages, so paging until offset + returned reaches total never skips or repeats a row even when several sessions share a timestamp. Returns `returned` (rows on this page) and `total` (all sessions matching the same status/label filters).",
    scope: SESSION_READ_SCOPE,
    inputSchema: listSessionsInputSchema,
    outputSchema: listSessionsOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: listSessions,
  }),
  defineTool({
    name: "open_agents_get_session",
    title: "Get Open Agents Session",
    description:
      "Get full detail for one Open Agents coding session (Open Agents' own session record, not the caller's MCP session) that the caller owns, including its `chats`, `state`, `workspace`, `resumable`, `activity`, and `lastRunOutcome`, without transcripts or diff bodies. `workspace` reports ready only while a sandbox is live right now; hibernated is the normal resting state and is restored automatically on the next message. `resumable` is true for every non-archived session, whatever its `workspace` says, and `activity` is working only while a run is genuinely live. `lastRunOutcome` is a third, distinct axis from `state` (filing) and `activity` (is a run live right now): it reports how the session's most recently recorded run ended — `completed`, `aborted` (user-stopped), `failed` (a genuine crash), one of four deliberate headless stops (`no_progress_fuse`, `no_sandbox_step_cap`, `max_steps`, `repeated_tool_failure`), `truncated` (the model hit the provider's output-token limit and stayed truncated after every automatic continuation was tried — the recorded assistant message is incomplete), `awaiting_tool_approval` (the run is paused waiting for this caller to approve or supply tool input — not a failure), `ended_unexpectedly` (the model stopped for an unusual provider-side reason: a content filter, a provider error, or an unclassified reason), `no_file_changes` (this session's start_session call declared `expectFileChanges: true` and the run produced no workspace change within the configured allowance), `step_ceiling` (the run reached the far outer, generous step-count backstop — never the primary bound, only fires when nothing more specific already stopped the run), or `diff_violation` (this session's start_session call declared `expectedFiles` and the run's final diff touched a path outside that list) — or null when the session has no run yet. A stalled run and a finished run are never the same value. One transient to expect: `activity` clears to `idle` at turn end a moment before the post-finish path writes `lastRunOutcome`, so a just-finished session can briefly report `idle` alongside a null `lastRunOutcome` — indistinguishable from a session that has never run. If a poll for `did it finish` sees `activity` as `idle` with a null `lastRunOutcome`, re-read shortly rather than treating the session as never-run. `lastAutoCommitEvent` and `lastAutoPrEvent` report the most recently recorded outcome of this session's auto-commit and auto-PR steps (or null if that step has never run) — `status: \"failed\"` on either means a run finished without its work actually being saved to the branch or a pull request, which `prNumber`/`prStatus` alone would not reveal. `baseBranch` reports the branch a new working `branch` was cut from (null when this session works directly on `branch`, or when no base was recorded) — the sandbox was cloned at it and, when this session auto-creates a PR, that PR targets it.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getSessionInputSchema,
    outputSchema: getSessionOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: getSession,
  }),
  defineTool({
    name: "open_agents_get_messages",
    title: "Get Open Agents Chat Messages",
    description:
      "Get the newest messages in an Open Agents session's chat (Open Agents' own chat transcript, not this MCP connection's conversation) — oldest-to-newest — with each message's full `text` and its true `chars` length. Provide `sessionId` and optional `chatId`; omit `chatId` to use the session's most recently active chat. Pass `messageCharLimit` for a cheap scan: `text` is then cut to that many characters and the message is flagged `capped`, while `chars` still reports the true length. Pass `includeToolTrace: true` to also get each tool call's `name`, `state`, and bounded `input`/`output` on assistant messages. The response can be large — if it would exceed the server's own character budget, affected messages are truthfully reported in `truncated` (text cut further) or `omitted` (dropped entirely) rather than silently shortened.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getMessagesInputSchema,
    outputSchema: getMessagesOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: getMessages,
  }),
  defineTool({
    name: "open_agents_get_diff_summary",
    title: "Get Open Agents Diff Summary",
    description:
      "Get the cached per-file diff summary for an Open Agents coding session (Open Agents' own git diff cache for that session, not the caller's local working tree) — no diff bodies included, only path, status, additions, and deletions per file.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getDiffSummaryInputSchema,
    outputSchema: getDiffSummaryOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: getDiffSummary,
  }),
  defineTool({
    name: "open_agents_get_updates",
    title: "Get Open Agents Session Updates",
    description:
      "Report which of the caller's Open Agents coding sessions (Open Agents' own session records, not the caller's MCP session) had a run finish since a given `since` timestamp — the 'what changed while I was away' read. Pass the ISO 8601 `since`; pass the previous response's `cursor` back as the next `since` to advance one safe, monotonic step. Pass `label` to narrow the answer to one fan-out batch. Each `changes` entry is a status read, never a transcript: the session's id, `title`, `label`, `lastRunOutcome` (reusing get_session's own vocabulary — `completed`, `aborted`, `failed`, the deliberate headless stops, etc.), `branch`, `baseBranch`, `prNumber`, `prStatus`, the latest auto-commit and auto-PR event status, the session URL, and when the run `finishedAt`. The answer is scoped to the caller — another user's runs never appear. `count` is the true number of sessions whose run finished in the window (independent of `limit`, so `count > changes.length` means the response was capped); `note` is non-null with a plain 'no sessions finished' message exactly when nothing changed, so an empty result is never ambiguous against a failed query. A still-running session reports nothing here: the query reads the workflow-runs table, which is written once at the true end of a run, so this reports completion, not activity.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getUpdatesInputSchema,
    outputSchema: getUpdatesOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: getUpdates,
  }),
];
