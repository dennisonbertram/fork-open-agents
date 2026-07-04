/**
 * Agent Loops — definition-embedded guardrails extractor (#879)
 *
 * Guardrails embedded in a stored loop definition (`definition.guardrails`)
 * are persisted by clients PATCHing `{ definition: { ..., guardrails } }`.
 * That path never boundary-validates the embedded object (validateLoopDefinition's
 * loopDefinitionSchema is a non-strict object({nodes, edges}), so an
 * embedded `guardrails` key rides along unvalidated as raw JSONB).
 *
 * This module is the read-side seam: it safely extracts and validates any
 * guardrails embedded in a run's definitionSnapshot so chain.ts can honor
 * them. The `agent_loops.guardrails` column remains the canonical,
 * boundary-validated store and takes per-field precedence at the call site
 * in chain.ts — this extractor never throws, so a malformed embedded blob
 * falls back to null (and ultimately to the column/defaults) instead of
 * failing the run.
 */

import { type LoopGuardrails, loopGuardrailsSchema } from "./types";

export function extractDefinitionGuardrails(
  definitionSnapshot: unknown,
): Partial<LoopGuardrails> | null {
  if (
    typeof definitionSnapshot !== "object" ||
    definitionSnapshot === null ||
    Array.isArray(definitionSnapshot)
  ) {
    return null;
  }

  const raw = (definitionSnapshot as Record<string, unknown>).guardrails;
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const parsed = loopGuardrailsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
