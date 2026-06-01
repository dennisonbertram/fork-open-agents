import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedWorkflowRunByRunId,
} from "@/app/api/chat/_lib/chat-context";
import {
  applyRunControlCommand,
  type RunControlErrorKind,
} from "@/lib/workflows/run-control";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const controlBodySchema = z.object({
  command: z.enum(["pause", "resume", "cancel"]),
  idempotencyKey: z.string().min(1),
});

function errorStatusCode(errorKind: RunControlErrorKind): number {
  switch (errorKind) {
    case "run_control_unauthorized":
      return 403;
    case "run_control_not_found":
      return 404;
    case "run_control_illegal_transition":
      return 409;
    case "run_control_conflict":
      return 409;
    case "run_control_persist_failed":
      return 500;
  }
}

export async function POST(request: Request, context: RouteContext) {
  // Step 1: Authenticate
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { runId } = await context.params;

  // Step 2: Verify ownership
  const ownershipResult = await requireOwnedWorkflowRunByRunId({
    userId: authResult.userId,
    runId,
  });
  if (!ownershipResult.ok) {
    return ownershipResult.response;
  }

  // Step 3: Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = controlBodySchema.safeParse(body);
  if (!parseResult.success) {
    return Response.json(
      { error: "Invalid request body", details: parseResult.error.issues },
      { status: 400 },
    );
  }

  const { command, idempotencyKey } = parseResult.data;

  // Step 4: Apply the command
  const result = await applyRunControlCommand({
    runId,
    userId: authResult.userId,
    command,
    idempotencyKey,
  });

  // Step 5: Map result to HTTP response
  if (result.ok) {
    return Response.json({ state: result.state }, { status: 200 });
  }

  return Response.json(
    { error: result.error },
    { status: errorStatusCode(result.error) },
  );
}
