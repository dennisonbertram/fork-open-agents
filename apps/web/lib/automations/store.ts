import "server-only";

import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import {
  loadBackgroundAutomationSource,
  loadLoopAutomationSource,
  type LoadedAutomationSource,
} from "./source-loaders";
import type {
  AutomationFilters,
  AutomationListItem,
  AutomationListSnapshot,
  AutomationSource,
  AutomationSourceStatus,
} from "./types";

export type AutomationSourceLoaders = {
  backgroundAgents: (userId: string) => Promise<LoadedAutomationSource>;
  loops: (userId: string) => Promise<LoadedAutomationSource>;
};

const defaultLoaders: AutomationSourceLoaders = {
  backgroundAgents: loadBackgroundAutomationSource,
  loops: loadLoopAutomationSource,
};

function sourceStatus(
  source: AutomationSource,
  result: PromiseSettledResult<LoadedAutomationSource>,
): AutomationSourceStatus {
  if (result.status === "rejected") {
    return {
      source,
      status: "failed",
      itemCount: 0,
      invalidItemCount: 0,
      errorKind: "source_unavailable",
    };
  }
  const invalidItemCount = result.value.invalidItemCount;
  return {
    source,
    status: invalidItemCount > 0 ? "partial" : "ok",
    itemCount: result.value.items.length,
    invalidItemCount,
    errorKind: invalidItemCount > 0 ? "automation_definition_invalid" : null,
  };
}

function matchesFilters(
  item: AutomationListItem,
  filters: AutomationFilters,
): boolean {
  if (
    filters.repository &&
    (item.repository.owner.toLowerCase() !==
      filters.repository.owner.toLowerCase() ||
      item.repository.name.toLowerCase() !==
        filters.repository.name.toLowerCase())
  ) {
    return false;
  }
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.state && item.nativeStatus !== filters.state) return false;
  return true;
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function compareAutomations(
  left: AutomationListItem,
  right: AutomationListItem,
): number {
  const updatedDifference =
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updatedDifference !== 0) return updatedDifference;
  const nameDifference = compareText(left.name, right.name);
  if (nameDifference !== 0) return nameDifference;
  return compareText(left.id, right.id);
}

function buildFacets(items: AutomationListItem[]) {
  const repositories = new Map<string, AutomationListItem["repository"]>();
  const kinds = new Set<AutomationListItem["kind"]>();
  const states = new Set<AutomationListItem["nativeStatus"]>();
  for (const item of items) {
    const key = `${item.repository.owner.toLowerCase()}/${item.repository.name.toLowerCase()}`;
    if (!repositories.has(key)) repositories.set(key, item.repository);
    kinds.add(item.kind);
    states.add(item.nativeStatus);
  }
  return {
    repositories: [...repositories.values()].sort((left, right) =>
      compareText(`${left.owner}/${left.name}`, `${right.owner}/${right.name}`),
    ),
    kinds: [...kinds].sort(compareText),
    states: [...states].sort(compareText),
  };
}

export async function listAutomations(
  input: {
    userId: string;
    filters: AutomationFilters;
    loopsEnabled?: boolean;
  },
  loaders: AutomationSourceLoaders = defaultLoaders,
): Promise<AutomationListSnapshot> {
  const loopsEnabled = input.loopsEnabled ?? isAgentLoopsEnabled();
  const backgroundPromise = loaders.backgroundAgents(input.userId);
  const loopPromise = loopsEnabled
    ? loaders.loops(input.userId)
    : Promise.resolve<LoadedAutomationSource>({
        items: [],
        invalidItemCount: 0,
      });
  const [backgroundResult, loopResult] = await Promise.allSettled([
    backgroundPromise,
    loopPromise,
  ]);

  const backgroundStatus = sourceStatus("background_agent", backgroundResult);
  const loopStatus: AutomationSourceStatus = loopsEnabled
    ? sourceStatus("agent_loop", loopResult)
    : {
        source: "agent_loop",
        status: "disabled",
        itemCount: 0,
        invalidItemCount: 0,
        errorKind: "feature_disabled",
      };

  const combined = [
    ...(backgroundResult.status === "fulfilled"
      ? backgroundResult.value.items
      : []),
    ...(loopsEnabled && loopResult.status === "fulfilled"
      ? loopResult.value.items
      : []),
  ];
  const unique = new Map<string, AutomationListItem>();
  for (const item of combined) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  const allItems = [...unique.values()];
  const automations = allItems
    .filter((item) => matchesFilters(item, input.filters))
    .sort(compareAutomations);

  return {
    automations,
    total: automations.length,
    sourceStatus: [backgroundStatus, loopStatus],
    facets: buildFacets(allItems),
  };
}
