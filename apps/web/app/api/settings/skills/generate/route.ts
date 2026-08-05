import {
  type ApiErrorKind,
  apiErrorKindForStatus,
} from "@/lib/api/error-response";
import { gateway } from "@open-agents/agent";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { checkBotProtection } from "@/lib/botid";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  buildSkillGenerationPrompt,
  SKILL_GENERATION_REQUEST_MAX_LENGTH,
  skillDraftSchema,
} from "@/lib/skills/skill-generation";
import { slugifySkillName } from "@/lib/skills/skill-types";

// Drafting a full SKILL.md body can take ~30s; allow headroom above that so a
// slightly longer generation is not killed by the serverless timeout.
export const maxDuration = 60;

const generateSkillRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(SKILL_GENERATION_REQUEST_MAX_LENGTH),
});

function jsonError(error: string, status: number, kind?: ApiErrorKind) {
  return Response.json(
    { error, errorKind: kind ?? apiErrorKindForStatus(status) },
    { status },
  );
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return jsonError("Access denied", 403);
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["generate-skill", session.user.id]),
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

  const parsed = generateSkillRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Describe what the skill should do first.", 400);
  }

  try {
    const { output, usage } = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      output: Output.object({ schema: skillDraftSchema }),
      prompt: buildSkillGenerationPrompt(parsed.data.prompt),
    });

    if (!output) {
      return jsonError("Couldn't generate a draft. Try again.", 502);
    }

    const skill = {
      name: slugifySkillName(output.name),
      description: output.description.replace(/\s+/g, " ").trim(),
      body: output.body.trim(),
    };

    console.info(
      "[skills] skill-draft-generated",
      JSON.stringify({
        service: "skills",
        event: "skill-draft-generated",
        userId: session.user.id,
        outputTokens: usage?.outputTokens ?? null,
      }),
    );

    return Response.json({ skill });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.warn(
        "[skills] skill-draft-failed",
        JSON.stringify({
          service: "skills",
          event: "skill-draft-failed",
          userId: session.user.id,
          errorKind: "GenerationFailed",
        }),
      );
      return jsonError("Couldn't generate a draft. Try again.", 502);
    }
    console.error("[skills] skill-draft-failed (unexpected):", error);
    return jsonError("Couldn't generate a draft. Try again.", 500);
  }
}
