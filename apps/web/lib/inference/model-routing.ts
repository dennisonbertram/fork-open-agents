import "server-only";

export function normalizeAnthropicBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  const segments = trimmedPath.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);

  // The Anthropic SDK appends `/messages` to the base URL, so the base URL must
  // already point at a versioned API root (e.g. `/v1`). Bare hosts and
  // path-bearing hosts that omit the version segment (e.g.
  // `https://api.z.ai/api/anthropic`) are normalized to end in `/v1`.
  url.pathname =
    lastSegment && /^v\d+$/i.test(lastSegment)
      ? trimmedPath
      : `${trimmedPath}/v1`;

  return url.toString().replace(/\/+$/, "");
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
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactInferenceSecret(rawMessage, secret);
  // Anthropic-compatible providers often hide the real failure in the response
  // body (e.g. a 200 wrapping `404 NOT_FOUND`, or a 429 carrying a balance
  // code), so scan both the message and the body before classifying.
  const responseBody =
    typeof error === "object" &&
    error !== null &&
    "responseBody" in error &&
    typeof (error as { responseBody?: unknown }).responseBody === "string"
      ? (error as { responseBody: string }).responseBody
      : "";
  const haystack = redactInferenceSecret(
    `${rawMessage} ${responseBody}`,
    secret,
  );

  if (
    /\b401\b/i.test(haystack) ||
    /unauthorized/i.test(haystack) ||
    /invalid api key/i.test(haystack)
  ) {
    return "Anthropic credentials were rejected. Check the API key and try again.";
  }

  if (
    /insufficient balance/i.test(haystack) ||
    /resource package/i.test(haystack) ||
    /package has expired/i.test(haystack) ||
    /\brecharge\b/i.test(haystack) ||
    /renew(?:ing)? the subscription/i.test(haystack)
  ) {
    return "The provider account has no balance or an inactive plan. Add balance or renew the provider subscription, then try again.";
  }

  if (
    /\b404\b/i.test(haystack) ||
    /not[\s_]?found/i.test(haystack) ||
    /invalid json response/i.test(message)
  ) {
    return "Anthropic-compatible endpoint was not found. Check that the base URL points to a /v1 API endpoint.";
  }

  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(haystack)) {
    return "Could not reach the Anthropic-compatible endpoint. Check the base URL and network access.";
  }

  return message.length > 240
    ? `${message.slice(0, 237)}...`
    : message || "Anthropic profile test failed.";
}
