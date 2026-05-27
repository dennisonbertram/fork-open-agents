import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import {
  buildChatDebugBundle,
  renderChatDebugBundleMarkdown,
} from "@/lib/observability/chat-debug-bundle";
import {
  createDiagnosticBundleToken,
  verifyDiagnosticBundleToken,
} from "@/lib/observability/diagnostic-token";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

const DEFAULT_TOKEN_TTL_MINUTES = 60;
const MAX_TOKEN_TTL_MINUTES = 24 * 60;

function getBoundedLimit(value: string | null, fallback: number, max: number) {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), max)
    : fallback;
}

function wantsMarkdown(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "markdown") {
    return true;
  }
  return request.headers.get("accept")?.includes("text/markdown") ?? false;
}

async function readTokenTtlMinutes(request: Request): Promise<number> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return DEFAULT_TOKEN_TTL_MINUTES;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return DEFAULT_TOKEN_TTL_MINUTES;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return DEFAULT_TOKEN_TTL_MINUTES;
  }

  const rawTtl = (body as { ttlMinutes?: unknown }).ttlMinutes;
  if (typeof rawTtl !== "number" || !Number.isFinite(rawTtl)) {
    return DEFAULT_TOKEN_TTL_MINUTES;
  }

  return Math.min(Math.max(Math.floor(rawTtl), 1), MAX_TOKEN_TTL_MINUTES);
}

async function authorizeBundleRead(params: {
  request: Request;
  sessionId: string;
  chatId: string;
}) {
  const token = new URL(params.request.url).searchParams.get("token");
  if (token) {
    const valid = verifyDiagnosticBundleToken({
      token,
      sessionId: params.sessionId,
      chatId: params.chatId,
    });
    if (!valid) {
      return {
        ok: false as const,
        response: Response.json(
          { error: "Invalid or expired diagnostic token" },
          { status: 401 },
        ),
      };
    }

    const [sessionRecord, chat] = await Promise.all([
      getSessionById(params.sessionId),
      getChatById(params.chatId),
    ]);
    if (!sessionRecord || !chat || chat.sessionId !== params.sessionId) {
      return {
        ok: false as const,
        response: Response.json({ error: "Chat not found" }, { status: 404 }),
      };
    }

    return { ok: true as const, sessionRecord, chat };
  }

  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult;
  }

  return requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId: params.sessionId,
    chatId: params.chatId,
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { sessionId, chatId } = await context.params;
  const authResult = await authorizeBundleRead({ request, sessionId, chatId });
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const bundle = await buildChatDebugBundle({
    session: authResult.sessionRecord,
    chat: authResult.chat,
    eventLimit: getBoundedLimit(url.searchParams.get("eventLimit"), 200, 500),
  });

  if (wantsMarkdown(request)) {
    return new Response(renderChatDebugBundleMarkdown(bundle), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        vary: "Accept",
      },
    });
  }

  return Response.json(bundle);
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;
  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const ttlMinutes = await readTokenTtlMinutes(request);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const token = createDiagnosticBundleToken({
    sessionId,
    chatId,
    expiresAt,
  });
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("token", token);

  return Response.json({
    url: url.toString(),
    token,
    expiresAt: expiresAt.toISOString(),
    redaction: {
      status: "passed",
      notes: [
        "Signed diagnostic URLs are read-only and expire automatically.",
        "Diagnostic bundles omit raw service log tails and artifact contents.",
      ],
    },
  });
}
