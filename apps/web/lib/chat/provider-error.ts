const MAX_RESPONSE_BODY_CHARS = 600;

export type ProviderErrorDetails = {
  responseBody: string | null;
  statusCode: number | null;
};

/**
 * HTTP statuses where retrying the identical request cannot help: the provider
 * rejected the request itself (malformed body, unknown field, unknown model),
 * not the attempt. Auth (401/403), rate limits (429) and server errors (5xx)
 * are deliberately excluded — they get their own guidance or are retryable.
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 404, 405, 409, 413, 422]);

/**
 * Read the AI SDK's `APICallError` shape structurally rather than importing
 * `@ai-sdk/provider` here: the class travels through several provider packages
 * and the app does not otherwise depend on it directly.
 */
export function getProviderErrorDetails(error: unknown): ProviderErrorDetails {
  if (typeof error !== "object" || error === null) {
    return { responseBody: null, statusCode: null };
  }

  const candidate = error as {
    responseBody?: unknown;
    statusCode?: unknown;
  };
  const statusCode =
    typeof candidate.statusCode === "number" ? candidate.statusCode : null;
  const responseBody =
    typeof candidate.responseBody === "string" && candidate.responseBody.trim()
      ? candidate.responseBody.trim()
      : null;

  return { responseBody, statusCode };
}

/**
 * Renders a provider failure with the detail an operator actually needs.
 *
 * `error.message` on an APICallError is often only the HTTP status text
 * ("Bad Request"), which says nothing about what the provider objected to.
 * The response body carries the real complaint, so include it. Request body
 * values are deliberately never included — they carry the whole prompt.
 */
export function describeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const { statusCode, responseBody } = getProviderErrorDetails(error);

  if (statusCode === null && responseBody === null) {
    return message;
  }

  const parts = [message];
  if (statusCode !== null) {
    parts.push(`(HTTP ${statusCode})`);
  }
  if (responseBody !== null) {
    const truncated =
      responseBody.length > MAX_RESPONSE_BODY_CHARS
        ? `${responseBody.slice(0, MAX_RESPONSE_BODY_CHARS)}…`
        : responseBody;
    parts.push(`- provider response: ${truncated}`);
  }

  return parts.join(" ");
}

/**
 * True when retrying the same request against the same provider is pointless.
 * Used to fail the step immediately instead of burning three identical retries
 * and then reporting the failure as if it were transient.
 */
export function isNonRetryableProviderError(error: unknown): boolean {
  const { statusCode } = getProviderErrorDetails(error);
  return statusCode !== null && NON_RETRYABLE_STATUS_CODES.has(statusCode);
}

/**
 * Stable opening phrase used to recognise this message again after the
 * workflow engine has rethrown it across a step boundary, where the error
 * class and name do not survive. It is also the first thing the user reads,
 * so it has to work as copy, not just as a sentinel.
 */
export const PROVIDER_REJECTION_PREFIX =
  "The model provider rejected this request";

const MAX_QUOTED_REASON_CHARS = 200;

export function isProviderRejectionMessage(message: string): boolean {
  return message.includes(PROVIDER_REJECTION_PREFIX);
}

/**
 * User-facing copy for a provider that refused the request outright.
 *
 * Deliberately offers both recoveries rather than picking one: dropping the
 * earlier thinking changes the transcript, and the user may prefer to go back
 * to a model that accepted it. Quotes the provider's own words so the actual
 * objection is visible instead of being guessed at.
 */
export function buildProviderRejectionMessage(params: {
  hasReasoningHistory: boolean;
  responseBody: string | null;
  statusCode: number | null;
}): string {
  const { hasReasoningHistory, responseBody, statusCode } = params;
  const status = statusCode === null ? "" : ` (HTTP ${statusCode})`;
  const lines = [
    `${PROVIDER_REJECTION_PREFIX}${status}, so this turn stopped.`,
  ];

  if (responseBody) {
    const reason =
      responseBody.length > MAX_QUOTED_REASON_CHARS
        ? `${responseBody.slice(0, MAX_QUOTED_REASON_CHARS)}…`
        : responseBody;
    lines.push(`Provider said: ${reason}`);
  }

  if (hasReasoningHistory) {
    lines.push(
      "This chat contains earlier model thinking, which some providers refuse to accept back. " +
        "You can remove the earlier thinking from this chat and send again, or switch back to the model that last worked here.",
    );
  } else {
    lines.push(
      "You can switch back to the model that last worked in this chat and send again.",
    );
  }

  return lines.join("\n\n");
}
