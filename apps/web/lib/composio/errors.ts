const COMPOSIO_API_KEY_PATTERN = /\bak_[A-Za-z0-9_*.-]+/g;

export function redactComposioErrorMessage(message: string): string {
  return message.replace(COMPOSIO_API_KEY_PATTERN, "ak_[redacted]");
}

export function getComposioErrorKind(
  error: unknown,
):
  | "missing_api_key"
  | "invalid_api_key"
  | "runtime_unsupported"
  | "profile_missing"
  | "unreachable"
  | "unknown" {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("COMPOSIO_API_KEY is not configured")) {
    return "missing_api_key";
  }

  if (
    message.includes("Invalid API key") ||
    message.includes("COMPOSIO_API_KEY is invalid") ||
    message.includes('"code":10401') ||
    message.includes("HTTP_Unauthorized")
  ) {
    return "invalid_api_key";
  }

  if (message.includes("available only in classic runtime mode")) {
    return "runtime_unsupported";
  }

  if (message.includes("selected Composio profile no longer exists")) {
    return "profile_missing";
  }

  if (message.includes("Composio is unreachable")) {
    return "unreachable";
  }

  return "unknown";
}

export function getComposioUserFacingError(error: unknown): string {
  const message = redactComposioErrorMessage(
    error instanceof Error ? error.message : String(error),
  );

  switch (getComposioErrorKind(error)) {
    case "missing_api_key":
      return "Composio tools are selected, but COMPOSIO_API_KEY is not configured. Add the key in your deployment environment, then retry, or turn Tools off for this chat.";
    case "invalid_api_key":
      return "Composio tools could not start because COMPOSIO_API_KEY is invalid. Update the key in your deployment environment, then retry, or turn Tools off for this chat.";
    case "runtime_unsupported":
      return "Composio tools are currently available only in classic runtime mode. Switch this session to Classic or turn Tools off.";
    case "profile_missing":
      return "The selected Composio profile no longer exists. Pick another tool profile or turn Tools off for this chat.";
    case "unreachable":
      return "Composio could not be reached. Check the Composio API key and service status, then retry, or turn Tools off for this chat.";
    case "unknown":
      return message
        ? `Composio tools could not start: ${message}. Fix the Composio setup, then retry, or turn Tools off for this chat.`
        : "Composio tools could not start. Fix the Composio setup, then retry, or turn Tools off for this chat.";
  }
}
