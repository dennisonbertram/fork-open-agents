import { EventDispatcher, type DispatchResult } from "./dispatcher";
import { resolveSource } from "./sources";
import type { AgentEvent, RawInbound, RunAgent, TriggerRule } from "./types";

export type IngestOutcome =
  | { status: 400; body: { error: string } }
  | { status: 401; body: { error: string } }
  | {
      status: 200;
      body: {
        ok: true;
        source: string;
        events: number;
        normalized: AgentEvent[];
        dispatch: DispatchResult;
      };
    };

/**
 * The single ingest endpoint. This is the generalization of
 * `apps/web/app/api/github/webhook/route.ts`:
 *
 *   resolve source (by header) -> verify (per-source scheme) -> parse JSON
 *   -> normalize to canonical AgentEvent(s) -> match rules -> dispatch runs.
 *
 * It is transport-agnostic (takes RawInbound, returns IngestOutcome) so the
 * same logic backs a Next.js route handler in production and the eval here.
 *
 * Crucially, verification uses the RAW body text (never re-serialized JSON) —
 * the same discipline the GitHub route uses (`await req.text()` before parse).
 */
export class IngestPipeline {
  private readonly secrets: Record<string, string>;
  private readonly dispatcher: EventDispatcher;

  constructor(params: {
    rules: TriggerRule[];
    runAgent: RunAgent;
    /** Per-source secret keyed by EventSourceId. */
    secrets: Record<string, string>;
    seen?: Set<string>;
  }) {
    this.secrets = params.secrets;
    this.dispatcher = new EventDispatcher(params.rules, params.runAgent, params.seen);
  }

  async ingest(inbound: RawInbound): Promise<IngestOutcome> {
    const source = resolveSource(inbound);
    if (!source) {
      return { status: 400, body: { error: "unrecognized source" } };
    }

    const secret = this.secrets[source.id];
    if (!secret) {
      return { status: 400, body: { error: `no secret configured for ${source.id}` } };
    }

    const verification = source.verify(inbound, secret);
    if (!verification.ok) {
      return { status: 401, body: { error: `invalid signature: ${verification.reason}` } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(inbound.rawBody);
    } catch {
      return { status: 400, body: { error: "invalid JSON payload" } };
    }

    const events = source.normalize(parsed, inbound);

    // Aggregate dispatch across all events the payload produced (usually one).
    const aggregate: DispatchResult = {
      matched: 0,
      dispatched: 0,
      duplicates: 0,
      decisions: [],
    };
    for (const event of events) {
      const result = await this.dispatcher.dispatch(event);
      aggregate.matched += result.matched;
      aggregate.dispatched += result.dispatched;
      aggregate.duplicates += result.duplicates;
      aggregate.decisions.push(...result.decisions);
    }

    return {
      status: 200,
      body: {
        ok: true,
        source: source.id,
        events: events.length,
        normalized: events,
        dispatch: aggregate,
      },
    };
  }
}
