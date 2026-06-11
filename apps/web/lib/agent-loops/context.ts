/**
 * Agent Loops — run context utilities
 *
 * mergeStepOutput(context, nodeId, output) → { context, truncated }
 *   Merges `output` under the `nodeId` key in `context`.
 *   Enforces the 64KB cap by dropping the OLDEST node keys first
 *   (insertion-order, Object.keys order).
 *   Never throws.
 *
 * lookupContextPath(context, path) → { found: true; value } | { found: false }
 *   Dot-path lookup on context. Rejects __proto__, constructor, prototype
 *   segments (returns found: false). No eval.
 *
 * No I/O, no DB, no eval.
 */

const CONTEXT_CAP_BYTES = 64 * 1024; // 64KB

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export type MergeStepOutputResult = {
  context: Record<string, unknown>;
  truncated: boolean;
};

export type LookupResult = { found: true; value: unknown } | { found: false };

// ── Helpers ───────────────────────────────────────────────────────────────────

function byteSize(obj: Record<string, unknown>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    // In the extremely unlikely case JSON.stringify fails (circular reference
    // in output that was passed in), treat as 0 — never throw.
    return 0;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Merges `output` under the `nodeId` key in `context`.
 * Enforces the 64KB cap by dropping the OLDEST node keys first
 * (insertion-order). Returns the new context and a truncation flag.
 * Never throws.
 */
export function mergeStepOutput(
  context: Record<string, unknown>,
  nodeId: string,
  output: unknown,
): MergeStepOutputResult {
  // Build a candidate context with the new entry. We work on a shallow copy
  // to avoid mutating the caller's object. Use a new object so the new key
  // always goes at the END of insertion order.
  //
  // If the nodeId already exists, we rebuild without it first so that the
  // replacement lands at the end (most-recent position), not in the middle.
  const withoutCurrent: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (k !== nodeId) {
      withoutCurrent[k] = v;
    }
  }
  let candidate: Record<string, unknown> = {
    ...withoutCurrent,
    [nodeId]: output,
  };

  if (byteSize(candidate) <= CONTEXT_CAP_BYTES) {
    return { context: candidate, truncated: false };
  }

  // Over cap — drop oldest keys until we fit
  const keys = Object.keys(candidate);
  let dropIdx = 0;
  while (byteSize(candidate) > CONTEXT_CAP_BYTES && dropIdx < keys.length - 1) {
    // Never drop the most-recently-added key (the one we just inserted).
    // It is always the last key in the object.
    const keyToDrop = keys[dropIdx];
    const trimmed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(candidate)) {
      if (k !== keyToDrop) {
        trimmed[k] = v;
      }
    }
    candidate = trimmed;
    dropIdx++;
  }

  return { context: candidate, truncated: true };
}

/**
 * Dot-path lookup on context. Rejects __proto__, constructor, prototype
 * segments (returns found: false). No eval.
 */
export function lookupContextPath(
  context: Record<string, unknown>,
  path: string,
): LookupResult {
  if (!path) {
    return { found: false };
  }

  const segments = path.split(".");

  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      return { found: false };
    }
  }

  let current: unknown = context;
  for (const seg of segments) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return { found: false };
    }
    const obj = current as Record<string, unknown>;
    if (!Object.hasOwn(obj, seg)) {
      return { found: false };
    }
    current = obj[seg];
  }

  return { found: true, value: current };
}
