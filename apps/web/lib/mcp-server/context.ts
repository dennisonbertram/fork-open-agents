import { getAuthBaseURLFallback } from "@/lib/auth/base-url";

export const MCP_SCOPES = [
  "sessions:read",
  "sessions:write",
  "agents:read",
  "agents:write",
  "sandbox:exec",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_ERROR_KINDS = [
  "unauthorized",
  "forbidden_scope",
  "not_found",
  "invalid_request",
  "rate_limited",
  "conflict",
  "internal_error",
] as const;

export type McpErrorKind = (typeof MCP_ERROR_KINDS)[number];

export type McpToolContext = {
  userId: string;
  scopes: McpScope[];
  requestId: string;
};

export class McpToolError extends Error {
  readonly errorKind: McpErrorKind;
  readonly details?: Record<string, unknown>;

  constructor(
    errorKind: McpErrorKind,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpToolError";
    this.errorKind = errorKind;
    this.details = details;
  }
}

const KNOWN_SCOPES = new Set<string>(MCP_SCOPES);

export function normalizeScopes(
  raw: string | string[] | null | undefined,
): McpScope[] {
  if (!raw) {
    return [];
  }

  const tokens = Array.isArray(raw) ? raw : raw.split(/[\s,]+/);

  const result: McpScope[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed || !KNOWN_SCOPES.has(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed as McpScope);
  }

  return result;
}

export function requireScope(ctx: McpToolContext, scope: McpScope): void {
  if (ctx.scopes.includes(scope)) {
    return;
  }

  throw new McpToolError(
    "forbidden_scope",
    `This token is missing the "${scope}" scope.`,
    { requiredScope: scope, grantedScopes: ctx.scopes },
  );
}

export function createToolContext(input: {
  userId: string | null | undefined;
  scopes: string | string[] | null | undefined;
  requestId?: string;
}): McpToolContext {
  const userId = input.userId?.trim();

  if (!userId) {
    throw new McpToolError(
      "unauthorized",
      "This request has no authenticated MCP session.",
    );
  }

  return {
    userId,
    scopes: normalizeScopes(input.scopes),
    requestId: input.requestId ?? crypto.randomUUID(),
  };
}

export function toMcpErrorPayload(error: unknown): {
  errorKind: McpErrorKind;
  message: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof McpToolError) {
    return {
      errorKind: error.errorKind,
      message: error.message,
      details: error.details,
    };
  }

  return {
    errorKind: "internal_error",
    message: "The MCP tool failed unexpectedly.",
  };
}

export function buildSessionUrl(sessionId: string): string {
  const base = (getAuthBaseURLFallback() ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `${base}/sessions/${encodeURIComponent(sessionId)}`;
}

export function buildChatUrl(sessionId: string, chatId: string): string {
  return `${buildSessionUrl(sessionId)}/chats/${encodeURIComponent(chatId)}`;
}
