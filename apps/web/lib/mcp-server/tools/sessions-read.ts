import { z } from "zod";
import {
  getChatById,
  getChatMessages,
  getChatSummariesBySessionId,
  getChatsBySessionId,
  getSessionById,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { buildChatUrl, buildSessionUrl, McpToolError } from "../context";
import type { McpScope } from "../context";
// Type-only: registry.ts imports the VALUE `sessionReadTools` from this
// module, so a runtime import back (e.g. `defineMcpTool`) would create an
// ESM circular value dependency that throws a TDZ ReferenceError whenever
// this module is the load entry (as in this file's own test). `defineMcpTool`
// is a pure identity function, so a local equivalent is behaviorally
// identical without reintroducing the cycle.
import type { AnyMcpToolDefinition, McpToolDefinition } from "../registry";

function defineTool<TSchema extends z.ZodTypeAny, TOutput>(
  definition: McpToolDefinition<TSchema, TOutput>,
): McpToolDefinition<TSchema, TOutput> {
  return definition;
}

export const DEFAULT_SESSION_LIMIT = 20;
export const MAX_SESSION_LIMIT = 50;
export const DEFAULT_MESSAGE_LIMIT = 20;
export const MAX_MESSAGE_LIMIT = 50;
export const MESSAGE_PREVIEW_CHARS = 280;
export const MAX_DIFF_FILES = 100;

const SESSION_READ_SCOPE: McpScope = "sessions:read";

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
  status: "running" | "completed" | "failed" | "archived";
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

export type McpSessionDetail = {
  id: string;
  title: string;
  status: "running" | "completed" | "failed" | "archived";
  repo: string | null;
  branch: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  linesAdded: number;
  linesRemoved: number;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  runtimeMode: "classic" | "managed_runtime";
  lifecycleState: string | null;
  sandboxActive: boolean;
  hasUnread: boolean;
  isStreaming: boolean;
  chats: McpChatSummary[];
};

export type McpMessageSummary = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  preview: string;
  hasToolCalls: boolean;
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

const listSessionsInputSchema = z.object({
  status: z.enum(["all", "active", "archived"]).default("active"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SESSION_LIMIT)
    .default(DEFAULT_SESSION_LIMIT),
  offset: z.number().int().min(0).default(0),
});

export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>;

export type ListSessionsResult = {
  sessions: McpSessionSummary[];
  count: number;
  limit: number;
  offset: number;
};

const getSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export type GetSessionInput = z.infer<typeof getSessionInputSchema>;

const getMessagesInputSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_MESSAGE_LIMIT)
    .default(DEFAULT_MESSAGE_LIMIT),
});

export type GetMessagesInput = z.infer<typeof getMessagesInputSchema>;

export type GetMessagesResult = {
  sessionId: string;
  chatId: string;
  url: string;
  total: number;
  returned: number;
  messages: McpMessageSummary[];
};

const getDiffSummaryInputSchema = z.object({
  sessionId: z.string().min(1),
});

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
type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type SessionWithUnreadRow = Awaited<
  ReturnType<typeof getSessionsWithUnreadByUserId>
>[number];
type ChatSummaryRow = Awaited<
  ReturnType<typeof getChatSummariesBySessionId>
>[number];
type ChatMessageRow = Awaited<ReturnType<typeof getChatMessages>>[number];

function toRepo(
  repoOwner: string | null,
  repoName: string | null,
): string | null {
  return repoOwner && repoName ? `${repoOwner}/${repoName}` : null;
}

/**
 * Coerce a timestamp that crosses the tool boundary into ISO 8601.
 *
 * Not every value typed `Date` in a db helper's return type is one at runtime.
 * `getSessionsWithUnreadByUserId` declares `lastActivityAt: Date` but computes
 * it as a raw `sql<Date>` expression, and postgres-js hands those back as
 * strings — calling `.toISOString()` directly turned every real list_sessions
 * call into internal_error while mocked tests stayed green. Coerce defensively
 * at every timestamp instead of trusting the declared type.
 */
function toIsoString(
  value: Date | string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  // The columns behind these values are `timestamp`, not `timestamptz`, so a
  // raw driver string carries no offset ("2026-01-01 00:05:00") and `new Date`
  // would resolve it in the server's local zone — shifting it by the UTC
  // offset. Drizzle's own PgTimestamp mapper appends "+0000" for
  // non-timezone columns; do the same so both paths agree on the instant.
  const normalized =
    // Postgres writes the offset as "+00", "+0000", or "+00:00" depending on
    // the driver, so all three must count as already-zoned.
    typeof value === "string" && !/(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSessionSummary(row: SessionWithUnreadRow): McpSessionSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
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

async function requireOwnedSession(
  ctx: { userId: string },
  sessionId: string,
): Promise<SessionRecord> {
  const record = await getSessionById(sessionId);
  if (!record || record.userId !== ctx.userId) {
    throw new McpToolError("not_found", `Session ${sessionId} was not found.`);
  }
  return record;
}

// A message's `parts` jsonb column holds either the parts array directly, or
// the whole persisted UIMessage object with an array at `.parts`.
type RawMessagePart = { type?: unknown; text?: unknown };

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

function buildMessagePreview(parts: RawMessagePart[]): string {
  const text = parts
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

  if (text.length <= MESSAGE_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MESSAGE_PREVIEW_CHARS - 1)}…`;
}

function hasToolCallParts(parts: RawMessagePart[]): boolean {
  return parts.some(
    (part) => typeof part?.type === "string" && part.type.startsWith("tool-"),
  );
}

function toMessageSummary(row: ChatMessageRow): McpMessageSummary {
  const parts = extractMessageParts(row.parts);
  return {
    id: row.id,
    role: row.role,
    createdAt: toIsoString(row.createdAt) ?? "",
    preview: buildMessagePreview(parts),
    hasToolCalls: hasToolCallParts(parts),
  };
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

export async function listSessions(
  ctx: ToolCallerContext,
  input: ListSessionsInput,
): Promise<ListSessionsResult> {
  const rows = await getSessionsWithUnreadByUserId(ctx.userId, {
    status: input.status,
    limit: input.limit,
    offset: input.offset,
  });

  const sessions = rows.map(toSessionSummary);

  return {
    sessions,
    count: sessions.length,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function getSession(
  ctx: ToolCallerContext,
  input: GetSessionInput,
): Promise<McpSessionDetail> {
  const record = await requireOwnedSession(ctx, input.sessionId);
  const chatRows = await getChatSummariesBySessionId(record.id, ctx.userId);
  const chats = chatRows.map((chat) => toChatSummary(record.id, chat));

  return {
    id: record.id,
    title: record.title,
    status: record.status,
    repo: toRepo(record.repoOwner, record.repoName),
    branch: record.branch,
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
    lifecycleState: record.lifecycleState,
    sandboxActive: isSandboxActive(record.sandboxState),
    hasUnread: chats.some((chat) => chat.hasUnread),
    isStreaming: chats.some((chat) => chat.isStreaming),
    chats,
  };
}

export async function getMessages(
  ctx: ToolCallerContext,
  input: GetMessagesInput,
): Promise<GetMessagesResult> {
  const record = await requireOwnedSession(ctx, input.sessionId);

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

  const rows = await getChatMessages(chatId);
  const total = rows.length;
  const windowRows = rows.slice(-input.limit);
  const messages = windowRows.map(toMessageSummary);

  return {
    sessionId: record.id,
    chatId,
    url: buildChatUrl(record.id, chatId),
    total,
    returned: messages.length,
    messages,
  };
}

export async function getDiffSummary(
  ctx: ToolCallerContext,
  input: GetDiffSummaryInput,
): Promise<GetDiffSummaryResult> {
  const record = await requireOwnedSession(ctx, input.sessionId);
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

export const sessionReadTools: readonly AnyMcpToolDefinition[] = [
  defineTool({
    name: "whoami",
    description:
      "Return the authenticated MCP identity (user id, granted scopes, request id) with no I/O.",
    scope: SESSION_READ_SCOPE,
    inputSchema: z.object({}),
    handler: whoami,
  }),
  defineTool({
    name: "list_sessions",
    description:
      "List the caller's agent sessions with lightweight status, repo, and PR summary fields.",
    scope: SESSION_READ_SCOPE,
    inputSchema: listSessionsInputSchema,
    handler: listSessions,
  }),
  defineTool({
    name: "get_session",
    description:
      "Get full detail for one owned session, including its chats, without transcripts or diff bodies.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getSessionInputSchema,
    handler: getSession,
  }),
  defineTool({
    name: "get_messages",
    description:
      "Get the newest messages in a chat (oldest-to-newest), each capped to a short text preview.",
    scope: SESSION_READ_SCOPE,
    inputSchema: getMessagesInputSchema,
    handler: getMessages,
  }),
  defineTool({
    name: "get_diff_summary",
    description:
      "Get the cached per-file diff summary for a session (no diff bodies).",
    scope: SESSION_READ_SCOPE,
    inputSchema: getDiffSummaryInputSchema,
    handler: getDiffSummary,
  }),
];
