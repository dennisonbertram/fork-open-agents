import type {
  AgentEvent,
  AgentRunIntent,
  FieldMatcher,
  TriggerRule,
} from "./types";

/**
 * Read a dotted key from an AgentEvent. Supports the top-level fields plus
 * "metadata.*", "repo.owner", "repo.name". Returns undefined for missing.
 */
export function readField(event: AgentEvent, key: string): unknown {
  if (key === "source") {
    return event.source;
  }
  if (key === "type") {
    return event.type;
  }
  if (key === "subject") {
    return event.subject;
  }
  if (key === "body") {
    return event.body;
  }
  if (key === "actor") {
    return event.actor;
  }
  if (key === "externalId") {
    return event.externalId;
  }
  if (key === "repo.owner") {
    return event.repo?.owner;
  }
  if (key === "repo.name") {
    return event.repo?.name;
  }
  if (key.startsWith("metadata.")) {
    return event.metadata[key.slice("metadata.".length)];
  }
  return undefined;
}

function matchField(value: unknown, matcher: FieldMatcher): boolean {
  if ("equals" in matcher) {
    return value === matcher.equals;
  }
  if ("in" in matcher) {
    return (
      (typeof value === "string" || typeof value === "number") &&
      matcher.in.includes(value)
    );
  }
  if ("prefix" in matcher) {
    return typeof value === "string" && value.startsWith(matcher.prefix);
  }
  if ("contains" in matcher) {
    return typeof value === "string" && value.includes(matcher.contains);
  }
  return false;
}

/** Type match: exact, or "github.*" / "github.pull_request.*" prefix wildcard. */
function typeMatches(eventType: string, ruleType: string): boolean {
  if (ruleType === eventType) {
    return true;
  }
  if (ruleType.endsWith(".*")) {
    return eventType.startsWith(ruleType.slice(0, -1)); // keep trailing dot
  }
  return false;
}

export function ruleMatches(rule: TriggerRule, event: AgentEvent): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.when.source !== event.source) {
    return false;
  }
  if (!typeMatches(event.type, rule.when.type)) {
    return false;
  }
  for (const [key, matcher] of Object.entries(rule.when.match ?? {})) {
    if (!matchField(readField(event, key), matcher)) {
      return false;
    }
  }
  return true;
}

/** Fill `{{dotted.key}}` placeholders from the event. Unknown keys -> "". */
export function renderPrompt(template: string, event: AgentEvent): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = readField(event, key);
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

function idempotencyKey(rule: TriggerRule, event: AgentEvent): string {
  // Mirrors production buildBackgroundRunIdempotencyKey: rule + source + type
  // + externalId. Redelivered webhooks share an externalId, so a second
  // delivery collides and is deduped downstream.
  return [rule.id, event.source, event.type, event.externalId].join(":");
}

/**
 * Match an event against all rules and produce one intent per matching rule.
 * A single event matching multiple rules yields multiple intents (fan-out);
 * an event matching no rule yields [].
 */
export function matchEvent(
  rules: TriggerRule[],
  event: AgentEvent,
): AgentRunIntent[] {
  const intents: AgentRunIntent[] = [];
  for (const rule of rules) {
    if (!ruleMatches(rule, event)) {
      continue;
    }
    intents.push({
      ruleId: rule.id,
      agentId: rule.action.agentId,
      repo: rule.action.targetRepo ?? event.repo,
      prompt: renderPrompt(rule.action.promptTemplate, event),
      idempotencyKey: idempotencyKey(rule, event),
      event,
    });
  }
  return intents;
}
