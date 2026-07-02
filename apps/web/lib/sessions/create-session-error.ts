/**
 * Shared error-surfacing helper for createSession failures (#784).
 *
 * Ownership decision: `useSessions().createSession` no longer toasts on
 * failure. It throws a `CreateSessionError` that carries a structured
 * `kind`/`actionUrl` alongside the server's message. Each call site is the
 * single source of truth for how the failure is surfaced to the user (inline
 * message in the New Session dialog; toast in the home page and sessions
 * shell, which have no persistent form surface). This avoids double-toasting
 * a single failure and avoids ever silently dropping one.
 */

export type CreateSessionErrorKind =
  | "vercel_reauth_required"
  | "rate_limited"
  | "validation_failed"
  | "unknown";

export type CreateSessionErrorSurface =
  | "new-session-dialog"
  | "home-page"
  | "sessions-route-shell";

export type CreateSessionErrorInfo = {
  message: string;
  kind: CreateSessionErrorKind;
  actionUrl?: string;
  actionLabel?: string;
};

/** Shape the /api/sessions POST error response may additively carry. */
export type CreateSessionErrorResponseBody = {
  error?: string;
  kind?: CreateSessionErrorKind;
  actionUrl?: string;
};

const FALLBACK_MESSAGE = "Couldn't create the session — try again";

const ACTION_BY_KIND: Partial<
  Record<CreateSessionErrorKind, { actionUrl: string; actionLabel: string }>
> = {
  vercel_reauth_required: {
    actionUrl: "/settings",
    actionLabel: "Go to Settings",
  },
};

/**
 * A rejection thrown by `useSessions().createSession` on failure. Carries
 * the structured error info so call sites can decide how to surface it
 * without re-parsing the response body themselves.
 */
export class CreateSessionError extends Error {
  readonly kind: CreateSessionErrorKind;
  readonly actionUrl?: string;
  readonly actionLabel?: string;

  constructor(info: CreateSessionErrorInfo) {
    super(info.message);
    this.name = "CreateSessionError";
    this.kind = info.kind;
    this.actionUrl = info.actionUrl;
    this.actionLabel = info.actionLabel;
  }
}

function inferKindFromStatus(status: number): CreateSessionErrorKind {
  // A bare 403 is deliberately "unknown", never vercel_reauth_required: the
  // /api/sessions route sets an explicit `kind` on its Vercel-reauth 403,
  // while its bot-protection 403 ("Access denied") is bare — inferring reauth
  // would attach a misleading "/settings" recovery link it cannot fix.
  if (status === 403) {
    return "unknown";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 400 && status < 500) {
    return "validation_failed";
  }
  return "unknown";
}

/**
 * Maps a /api/sessions POST error response (and HTTP status, as a fallback
 * signal for older/unextended responses) to structured error info.
 */
export function mapCreateSessionErrorResponse(
  body: CreateSessionErrorResponseBody,
  status: number,
): CreateSessionErrorInfo {
  const kind: CreateSessionErrorKind = body.kind ?? inferKindFromStatus(status);
  const action = body.actionUrl
    ? { actionUrl: body.actionUrl, actionLabel: "Go to Settings" }
    : ACTION_BY_KIND[kind];

  return {
    message: body.error ?? FALLBACK_MESSAGE,
    kind,
    actionUrl: action?.actionUrl,
    actionLabel: action?.actionLabel,
  };
}

/**
 * Converts any thrown value from `createSession` into structured info,
 * whether or not it's a `CreateSessionError` (network/unexpected errors
 * fall back to generic copy).
 */
export function toCreateSessionErrorInfo(
  error: unknown,
): CreateSessionErrorInfo {
  if (error instanceof CreateSessionError) {
    return {
      message: error.message,
      kind: error.kind,
      actionUrl: error.actionUrl,
      actionLabel: error.actionLabel,
    };
  }

  return {
    message: FALLBACK_MESSAGE,
    kind: "unknown",
  };
}
