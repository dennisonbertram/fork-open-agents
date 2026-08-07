import { createHash } from "node:crypto";

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
 * Recursively produces a canonical JSON-ish string for `value`: object keys
 * are sorted so key-reordered-but-equivalent args hash identically; arrays
 * keep their order (order is meaningful there); primitives fall back to
 * JSON.stringify.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
  );
  return `{${entries.join(",")}}`;
}

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

type MinimalToolFailure = {
  toolName: string;
  errorText?: string | undefined;
};

/**
 * Hashes an entire turn's *failed* tool calls into a single sha256 hex digest,
 * keyed on tool name + error text. Returns null for a turn with no failures,
 * which callers use as the reset signal — a turn that succeeded clears the
 * trailing run rather than extending it.
 *
 * The sibling of `hashTurnToolCalls`, and fed to the same `detectRepetition`
 * (#1143). The two answer different questions: `hashTurnToolCalls` catches a
 * run that keeps *doing* the same thing, this catches one that keeps *failing*
 * the same way. A background agent editing files in a loop needs the first; a
 * chat turn whose only execution path is dead needs the second, because the
 * inputs vary (different task instructions each retry) while the failure does
 * not.
 *
 * Identity is name + error, never name alone: a tool legitimately failing three
 * different ways is a working tool being used badly, not a dead one.
 *
 * Like its sibling, only the digest is returned, so callers can log or store
 * the signature without redacting a provider message that may quote the
 * request back.
 */
export function hashTurnToolFailures(
  toolFailures: ReadonlyArray<MinimalToolFailure>,
): string | null {
  const failures = toolFailures.filter(
    (failure) => typeof failure.errorText === "string",
  );
  if (failures.length === 0) {
    return null;
  }
  const canonical = failures
    .map((failure) => `${failure.toolName}\x00${failure.errorText}`)
    .join("\x01");
  return createHash("sha256").update(canonical).digest("hex");
}

export type RepetitionVerdict = {
  flagged: boolean;
  reason: "repeat" | "cycle" | null;
  /** Length of the trailing run of identical signatures. */
  repeatCount: number;
  /** Period of the detected cycle, or null when no cycle was found. */
  cycleLength: number | null;
};

export type RepetitionConfig = {
  /** Consecutive identical whole-turn signatures required to flag "repeat". */
  repeatThreshold: number;
  /** Number of times a period-p block must repeat to flag "cycle". Default 2. */
  cycleRepeats?: number;
  /** Largest cycle period to search for (inclusive). Default 3. */
  maxCyclePeriod?: number;
};

const DEFAULT_CYCLE_REPEATS = 2;
const DEFAULT_MAX_CYCLE_PERIOD = 3;

function countTrailingRepeat(signatures: readonly string[]): number {
  if (signatures.length === 0) {
    return 0;
  }
  const last = signatures.at(-1);
  let count = 0;
  for (let i = signatures.length - 1; i >= 0; i -= 1) {
    if (signatures[i] !== last) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * Detects whether the tail of `recentSignatures` (whole-turn tool-call
 * hashes, oldest first) looks like a stuck run: either the SAME signature
 * repeating `repeatThreshold+` times in a row ("repeat"), or a short block
 * of period `p` (2..maxCyclePeriod) repeating `cycleRepeats+` times
 * ("cycle") — e.g. A,B,A,B. The shortest matching period wins.
 */
export function detectRepetition(
  recentSignatures: readonly string[],
  config: RepetitionConfig,
): RepetitionVerdict {
  const repeatCount = countTrailingRepeat(recentSignatures);
  if (repeatCount >= config.repeatThreshold) {
    return { flagged: true, reason: "repeat", repeatCount, cycleLength: null };
  }

  const cycleRepeats = config.cycleRepeats ?? DEFAULT_CYCLE_REPEATS;
  const maxCyclePeriod = config.maxCyclePeriod ?? DEFAULT_MAX_CYCLE_PERIOD;

  for (let period = 2; period <= maxCyclePeriod; period += 1) {
    const needed = period * cycleRepeats;
    if (recentSignatures.length < needed) {
      continue;
    }
    const tail = recentSignatures.slice(recentSignatures.length - needed);
    const block = tail.slice(0, period);
    // Skip an internally-constant block — that is a "repeat", not a cycle,
    // and is already handled above.
    if (block.every((sig) => sig === block[0])) {
      continue;
    }
    let matches = true;
    for (let i = period; i < tail.length; i += 1) {
      if (tail[i] !== tail[i % period]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return {
        flagged: true,
        reason: "cycle",
        repeatCount,
        cycleLength: period,
      };
    }
  }

  return { flagged: false, reason: null, repeatCount, cycleLength: null };
}
