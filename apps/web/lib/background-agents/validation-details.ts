/**
 * Helpers for surfacing field-level Zod validation details from the
 * background-agent API error responses in the UI.
 *
 * API routes return `{ error: string, details: ZodError.flatten() }` on 400.
 * These helpers extract the first actionable error so the UI can show a single
 * clear sentence naming the field and the problem.
 */

export type FlattenedZodDetails = {
  fieldErrors: Record<string, string[] | undefined>;
  formErrors: string[];
};

/**
 * Extracts the first field-level error from a flattened Zod details object and
 * formats it as `'<field>: <message>'`.
 *
 * Returns `null` when details is undefined or has no field errors.
 *
 * Example output: `"schedule: Invalid schedule expression — requires 5 fields or @hourly/@daily/@weekly"`
 */
export function firstFieldError(
  details: FlattenedZodDetails | undefined,
): string | null {
  if (!details) {
    return null;
  }
  const entries = Object.entries(details.fieldErrors);
  for (const [field, messages] of entries) {
    const message = messages?.[0];
    if (message) {
      return `${field}: ${message}`;
    }
  }
  return null;
}
