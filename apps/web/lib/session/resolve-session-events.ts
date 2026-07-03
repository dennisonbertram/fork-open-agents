/**
 * Lightweight structured logging for `resolveSessionFromHeaders`'s
 * provider-attribution lookup (`resolve-session.ts`).
 *
 * This runs on effectively every authenticated request, so it intentionally
 * does not use `emitSessionEvent` (`@/lib/observability/events.ts`), which
 * would add a DB write to a hot path. This is a `console`-based structured
 * logger, matching the debug recipe
 * `grep '"service":"session.resolve-session"'` documented in issue #794.
 */

const SERVICE = "session.resolve-session" as const;

export function logSessionProviderResolved(params: {
  userId: string;
  providerId: string;
}): void {
  console.debug(
    JSON.stringify({
      service: SERVICE,
      event: "session.resolve-session.provider_resolved",
      level: "debug",
      userId: params.userId,
      providerId: params.providerId,
    }),
  );
}

export function logSessionProviderUnknown(params: { userId: string }): void {
  console.warn(
    JSON.stringify({
      service: SERVICE,
      event: "session.resolve-session.unknown_provider",
      level: "warn",
      userId: params.userId,
      errorKind: "unknown_provider",
    }),
  );
}
