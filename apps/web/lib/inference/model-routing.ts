import "server-only";

export function normalizeAnthropicBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value.trim());
  if (url.hostname.endsWith("fireworks.ai")) {
    if (
      url.pathname === "" ||
      url.pathname === "/" ||
      url.pathname === "/inference" ||
      url.pathname === "/inference/" ||
      url.pathname === "/inference/v1" ||
      url.pathname === "/inference/v1/" ||
      url.pathname === "/inference/v1/messages" ||
      url.pathname === "/inference/v1/messages/"
    ) {
      url.pathname = "/inference/v1";
    }

    return url.toString().replace(/\/+$/, "");
  }

  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/v1";
  }

  return url.toString().replace(/\/+$/, "");
}

export function normalizeOpenAICompatibleBaseUrl(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value.trim());
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/v1";
  } else if (
    url.pathname.endsWith("/chat/completions") ||
    url.pathname.endsWith("/responses")
  ) {
    url.pathname = url.pathname.replace(
      /\/(?:chat\/completions|responses)\/?$/,
      "",
    );
  }

  return url.toString().replace(/\/+$/, "");
}

export function normalizeInferenceBaseUrl(
  provider: string,
  value: string | null,
): string | null {
  return provider === "openai-compatible"
    ? normalizeOpenAICompatibleBaseUrl(value)
    : normalizeAnthropicBaseUrl(value);
}

export function redactInferenceSecret(
  message: string,
  secret?: string,
): string {
  let redacted = message;

  if (secret) {
    redacted = redacted.split(secret).join("[redacted]");
  }

  return redacted
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bplat_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
}

export function toInferenceProfileTestMessage(
  error: unknown,
  secret?: string,
  providerLabel = "Anthropic",
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactInferenceSecret(rawMessage, secret);

  if (
    /\b401\b/i.test(message) ||
    /unauthorized/i.test(message) ||
    /invalid api key/i.test(message)
  ) {
    return `${providerLabel} credentials were rejected. Check the API key and try again.`;
  }

  if (/\b404\b/i.test(message) || /not found/i.test(message)) {
    return `${providerLabel} endpoint was not found. Check that the base URL points to the provider's /v1 API endpoint.`;
  }

  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return `Could not reach the ${providerLabel} endpoint. Check the base URL and network access.`;
  }

  return message.length > 240
    ? `${message.slice(0, 237)}...`
    : message || `${providerLabel} profile test failed.`;
}
