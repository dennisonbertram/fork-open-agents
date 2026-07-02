/**
 * output-schema-shape.ts — shared shape detection for agent_step
 * `outputSchema` (#766).
 *
 * The builder's "Outputs" quick-add control writes a flat `{name: type}` map
 * (see components/agent-config-fields.tsx DeclaredOutputsField), while
 * hand-authored / advanced schemas use JSON-Schema-Lite
 * (`{type, required, properties}`). Both shapes are valid and must be
 * detected consistently everywhere outputSchema is interpreted
 * (agent-step.ts validation, output-refs.ts field-name derivation).
 *
 * Shape-detection rule (PINNED — do not change without updating both
 * agent-step.test.ts and output-refs.test.ts):
 *
 *   An outputSchema object is a FLAT MAP if and only if EVERY value in the
 *   object is one of the string type-names "string" | "number" | "boolean" |
 *   "object" | "array". In a flat map, every declared key is REQUIRED and
 *   type-checked against its declared type-name.
 *
 *   Otherwise (e.g. any value is itself an object, or the schema uses the
 *   `properties`/`required`/`type` JSON-Schema marker keys with non-string
 *   values), the schema is JSON-SCHEMA-LITE: current semantics unchanged
 *   (`required` array + `properties` map of `{type}`).
 *
 *   Edge case: a flat map may legitimately declare a field literally named
 *   "type" (e.g. { type: "string", passed: "boolean" }) — since every value
 *   here is still a string type-name, this is still a flat map. JSON-Schema-
 *   Lite is only inferred when at least one value is NOT a string type-name
 *   (e.g. `properties` is an object, or `required` is an array).
 */

const FLAT_SCHEMA_TYPE_NAMES = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "array",
]);

/**
 * Returns true when `schema` is a flat `{name: type}` map — every declared
 * value (excluding $-meta keys, e.g. "$schema") is a string type-name.
 * Returns false (JSON-Schema-Lite) for an empty object (after excluding
 * $-meta keys), since there's nothing to distinguish it from `{}` and
 * JSON-Schema-Lite's absence of `required`/`properties` is already a no-op
 * there.
 */
export function isFlatOutputSchema(
  schema: Record<string, unknown>,
): boolean {
  const keys = Object.keys(schema).filter((key) => !key.startsWith("$"));
  if (keys.length === 0) return false;
  return keys.every((key) => {
    const value = schema[key];
    return typeof value === "string" && FLAT_SCHEMA_TYPE_NAMES.has(value);
  });
}
