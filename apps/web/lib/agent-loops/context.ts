/**
 * Agent Loops — run context utilities (STUB for TDD red state)
 *
 * DO NOT IMPLEMENT YET — this stub provides the correct type signatures so
 * the test suite can exercise behavioral failures instead of import errors.
 */

export type MergeStepOutputResult = {
  context: Record<string, unknown>;
  truncated: boolean;
};

export type LookupResult =
  | { found: true; value: unknown }
  | { found: false };

/**
 * Merges `output` under the `nodeId` key in `context`.
 * Enforces the 64KB cap by dropping the OLDEST node keys first.
 * Never throws.
 */
export function mergeStepOutput(
  _context: Record<string, unknown>,
  _nodeId: string,
  _output: unknown,
): MergeStepOutputResult {
  // STUB
  return { context: {}, truncated: false };
}

/**
 * Dot-path lookup on context. Rejects __proto__, constructor, prototype
 * segments (returns found: false). No eval.
 */
export function lookupContextPath(
  _context: Record<string, unknown>,
  _path: string,
): LookupResult {
  // STUB
  return { found: false };
}
