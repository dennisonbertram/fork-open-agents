/**
 * Bounds and scrubs a provider error message before it is put in front of a
 * user (#1140).
 *
 * A delegated worker's provider failure is the most useful thing we can tell
 * the user, but it arrives as an opaque string from someone else's server. It
 * lands in the tool part's `errorText`, is persisted to `chat_messages.parts`,
 * and is rendered in chat — a wider exposure than a session-event payload,
 * which already has its own redaction boundary on the web side.
 *
 * Two hazards, both handled here:
 *
 * - Length. Providers return whole request bodies and stack traces in 4xx/5xx
 *   messages. An unbounded one crowds out the rest of the error and bloats
 *   every persisted message that carries it.
 * - Credentials. A verbose provider error can echo the request back, including
 *   the `Authorization` header we sent it.
 *
 * ponytail: pattern-based scrub, not a parser. It covers the shapes we actually
 * send (bearer tokens, `api-key`-style headers, and the `sk-`/`csk-` key
 * prefixes used by the providers this repo talks to). If a provider is found
 * echoing a credential in some other shape, add the pattern here rather than
 * suppressing provider messages wholesale — losing the diagnosis is the failure
 * mode this whole change exists to fix.
 */

const MAX_PROVIDER_MESSAGE_LENGTH = 600;

const CREDENTIAL_PATTERNS: RegExp[] = [
  // `Authorization: Bearer <token>` / `Authorization: Api-Key <token>`
  /\b(authorization\s*:\s*)(bearer|api-key|basic)\s+\S+/gi,
  // Bare `Bearer <token>` without the header name.
  /\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  // `api-key: <token>`, `x-api-key: <token>`, `apiKey=<token>`.
  /\b((?:x-)?api[-_]?key\s*[:=]\s*)\S+/gi,
  // Provider key prefixes seen in this repo's inference profiles.
  /\b(?:sk|csk|xai)-[A-Za-z0-9_-]{8,}/gi,
];

const REDACTED = "[REDACTED]";

function scrubCredentials(message: string): string {
  let scrubbed = message;
  for (const pattern of CREDENTIAL_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  return scrubbed;
}

function truncate(message: string): string {
  if (message.length <= MAX_PROVIDER_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_PROVIDER_MESSAGE_LENGTH)}… (truncated)`;
}

/**
 * Returns a message safe to show a user: credentials scrubbed first, then
 * bounded. Scrub-before-truncate matters — truncating first can cut a token in
 * half and leave the front of it in place, past every pattern that would have
 * matched the whole thing.
 */
export function sanitizeProviderErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return truncate(scrubCredentials(raw));
}
