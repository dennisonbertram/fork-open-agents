/**
 * Client-side reader for API error bodies (issue #1054).
 *
 * The API is migrating to a single error envelope:
 *
 *   { error: string; errorKind: string; fields?: Record<string, string>;
 *     retryAfterSeconds?: number }
 *
 * Until every route has migrated, some responses still use `{ message }` (and
 * some already send `errorKind` with `message`). This reader applies the
 * agreed transition rule so both shapes parse, and never throws on a malformed
 * body:
 *
 *   message = body.error ?? body.message ?? fallback
 *   kind    = body.errorKind ?? "unknown"
 */
export type ReadApiErrorResult = {
  message: string;
  kind: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
};

const DEFAULT_MESSAGE = "Something went wrong";

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function stringRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    ([, fieldValue]) => typeof fieldValue === "string",
  ) as [string, string][];
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function readApiError(
  body: unknown,
  fallbackMessage = DEFAULT_MESSAGE,
): ReadApiErrorResult {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return {
      message: trimmed.length > 0 ? trimmed : fallbackMessage,
      kind: "unknown",
    };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { message: fallbackMessage, kind: "unknown" };
  }

  const record = body as Record<string, unknown>;
  const retryAfterSeconds = record.retryAfterSeconds;

  return {
    message:
      stringField(record, "error") ??
      stringField(record, "message") ??
      fallbackMessage,
    kind: stringField(record, "errorKind") ?? "unknown",
    fields: stringRecord(record.fields),
    retryAfterSeconds:
      typeof retryAfterSeconds === "number" &&
      Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds
        : undefined,
  };
}
