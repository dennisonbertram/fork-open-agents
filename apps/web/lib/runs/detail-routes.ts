import type { AutomationRunSource } from "./types";

export function canonicalRunDetailUrl(
  source: AutomationRunSource,
  runId: string,
): string {
  const segment = source === "background_agent" ? "background-agent" : "loop";
  return `/runs/${segment}/${encodeURIComponent(runId)}`;
}

export function legacyBackgroundRunDetailUrl(runId: string): string {
  return `/background-runs/${encodeURIComponent(runId)}`;
}

export function legacyLoopRunDetailUrl(loopId: string, runId: string): string {
  return `/loops/${encodeURIComponent(loopId)}/runs/${encodeURIComponent(runId)}`;
}
