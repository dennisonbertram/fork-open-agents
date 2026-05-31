/**
 * Token usage shape.
 *
 * This mirrors the AI SDK `LanguageModelUsage` object that flows through the
 * real codebase: every agent step in `apps/web/app/workflows/chat.ts` produces
 * a `result.stepUsage` of this shape, and `addLanguageModelUsage`
 * (apps/web/app/workflows/usage-utils.ts) sums them into `totalUsage`. We keep
 * the same field names so the meter can consume the real object verbatim.
 *
 * The persisted `usage_events` table (apps/web/lib/db/schema.ts) stores
 * inputTokens / cachedInputTokens / outputTokens — the subset that maps to $.
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported total; may differ from input+output (reasoning, overhead). */
  totalTokens?: number;
  reasoningTokens?: number;
  /** Cached input tokens are billed at a discounted rate. */
  cachedInputTokens?: number;
}

/** Add two TokenUsage objects (mirrors addLanguageModelUsage in the real repo). */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const add = (x?: number, y?: number) =>
    x == null && y == null ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
    cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
  };
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  };
}

/** Total billable token count for a usage object (input + output, cached counted once). */
export function totalTokenCount(u: TokenUsage): number {
  if (u.totalTokens != null) {
    return u.totalTokens;
  }
  return (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
}
