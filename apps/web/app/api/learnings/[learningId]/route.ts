import "server-only";

import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { redactHarnessPayload } from "@/lib/harness/redaction";
import {
  getRepoLearningWithEvidence,
  updateOwnedRepoLearning,
} from "@/lib/learnings/store";
import {
  learningConfidenceSchema,
  type LearningConfidence,
} from "@/lib/learnings/types";

type RouteContext = {
  params: Promise<{ learningId: string }>;
};

type LearningErrorKind =
  | "unauthenticated"
  | "not_owner"
  | "learning_not_found"
  | "validation_failed"
  | "invalid_status_transition"
  | "internal_error";

const patchLearningSchema = z
  .object({
    status: z.literal("archived").optional(),
    confidence: learningConfidenceSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.status !== undefined || value.confidence !== undefined,
  );

function errorResponse(
  errorKind: LearningErrorKind,
  status: number,
  message: string,
) {
  return Response.json({ error: message, errorKind }, { status });
}

function serializeLearning(
  learning: Awaited<ReturnType<typeof getRepoLearningWithEvidence>>,
) {
  if (!learning) {
    return null;
  }

  return {
    ...learning,
    createdAt: learning.createdAt.toISOString(),
    updatedAt: learning.updatedAt.toISOString(),
    lastUsedAt: learning.lastUsedAt?.toISOString() ?? null,
    evidence: learning.evidence.map((evidence) => ({
      ...evidence,
      createdAt: evidence.createdAt.toISOString(),
    })),
  };
}

function emitLearningsUiEvent(params: {
  action: string;
  level?: "info" | "warn";
  payload: Record<string, unknown>;
}) {
  const payload = redactHarnessPayload(params.payload);
  const line = {
    service: "learnings_ui",
    action: params.action,
    ...payload,
  };

  if (params.level === "warn") {
    console.warn("[learnings_ui]", line);
    return;
  }
  console.info("[learnings_ui]", line);
}

async function requireOwnedLearning(learningId: string, userId: string) {
  const learning = await getRepoLearningWithEvidence(learningId);
  if (!learning) {
    return {
      ok: false as const,
      response: errorResponse("learning_not_found", 404, "Learning not found"),
      errorKind: "learning_not_found" as const,
    };
  }
  if (learning.userId !== userId) {
    return {
      ok: false as const,
      response: errorResponse("not_owner", 403, "Learning not found"),
      errorKind: "not_owner" as const,
    };
  }

  return { ok: true as const, learning };
}

export async function GET(
  _req: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { learningId } = await context.params;
  const owned = await requireOwnedLearning(learningId, auth.userId);
  if (!owned.ok) {
    return owned.response;
  }

  return Response.json({ learning: serializeLearning(owned.learning) });
}

export async function PATCH(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { learningId } = await context.params;
  const owned = await requireOwnedLearning(learningId, auth.userId);
  if (!owned.ok) {
    emitLearningsUiEvent({
      action: "mutation_failed",
      level: "warn",
      payload: {
        userId: auth.userId,
        learningId,
        errorKind: owned.errorKind,
        httpStatus: owned.response.status,
      },
    });
    return owned.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("validation_failed", 400, "Invalid JSON body");
  }

  const parsed = patchLearningSchema.safeParse(rawBody);
  if (!parsed.success) {
    emitLearningsUiEvent({
      action: "mutation_failed",
      level: "warn",
      payload: {
        userId: auth.userId,
        learningId,
        errorKind: "validation_failed",
        httpStatus: 400,
      },
    });
    return errorResponse(
      "validation_failed",
      400,
      "Only status and confidence can be updated",
    );
  }

  const updates = parsed.data;
  const updated = await updateOwnedRepoLearning({
    userId: auth.userId,
    learningId,
    updates,
  });
  if (!updated) {
    emitLearningsUiEvent({
      action: "mutation_failed",
      level: "warn",
      payload: {
        userId: auth.userId,
        learningId,
        errorKind: "not_owner",
        httpStatus: 403,
      },
    });
    return errorResponse("not_owner", 403, "Learning not found");
  }

  if (updates.status === "archived") {
    emitLearningsUiEvent({
      action: "learning_archived",
      payload: {
        userId: auth.userId,
        learningId,
        repoOwner: owned.learning.repoOwner,
        repoName: owned.learning.repoName,
        previousStatus: owned.learning.status,
        newStatus: updated.status,
      },
    });
  }
  if (updates.confidence) {
    emitLearningsUiEvent({
      action: "confidence_overridden",
      payload: {
        userId: auth.userId,
        learningId,
        previousConfidence: owned.learning.confidence,
        newConfidence: updated.confidence,
      },
    });
  }

  const refreshed = await getRepoLearningWithEvidence(learningId);
  return Response.json({ learning: serializeLearning(refreshed) });
}

export async function DELETE(
  _req: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { learningId } = await context.params;
  const owned = await requireOwnedLearning(learningId, auth.userId);
  if (!owned.ok) {
    return owned.response;
  }

  const updated = await updateOwnedRepoLearning({
    userId: auth.userId,
    learningId,
    updates: { status: "archived" },
  });
  if (!updated) {
    return errorResponse("not_owner", 403, "Learning not found");
  }

  emitLearningsUiEvent({
    action: "learning_archived",
    payload: {
      userId: auth.userId,
      learningId,
      repoOwner: owned.learning.repoOwner,
      repoName: owned.learning.repoName,
      previousStatus: owned.learning.status,
      newStatus: "archived",
    },
  });

  const confidence: LearningConfidence = updated.confidence;
  return Response.json({
    learning: {
      id: updated.id,
      status: updated.status,
      confidence,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
