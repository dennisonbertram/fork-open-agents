/**
 * Merges a capped "newest-N" event slice with an uncapped, composio-scoped
 * event fetch, deduping by id (Codex review, PR #824, P2-2).
 *
 * The run detail route's primary events query is a bounded newest-200 slice
 * (see agent-loops/store.ts's listAgentLoopEvents). agent-loop.step.
 * composio.* events are emitted early in a step — before openAgent.generate's
 * event storm — so on a chatty run, newer events can push the composio
 * events off that slice entirely. Without this merge, the run detail page's
 * deriveLoopComposioWarnings(events) would never see them.
 *
 * `composioEvents` should come from an uncapped, composio-scoped store query
 * (cheap: narrowed by loopRunId first, same index as the capped query).
 */
export function mergeEventsForSummary<T extends { id: string }>(
  cappedEvents: T[],
  composioEvents: T[],
): T[] {
  const seenIds = new Set(cappedEvents.map((e) => e.id));
  const additional = composioEvents.filter((e) => !seenIds.has(e.id));
  return [...cappedEvents, ...additional];
}
