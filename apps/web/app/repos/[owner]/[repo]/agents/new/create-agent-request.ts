import {
  firstFieldError,
  type FlattenedZodDetails,
} from "@/lib/background-agents/validation-details";

export type CreateAgentResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

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
    const errorBody = (await response.json().catch(() => ({}))) as {
      details?: FlattenedZodDetails;
    };
    return {
      ok: false,
      error:
        firstFieldError(errorBody.details) ??
        "Failed to create background agent",
    };
  }

  const body = (await response.json()) as { agent: { id: string } };
  return { ok: true, agentId: body.agent.id };
}
