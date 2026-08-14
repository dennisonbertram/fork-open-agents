import { createHash } from "node:crypto";
import { stableStringify } from "./repetition-detector";

// Re-exported so existing importers keep one entry point. The detector
// itself lives in a crypto-free module because workflow functions
// (`"use workflow"`) cannot import Node.js modules — see
// repetition-detector.ts.
export {
  detectRepetition,
  stableStringify,
  type RepetitionConfig,
  type RepetitionVerdict,
} from "./repetition-detector";

/**
 * Action-repetition / cycle detection for background-agent runs (#915).
 *
 * A second, independent in-memory signal that ORs into the same stop path
 * as the no-progress (git-delta) budget (#914): a run can be making the git
 * working tree churn every turn (so the git-delta budget never trips) while
 * still being stuck issuing the SAME tool call, or cycling through a small
 * repeating loop of tool calls, turn after turn. This module is pure —
 * no sandbox, DB, or crypto side effects beyond hashing — so it is trivially
 * unit-testable and reusable from the executor loop.
 */

type MinimalToolCall = {
  toolName: string;
  input?: unknown;
};

/**
 * Hashes an entire turn's tool calls (in call order) into a single sha256
 * hex digest. Returns null for an empty turn (no tool calls to hash).
 *
 * Hashing the WHOLE turn — not each individual tool call — is what lets a
 * run that re-runs the same check command between distinct edits (e.g.
 * `bun test` after every edit) avoid being mistaken for a stuck loop: two
 * turns with different edit args produce different whole-turn signatures
 * even though they share an identical inner "bash bun test" call.
 *
 * The hash never leaks raw arg values — only the digest is returned, so
 * callers can safely log/store the signature without redaction.
 */
export function hashTurnToolCalls(
  toolCalls: ReadonlyArray<MinimalToolCall>,
): string | null {
  if (toolCalls.length === 0) {
    return null;
  }
  const canonical = toolCalls
    .map((call) => `${call.toolName}\x00${stableStringify(call.input)}`)
    .join("\x01");
  return createHash("sha256").update(canonical).digest("hex");
}
