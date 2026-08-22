/**
 * The longest a Vercel sandbox session can possibly live.
 *
 * Vercel's hard SDK ceiling is 5 hours, well above this app's own 90-minute
 * backstop. Used as the "this cannot still be running" bound.
 */
export const MAX_SANDBOX_LIFETIME_MS = 5 * 60 * 60 * 1000;

export type OpenSpanDecision = "ignore" | "expire-and-reopen";

/**
 * What to do when an open billing span already exists for a sandbox that is
 * reporting another open.
 *
 * Two very different situations produce the same event. A reconnect to a VM
 * that is still running must be ignored, or one lifetime would be recorded as
 * several. But a span left open by a VM the provider reclaimed at its hard
 * timeout — nothing ran `stop()`, so nothing closed it — must not be allowed to
 * suppress the next lifetime, or separate billed intervals silently merge into
 * a single row that never ends.
 *
 * Age is the only signal available, and it is a sound one: no sandbox can
 * outlive the provider's ceiling, so an open span older than that is provably
 * not the VM now reporting.
 */
export function decideOpenSpan(
  existingSpanStartedAt: Date,
  incomingStartedAt: Date,
): OpenSpanDecision {
  const age = incomingStartedAt.getTime() - existingSpanStartedAt.getTime();
  return age < MAX_SANDBOX_LIFETIME_MS ? "ignore" : "expire-and-reopen";
}
