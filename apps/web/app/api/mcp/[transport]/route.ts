import { createMcpHandler } from "mcp-handler";
import { withMcpAuth } from "better-auth/plugins";
import packageJson from "../../../../package.json";
import { auth } from "@/lib/auth/config";
import { getAuthBaseURLFallback } from "@/lib/auth/base-url";
import {
  createToolContext,
  type McpErrorKind,
  type McpToolContext,
  toMcpErrorPayload,
} from "@/lib/mcp-server/context";
import { listMcpTools, runMcpTool } from "@/lib/mcp-server/registry";
import { toToolResult } from "@/lib/mcp-server/tool-result";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

const MCP_RATE_LIMIT = 60;
const MCP_RATE_LIMIT_WINDOW_MS = 60_000;

function buildServerInstructions(): string {
  const baseUrl = getAuthBaseURLFallback() ?? "http://localhost:3000";
  return `This server exposes Open Agents cloud coding sessions. A "session" is an agent working in a cloud sandbox on one repository, reachable in a browser at ${baseUrl}/sessions/{sessionId}. Sessions hibernate when idle and resume automatically on the next message.`;
}

const AUTH_ERROR_KINDS: readonly McpErrorKind[] = [
  "unauthorized",
  "forbidden_scope",
];

function logMcpEvent(
  level: "info" | "warn",
  event: string,
  fields: Record<string, unknown>,
) {
  const line = JSON.stringify({ service: "mcp-server", event, ...fields });
  if (level === "warn") {
    console.warn(`[mcp-server] ${event}`, line);
  } else {
    console.info(`[mcp-server] ${event}`, line);
  }
}

// withMcpAuth builds the 401 `WWW-Authenticate: Bearer resource_metadata=...`
// challenge from `auth.options.basePath` (default "/api/auth"), which would
// point clients at a nested `/api/auth/.well-known/oauth-protected-resource`
// path. We mount the actual RFC 9728 metadata document at the app ROOT
// (`apps/web/app/.well-known/oauth-protected-resource/route.ts`), so the
// challenge must be built against the root too — override `basePath` to "/"
// for this computation only; `api` (session lookup) is untouched.
const mcpChallengeAuth = {
  ...auth,
  options: { ...auth.options, basePath: "/" },
};

// better-auth's `getMcpSession` resolves the bearer token with a bare
// `findOne` lookup and never compares `accessTokenExpiresAt` to now —
// `withMcpAuth` only checks that a row exists. Without this check, a token
// issued with the plugin's 3600s lifetime keeps working forever: the
// 1-hour lifetime advertised to the client is fiction, and a leaked token
// from an MCP client's config file becomes a permanent credential.
function buildAuthChallenge(request: Request): string {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

// Mirrors the 401 shape better-auth's `withMcpAuth` returns for a missing
// token, so an expired token is indistinguishable from no token at all.
function unauthorizedResponse(request: Request): Response {
  const wwwAuthenticateValue = buildAuthChallenge(request);
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32_000,
        message: "Unauthorized: Authentication required",
        "www-authenticate": wwwAuthenticateValue,
      },
      id: null,
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": wwwAuthenticateValue,
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

const mcpAuthHandler = withMcpAuth(mcpChallengeAuth, async (req, session) => {
  const expiresAt = session.accessTokenExpiresAt
    ? new Date(session.accessTokenExpiresAt).getTime()
    : Number.NaN;
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    logMcpEvent("warn", "mcp.auth.rejected", {
      userId: session.userId,
      errorKind: "unauthorized",
      reason: "token_expired",
    });
    return unauthorizedResponse(req);
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["mcp", session.userId]),
    limit: MCP_RATE_LIMIT,
    windowMs: MCP_RATE_LIMIT_WINDOW_MS,
  });
  if (limited) {
    return limited;
  }

  const ctx: McpToolContext = createToolContext({
    userId: session.userId,
    scopes: session.scopes,
  });

  const mcpHandler = createMcpHandler(
    async (server) => {
      for (const def of listMcpTools(ctx.scopes)) {
        server.registerTool(
          def.name,
          {
            title: def.title,
            description: def.description,
            inputSchema: def.inputSchema,
            outputSchema: def.outputSchema,
            annotations: def.annotations,
          },
          async (rawInput: unknown) => {
            const startedAt = Date.now();
            try {
              const result = await runMcpTool(def.name, ctx, rawInput);
              const wireResult = toToolResult(def.outputSchema, result);
              if (wireResult.isError) {
                logMcpEvent("warn", "mcp.tool.output_schema_mismatch", {
                  userId: ctx.userId,
                  toolName: def.name,
                  requestId: ctx.requestId,
                });
              }
              logMcpEvent("info", "mcp.tool.invoked", {
                userId: ctx.userId,
                toolName: def.name,
                requestId: ctx.requestId,
                latencyMs: Date.now() - startedAt,
                outcome: wireResult.isError ? "error" : "success",
              });
              return wireResult;
            } catch (error) {
              const payload = toMcpErrorPayload(error);
              logMcpEvent("info", "mcp.tool.invoked", {
                userId: ctx.userId,
                toolName: def.name,
                requestId: ctx.requestId,
                latencyMs: Date.now() - startedAt,
                outcome: "error",
              });
              if (AUTH_ERROR_KINDS.includes(payload.errorKind)) {
                logMcpEvent("warn", "mcp.auth.rejected", {
                  toolName: def.name,
                  requestId: ctx.requestId,
                  errorKind: payload.errorKind,
                });
              } else {
                logMcpEvent("warn", "mcp.tool.failed", {
                  userId: ctx.userId,
                  toolName: def.name,
                  requestId: ctx.requestId,
                  errorKind: payload.errorKind,
                });
              }
              return {
                isError: true as const,
                content: [
                  { type: "text" as const, text: JSON.stringify(payload) },
                ],
              };
            }
          },
        );
      }
    },
    {
      serverInfo: { name: "open-agents", version: packageJson.version },
      instructions: buildServerInstructions(),
    },
  );

  return mcpHandler(req);
});

export const GET = mcpAuthHandler;
export const POST = mcpAuthHandler;
export const DELETE = mcpAuthHandler;
