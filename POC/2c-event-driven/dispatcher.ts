import { matchEvent } from "./rule-engine";
import type { AgentEvent, AgentRunIntent, RunAgent, TriggerRule } from "./types";

export type DispatchDecision = {
  intent: AgentRunIntent;
  dispatched: boolean;
  duplicate: boolean;
  runId?: string;
};

export type DispatchResult = {
  matched: number;
  dispatched: number;
  duplicates: number;
  decisions: DispatchDecision[];
};

/**
 * Dispatcher — mirrors `apps/web/lib/background-agents/dispatcher.ts`:
 * match an event against rules, then for each intent either start an agent run
 * via the injected `runAgent` seam or skip it as a redelivery duplicate.
 *
 * `seen` is the dedup boundary. In production this is a unique index on the
 * idempotency key (see `createRunForTrigger`). Here it is an in-memory Set so
 * the eval can prove "a redelivered webhook does not double-dispatch".
 */
export class EventDispatcher {
  private readonly rules: TriggerRule[];
  private readonly runAgent: RunAgent;
  private readonly seen: Set<string>;

  constructor(rules: TriggerRule[], runAgent: RunAgent, seen?: Set<string>) {
    this.rules = rules;
    this.runAgent = runAgent;
    this.seen = seen ?? new Set<string>();
  }

  async dispatch(event: AgentEvent): Promise<DispatchResult> {
    const intents = matchEvent(this.rules, event);
    const decisions: DispatchDecision[] = [];
    let dispatched = 0;
    let duplicates = 0;

    for (const intent of intents) {
      if (this.seen.has(intent.idempotencyKey)) {
        duplicates += 1;
        decisions.push({ intent, dispatched: false, duplicate: true });
        continue;
      }
      this.seen.add(intent.idempotencyKey);
      const { runId } = await this.runAgent(intent);
      dispatched += 1;
      decisions.push({ intent, dispatched: true, duplicate: false, runId });
    }

    return {
      matched: intents.length,
      dispatched,
      duplicates,
      decisions,
    };
  }
}
