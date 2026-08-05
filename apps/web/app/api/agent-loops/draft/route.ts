/**
 * POST /api/agent-loops/draft
 *
 * Natural-language → loop definition. Takes { description }, asks an LLM for a
 * positionless graph, lays it out, validates it, and returns a ready-to-edit
 * { name, description, definition }. The caller drops the result into the create
 * form / builder; the user reviews and edits before anything is persisted.
 */

import { generateText } from "ai";
import { gateway } from "@open-agents/agent";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import {
  buildDraftUserPrompt,
  draftLoopSchema,
  DRAFT_SYSTEM_PROMPT,
  extractJsonObject,
  layoutDraftDefinition,
} from "@/lib/agent-loops/draft";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";

const DRAFT_MODEL = "anthropic/claude-opus-4.6";
const DRAFT_TIMEOUT_MS = 45_000;

const requestSchema = z.object({
  description: z.string().min(8).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isAgentLoopsEnabled()) {
    return Response.json(
      {
        errorKind: "feature_disabled",
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        errorKind: "invalid_request",
        error: "Provide a `description` of the loop (8–2000 characters).",
        message: "Provide a `description` of the loop (8–2000 characters).",
      },
      { status: 400 },
    );
  }

  let modelText: string;
  try {
    const result = await generateText({
      model: gateway(DRAFT_MODEL),
      messages: [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildDraftUserPrompt(parsed.data.description),
        },
      ],
      abortSignal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
    });
    modelText = result.text ?? "";
  } catch {
    return Response.json(
      {
        errorKind: "draft_failed",
        error:
          "Couldn't reach the model to draft your loop. Try again, or start from a template.",
        message:
          "Couldn't reach the model to draft your loop. Try again, or start from a template.",
      },
      { status: 502 },
    );
  }

  const json = extractJsonObject(modelText);
  if (!json) {
    return Response.json(
      {
        errorKind: "draft_unparseable",
        error:
          "The model didn't return a usable loop. Try rephrasing, or start from a template.",
        message:
          "The model didn't return a usable loop. Try rephrasing, or start from a template.",
      },
      { status: 422 },
    );
  }

  let draftParsed: unknown;
  try {
    draftParsed = JSON.parse(json);
  } catch {
    return Response.json(
      {
        errorKind: "draft_unparseable",
        error:
          "The model didn't return valid JSON. Try rephrasing, or start from a template.",
        message:
          "The model didn't return valid JSON. Try rephrasing, or start from a template.",
      },
      { status: 422 },
    );
  }

  const draft = draftLoopSchema.safeParse(draftParsed);
  if (!draft.success) {
    return Response.json(
      {
        errorKind: "draft_invalid",
        error:
          "The drafted loop didn't fit the expected shape. Try rephrasing, or start from a template.",
        message:
          "The drafted loop didn't fit the expected shape. Try rephrasing, or start from a template.",
      },
      { status: 422 },
    );
  }

  const definition = layoutDraftDefinition(draft.data);
  const validated = validateLoopDefinition(definition);
  if (!validated.ok) {
    return Response.json(
      {
        errorKind: "draft_invalid",
        error:
          "The drafted loop wasn't a valid graph. Try rephrasing, or start from a template.",
        message:
          "The drafted loop wasn't a valid graph. Try rephrasing, or start from a template.",
        errors: validated.errors,
      },
      { status: 422 },
    );
  }

  return Response.json(
    {
      name: draft.data.name,
      description: draft.data.description ?? "",
      definition: validated.definition,
    },
    { status: 200 },
  );
}
