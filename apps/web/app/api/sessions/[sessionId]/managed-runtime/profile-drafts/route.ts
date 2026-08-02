import { setupManagedRuntimeProfileInputSchema } from "@open-agents/agent";
import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import {
  listManagedRuntimeProfileDrafts,
  toManagedRuntimeProfileDraftSnapshot,
  upsertManagedRuntimeProfileDraftForToolCall,
} from "@/lib/db/managed-runtime-profile-drafts";

const createDraftRequestSchema = z.object({
  chatId: z.string().min(1).optional(),
  toolCallId: z.string().min(1),
  input: setupManagedRuntimeProfileInputSchema,
});

function parseLimit(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }

  return Number(value);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId } = await params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("chatId");
  const limit = parseLimit(searchParams.get("limit"));

  const drafts = await listManagedRuntimeProfileDrafts({
    userId: auth.userId,
    sessionId,
    chatId,
    limit,
  });

  return Response.json({
    drafts: drafts.map(toManagedRuntimeProfileDraftSnapshot),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsedBody = createDraftRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "Invalid managed runtime profile draft",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const ownedResult = parsedBody.data.chatId
    ? await requireOwnedSessionChat({
        userId: auth.userId,
        sessionId,
        chatId: parsedBody.data.chatId,
      })
    : await requireOwnedSession({
        userId: auth.userId,
        sessionId,
      });
  if (!ownedResult.ok) {
    return ownedResult.response;
  }

  const draft = await upsertManagedRuntimeProfileDraftForToolCall({
    userId: auth.userId,
    sessionId,
    chatId: parsedBody.data.chatId ?? null,
    toolCallId: parsedBody.data.toolCallId,
    input: parsedBody.data.input,
  });

  return Response.json({
    draft: toManagedRuntimeProfileDraftSnapshot(draft),
  });
}
