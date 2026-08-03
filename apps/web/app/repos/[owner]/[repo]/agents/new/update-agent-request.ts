import { readApiError } from "@/lib/api/read-api-error";
import {
  firstFieldError,
  type FlattenedZodDetails,
} from "@/lib/background-agents/validation-details";

export type UpdateAgentResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

/**
 * PATCH an existing background agent and return its id on success.
 *
 * Deliberately framework-free: it performs NO navigation. The /agents/new
 * builder calls this for every save after the first (once `createdAgentId`
 * is set), instead of re-POSTing and creating a duplicate row. Injectable
 * `fetchImpl` keeps it unit-testable.
 */
export async function submitAgentUpdate(
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
    const errorBody = (await response.json().catch(() => null)) as {
      details?: FlattenedZodDetails;
    } | null;
    return {
      ok: false,
      error:
        firstFieldError(errorBody?.details) ??
        readApiError(errorBody, "Failed to update background agent").message,
    };
  }

  const body = (await response.json()) as { agent: { id: string } };
  return { ok: true, agentId: body.agent.id };
}
