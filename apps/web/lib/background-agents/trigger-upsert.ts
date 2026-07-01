/**
 * Trigger upsert-by-identity helpers for #750 scheduling reliability.
 *
 * When a user edits a background agent, updateBackgroundAgent must not
 * delete+recreate every trigger row — that resets lastRunAt/nextRunAt and
 * changes the row's id (breaking idempotency identity for in-flight runs).
 *
 * A trigger's identity is defined by (kind, schedule, conditions, name).
 * When an incoming trigger input matches an existing row's identity, the
 * existing row is preserved (same id, same schedule-state columns) and only
 * mutable fields (status) are updated. Triggers whose identity changed (or
 * that are brand new) are replaced/created and their schedule state is
 * freshly seeded.
 */
import type { BackgroundAgentTrigger } from "@/lib/db/schema";
import type { BackgroundAgentTriggerKind } from "./types";

export type TriggerIdentityInput = {
  name: string;
  kind: BackgroundAgentTriggerKind;
  conditions: unknown;
  schedule?: string | null;
};

function normalizeSchedule(schedule: string | null | undefined): string {
  return schedule?.trim() ?? "";
}

/**
 * Deterministically stringifies a value with object keys sorted at every
 * nesting level, so two structurally-equal objects with differently-ordered
 * keys produce the same string. Unlike `JSON.stringify(value, keys)`, this
 * recurses — a plain top-level key replacer only preserves keys at the root
 * and silently drops nested object properties.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Builds an identity key for a trigger from its kind/schedule/conditions/name.
 * Two triggers with the same identity key are considered "the same trigger"
 * across an edit, and the existing row is preserved rather than recreated.
 */
export function getTriggerIdentityKey(trigger: TriggerIdentityInput): string {
  return [
    trigger.kind,
    trigger.name.trim(),
    normalizeSchedule(trigger.schedule),
    stableStringify(trigger.conditions),
  ].join("::");
}

/**
 * Matches each incoming trigger input against the existing trigger rows by
 * identity key. Returns, for each incoming trigger (in input order), either
 * the matched existing row (to preserve) or null (new trigger, needs seeding).
 *
 * Each existing row is consumed at most once — if two incoming triggers
 * would produce the same identity key (e.g. duplicate names), only the
 * first is matched to the existing row; the rest are treated as new.
 */
export function matchTriggersByIdentity(params: {
  incoming: TriggerIdentityInput[];
  existing: BackgroundAgentTrigger[];
}): Array<BackgroundAgentTrigger | null> {
  const remainingByKey = new Map<string, BackgroundAgentTrigger[]>();
  for (const row of params.existing) {
    const key = getTriggerIdentityKey({
      name: row.name,
      kind: row.kind as BackgroundAgentTriggerKind,
      conditions: row.conditions,
      schedule: row.schedule,
    });
    const bucket = remainingByKey.get(key) ?? [];
    bucket.push(row);
    remainingByKey.set(key, bucket);
  }

  return params.incoming.map((trigger) => {
    const key = getTriggerIdentityKey(trigger);
    const bucket = remainingByKey.get(key);
    if (!bucket || bucket.length === 0) {
      return null;
    }
    return bucket.shift() ?? null;
  });
}
