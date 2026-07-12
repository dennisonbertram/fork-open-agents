import type { AutomationSource } from "./types";

/**
 * Length-prefixed source identity. This remains unambiguous even when source
 * IDs contain colons, pipes, slashes, or strings that resemble source names.
 */
export function makeAutomationId(
  source: AutomationSource,
  sourceId: string,
): string {
  return `${source.length}:${source}|${sourceId.length}:${sourceId}`;
}
