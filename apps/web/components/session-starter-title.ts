/**
 * Helpers for the session title field in the session starter UI.
 *
 * A user-supplied title is optional. When present and non-empty after trimming,
 * it is sent to the API so that `resolveSessionTitle` on the server uses it
 * instead of falling back to a random city name.
 */

/**
 * Trims the user-supplied title and returns `undefined` when the result is
 * empty, so callers can omit the field from the POST body entirely.
 */
export function prepareSessionTitle(
  _title: string | undefined,
): string | undefined {
  // Stub — implementation follows in the green commit.
  return undefined;
}
