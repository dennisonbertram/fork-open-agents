import {
  firstFieldError,
  type FlattenedZodDetails,
} from "@/lib/background-agents/validation-details";

export type CreateAgentResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

export type UpdateAgentResult = { ok: true } | { ok: false; error: string };

async function readValidationError(
  response: Response,
  fallback: string,
): Promise<string> {
  const errorBody = (await response.json().catch(() => ({}))) as {
    details?: FlattenedZodDetails;
  };
  return firstFieldError(errorBody.details) ?? fallback;
}

/**
 * POST a new background agent and return its id on success.
 *
 * Deliberately framework-free: it performs NO navigation. The /agents/new
 * builder calls this and, on success, only sets local `createdAgentId` state so
 * the page stays put and "Run a test" enables — the no-redirect-after-save
 * behavior the redesign requires. Injectable `fetchImpl` keeps it unit-testable.
 */
export async function submitNewAgent(
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateAgentResult> {
  const response = await fetchImpl("/api/background-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return {
      ok: false,
      error: await readValidationError(
        response,
        "Failed to create background agent",
      ),
    };
  }

  const body = (await response.json()) as { agent: { id: string } };
  return { ok: true, agentId: body.agent.id };
}

/**
 * PATCH a newly created agent when the user keeps editing on /agents/new.
 *
 * The builder intentionally stays on the same page after creation so "Run a
 * test" remains one click away. Once an id exists, Save must update that agent
 * instead of creating another copy.
 */
export async function updateCreatedAgent(
  agentId: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateAgentResult> {
  const response = await fetchImpl(`/api/background-agents/${agentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return {
      ok: false,
      error: await readValidationError(
        response,
        "Failed to update background agent",
      ),
    };
  }

  return { ok: true };
}
