const COMPOSIO_API_KEY_PATTERN = /\bak_[A-Za-z0-9_*.-]+/g;

export function redactComposioErrorMessage(message: string): string {
  return message.replace(COMPOSIO_API_KEY_PATTERN, "ak_[redacted]");
}

/**
 * Stable errorKind taxonomy for Composio failures, reaching structured events
 * and user-facing copy alike (issue #800).
 *
 * Note on `profile_missing`: "the selected Composio profile no longer exists"
 * has no dedicated slot in the 7-value taxonomy the issue specifies. We keep
 * classifying that message as `composio_unknown` here — it's a distinct,
 * genuinely-unclassified-by-the-other-6-kinds condition, and `composio_unknown`
 * still gets a reasonably specific message via the `message`-echoing fallback
 * branch in `getComposioUserFacingError` below (it doesn't collapse to a fully
 * generic string — the original message text is preserved). We deliberately do
 * NOT fold it into `composio_not_connected`: a missing profile is a
 * configuration problem in this deployment, not "toolkit was never connected".
 */
export type ComposioErrorKind =
  | "composio_missing_api_key"
  | "composio_invalid_api_key"
  | "composio_auth_expired"
  | "composio_repo_policy_blocked"
  | "composio_not_connected"
  | "composio_unreachable"
  | "composio_unknown";

export function getComposioErrorKind(error: unknown): ComposioErrorKind {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("COMPOSIO_API_KEY is not configured")) {
    return "composio_missing_api_key";
  }

  if (
    message.includes("Invalid API key") ||
    message.includes("COMPOSIO_API_KEY is invalid") ||
    message.includes('"code":10401') ||
    message.includes("HTTP_Unauthorized")
  ) {
    return "composio_invalid_api_key";
  }

  if (
    message.includes("connected account is EXPIRED") ||
    message.includes("account status: EXPIRED") ||
    message.includes("connection has expired")
  ) {
    return "composio_auth_expired";
  }

  if (message.includes("Blocked toolkit for this repository")) {
    return "composio_repo_policy_blocked";
  }

  if (
    message.includes("No connected account") ||
    message.includes("not connected")
  ) {
    return "composio_not_connected";
  }

  if (message.includes("Composio is unreachable")) {
    return "composio_unreachable";
  }

  return "composio_unknown";
}

export function getComposioUserFacingError(error: unknown): string {
  const message = redactComposioErrorMessage(
    error instanceof Error ? error.message : String(error),
  );

  switch (getComposioErrorKind(error)) {
    case "composio_missing_api_key":
      return "Composio tools are selected, but COMPOSIO_API_KEY is not configured. Add the key in your deployment environment, then retry, or turn Tools off for this chat.";
    case "composio_invalid_api_key":
      return "Composio tools could not start because COMPOSIO_API_KEY is invalid. Update the key in your deployment environment, then retry, or turn Tools off for this chat.";
    case "composio_auth_expired":
      return "Composio tools could not start: the connection has expired. Reconnect the account in Settings, then retry, or turn Tools off for this chat.";
    case "composio_repo_policy_blocked":
      // Pass the specific, already-final message through as-is rather than
      // wrapping it in generic copy — the message already names the blocked
      // toolkit and repository, which is more actionable than any rewrite.
      return message;
    case "composio_not_connected":
      return "Composio tools are selected, but the account isn't connected yet. Connect it in Settings, then retry, or turn Tools off for this chat.";
    case "composio_unreachable":
      return "Composio could not be reached. Check the Composio API key and service status, then retry, or turn Tools off for this chat.";
    case "composio_unknown":
      return message
        ? `Composio tools could not start: ${message}. Fix the Composio setup, then retry, or turn Tools off for this chat.`
        : "Composio tools could not start. Fix the Composio setup, then retry, or turn Tools off for this chat.";
  }
}
