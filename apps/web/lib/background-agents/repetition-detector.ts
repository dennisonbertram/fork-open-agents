/**
 * Repetition / cycle detection over a sequence of turn signatures.
 *
 * Split out of `action-repetition.ts` so that callers which do not need the
 * signature *hashing* can use the detector without pulling `node:crypto` into
 * their bundle. That matters for `app/workflows/chat.ts`, which is a workflow
 * function (`"use workflow"`) — Node.js modules are unavailable there, and
 * importing the hashing module fails the build.
 *
 * Pure string comparison, no I/O, no crypto. `action-repetition.ts` re-exports
 * everything here so existing importers are unaffected.
 */

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

/**
 * Recursively produces a canonical JSON-ish string for `value`: object keys
 * are sorted so key-reordered-but-equivalent args compare equal; arrays keep
 * their order (order is meaningful there); primitives fall back to
 * `JSON.stringify`.
 *
 * Moved here (rather than `action-repetition.ts`, which imports
 * `node:crypto` for `hashTurnToolCalls`) so a crypto-free caller — e.g.
 * `app/workflows/chat.ts`, a workflow function — can build a comparable
 * tool-call signature without pulling `node:crypto` into the workflow VM
 * bundle. `action-repetition.ts` re-exports this for existing importers.
 */
export function stableStringify(value: unknown): string {
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
 * Detects whether the tail of `recentSignatures` (whole-turn signatures,
 * oldest first) looks like a stuck run: either the SAME signature repeating
 * `repeatThreshold+` times in a row ("repeat"), or a short block of period `p`
 * (2..maxCyclePeriod) repeating `cycleRepeats+` times ("cycle") — e.g.
 * A,B,A,B. The shortest matching period wins.
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
