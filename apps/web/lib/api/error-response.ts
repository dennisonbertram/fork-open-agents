/**
 * Shared API error envelope (issue #1054).
 *
 * `error` stays the human-readable message field because that is what the
 * majority of existing routes already return; this envelope is a superset.
 * `errorKind` is the stable machine-readable code clients branch on.
 */

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export type ApiErrorBody = {
  error: string;
  errorKind: ApiErrorKind;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
};

const STATUS_BY_KIND: Record<ApiErrorKind, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal_error: 500,
};

export type ApiErrorOptions = {
  status?: number;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  headers?: HeadersInit;
};

export function apiError(
  kind: ApiErrorKind,
  message: string,
  opts: ApiErrorOptions = {},
): Response {
  const body: ApiErrorBody = { error: message, errorKind: kind };
  if (opts.fields) {
    body.fields = opts.fields;
  }
  if (opts.retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = opts.retryAfterSeconds;
  }

  const headers = new Headers(opts.headers);
  headers.set("content-type", "application/json");
  if (opts.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(opts.retryAfterSeconds));
  }

  return new Response(JSON.stringify(body), {
    status: opts.status ?? STATUS_BY_KIND[kind],
    headers,
  });
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.error === "string" &&
    typeof candidate.errorKind === "string" &&
    candidate.errorKind in STATUS_BY_KIND
  );
}
