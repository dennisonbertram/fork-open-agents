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

const KIND_BY_STATUS = new Map<number, ApiErrorKind>(
  Object.entries(STATUS_BY_KIND).map(([kind, status]) => [
    status,
    kind as ApiErrorKind,
  ]),
);

/**
 * Best-effort status -> kind mapping for helpers that only take (message,
 * status). Anything unmapped is an internal error from the client's point of
 * view.
 */
export function apiErrorKindForStatus(status: number): ApiErrorKind {
  return KIND_BY_STATUS.get(status) ?? "internal_error";
}

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

  if (typeof candidate.error !== "string") {
    return false;
  }

  // Object.hasOwn, not `in`: `in` walks the prototype chain, so a body
  // carrying errorKind "toString" or "constructor" would otherwise pass.
  if (
    typeof candidate.errorKind !== "string" ||
    !Object.hasOwn(STATUS_BY_KIND, candidate.errorKind)
  ) {
    return false;
  }

  // The guard narrows the whole value, so the optional members have to hold up
  // too — otherwise a caller reads fields.foo off null, or backs off for
  // "soon" milliseconds.
  if (candidate.fields !== undefined) {
    if (
      typeof candidate.fields !== "object" ||
      candidate.fields === null ||
      Array.isArray(candidate.fields) ||
      !Object.values(candidate.fields).every((v) => typeof v === "string")
    ) {
      return false;
    }
  }

  if (
    candidate.retryAfterSeconds !== undefined &&
    (typeof candidate.retryAfterSeconds !== "number" ||
      !Number.isFinite(candidate.retryAfterSeconds))
  ) {
    return false;
  }

  return true;
}
