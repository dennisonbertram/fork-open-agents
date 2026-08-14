import { isToolUIPart } from "ai";
import { stableStringify } from "@/lib/background-agents/repetition-detector";
import type { WebAgentUIMessage } from "@/app/types";
import { toolNameOf } from "./repeated-tool-failure";

/**
 * #1242: the headless no-progress fuse (#1231) keyed staleness purely on git
 * working-tree deltas, so a legitimate read-only run (analysis, review,
 * search, reporting) — which never changes the tree by definition — tripped
 * the fuse and was killed while working correctly (see the issue for the
 * production transcript).
 *
 * This module extracts a per-step "tool-call signature": the step's NEW tool
 * calls (name + canonicalized input, in call order), duplicating the concept
 * `lib/background-agents/action-repetition.ts` already proved out for
 * background agents (#915) — reused here rather than reinvented, per the
 * repo's own precedent. `chat.ts` folds this signature into the git
 * fingerprint it already probes each step (see the call site in
 * `app/workflows/chat.ts`), so a step only counts as "no progress" when BOTH
 * the git tree AND the tool-call activity are unchanged from the previous
 * step — i.e. the literal repeated-call wedge, not merely "no files were
 * touched".
 *
 * Deliberately NOT a signal: assistant text. A model stuck in a failed loop
 * routinely narrates different filler text on every retry ("let me try
 * again", "retrying now") — crediting that as progress would make the fuse
 * trivially defeatable by a wedged run and reopen the runaway-cost risk
 * #1231 exists to close (issue #1242's hard constraint). Tool-call identity
 * is the harder-to-spoof signal: a wedged run calling the identical tool
 * with the identical input is the actual observable symptom described in
 * the issue's wedge contract test.
 */
export type HeadlessActivityState = {
  seenToolCallIds: Set<string>;
};

/**
 * The placeholder `chat.ts` substitutes for `buildHeadlessStepToolSignature`
 * returning null when it builds the combined git+activity fingerprint (see
 * that call site). Exported so `headless-progress-detector.ts` can recognize
 * "this step had no tool-call activity at all" from the combined fingerprint
 * without re-deriving or duplicating the format.
 */
export const NO_TOOL_ACTIVITY_SIGNATURE = "∅";

export function createHeadlessActivityState(): HeadlessActivityState {
  return { seenToolCallIds: new Set() };
}

/**
 * Returns the signature of tool calls newly introduced in `parts` since the
 * last call for this `state` — parts accumulate across steps (see
 * `repeated-tool-failure.ts`'s module doc), so already-counted call ids are
 * skipped, mirroring `newlyFailedToolCalls` there. Returns null when the
 * step introduced no new tool call, deferring entirely to the git
 * fingerprint for that step.
 *
 * Call order is preserved (not sorted) so a step issuing several parallel
 * calls in a different order produces a different signature — matching
 * `hashTurnToolCalls`'s "whole turn" precedent in action-repetition.ts.
 */
export function buildHeadlessStepToolSignature(
  state: HeadlessActivityState,
  parts: WebAgentUIMessage["parts"],
): string | null {
  const signatures: string[] = [];

  for (const part of parts) {
    if (!isToolUIPart(part)) {
      continue;
    }
    const toolCallId = part.toolCallId;
    if (
      typeof toolCallId !== "string" ||
      state.seenToolCallIds.has(toolCallId)
    ) {
      continue;
    }
    state.seenToolCallIds.add(toolCallId);
    signatures.push(`${toolNameOf(part)}\x00${stableStringify(part.input)}`);
  }

  return signatures.length === 0 ? null : signatures.join("\x01");
}
