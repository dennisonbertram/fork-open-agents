/**
 * inherit-select-value.ts
 *
 * Radix UI Select v2 prohibits <SelectItem value=""> — it throws at mount.
 * AgentEditor uses an empty string as the in-memory "inherit default" sentinel
 * for modelId and runtimeProfileId, and handleSave maps `value.trim() || null`
 * to send null to the API. To satisfy Radix without changing the API contract,
 * we map "" ↔ INHERIT_SENTINEL at the Select boundary only.
 *
 * Usage:
 *   value={toSelectValue(modelId)}
 *   onValueChange={(v) => setModelId(fromSelectValue(v))}
 *   <SelectItem value={INHERIT_SENTINEL}>Inherit default</SelectItem>
 */

/** Stable sentinel used as the SelectItem value for "inherit default". */
export const INHERIT_SENTINEL = "__inherit__";

/**
 * Maps an internal model/profile id to the value Radix Select expects.
 * Empty string (the "inherit" sentinel in state) becomes INHERIT_SENTINEL.
 */
export function toSelectValue(id: string): string {
  return id === "" ? INHERIT_SENTINEL : id;
}

/**
 * Maps a Radix Select onChange value back to the internal state representation.
 * INHERIT_SENTINEL becomes empty string (the "inherit" sentinel in state).
 */
export function fromSelectValue(v: string): string {
  return v === INHERIT_SENTINEL ? "" : v;
}
