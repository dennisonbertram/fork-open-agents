import { gateway } from "@open-agents/agent";
import { generateText, Output } from "ai";
import { z } from "zod";
import { checkBotProtection } from "@/lib/botid";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  backgroundAgentDraftOutputSchema,
  buildBackgroundAgentDraftPrompt,
  normalizeBackgroundAgentDraft,
} from "@/lib/background-agents/draft";

export const maxDuration = 60;

const DRAFT_MODEL = "anthropic/claude-haiku-4.5";

const draftRequestSchema = z.object({
  description: z.string().trim().min(8).max(2000),
  repoOwner: z.string().trim().min(1).max(120),
  repoName: z.string().trim().min(1).max(120),
});

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return jsonError("Access denied", 403);
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["background-agent-draft", session.user.id]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = draftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Describe the agent you want first.", 400);
  }

  try {
    const { output, usage } = await generateText({
      model: gateway(DRAFT_MODEL),
      output: Output.object({ schema: backgroundAgentDraftOutputSchema }),
      prompt: buildBackgroundAgentDraftPrompt(parsed.data),
    });

    if (!output) {
      return jsonError("Couldn't generate an agent spec. Try again.", 502);
    }

    console.info(
      "[background-agents] draft-generated",
      JSON.stringify({
        service: "background-agents",
        event: "draft-generated",
        userId: session.user.id,
        repoOwner: parsed.data.repoOwner,
        repoName: parsed.data.repoName,
        outputTokens: usage?.outputTokens ?? null,
      }),
    );

    return Response.json({
      draft: normalizeBackgroundAgentDraft(output),
    });
  } catch (error) {
    console.warn(
      "[background-agents] draft-failed",
      JSON.stringify({
        service: "background-agents",
        event: "draft-failed",
        userId: session.user.id,
        repoOwner: parsed.data.repoOwner,
        repoName: parsed.data.repoName,
        errorKind: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return jsonError("Couldn't generate an agent spec. Try again.", 502);
  }
}
