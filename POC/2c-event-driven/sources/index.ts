import type { EventSource, EventSourceId, RawInbound } from "../types";
import { agentmailSource } from "./agentmail";
import { genericSource } from "./generic";
import { githubSource } from "./github";
import { sentrySource } from "./sentry";
import { vercelDeploySource } from "./vercel-deploy";

export const eventSources: EventSource[] = [
  githubSource,
  agentmailSource,
  vercelDeploySource,
  sentrySource,
  genericSource,
];

export const eventSourcesById = new Map<EventSourceId, EventSource>(
  eventSources.map((s) => [s.id, s]),
);

/**
 * Route an inbound request to its source using header predicates — the same
 * job the production GitHub route does inline with `x-github-event`, but now
 * across multiple sources. Order matters only if predicates overlap; ours are
 * mutually exclusive (distinct headers).
 */
export function resolveSource(inbound: RawInbound): EventSource | null {
  return eventSources.find((s) => s.matchesInbound(inbound)) ?? null;
}

export {
  agentmailSource,
  genericSource,
  githubSource,
  sentrySource,
  vercelDeploySource,
};
