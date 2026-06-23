import "server-only";

import type { InferenceProfileProvider } from "@/lib/inference/types";

export function normalizeAnthropicBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value.trim());
  const trimmedPath = trimAnthropicEndpointPath(
    url.pathname.replace(/\/+$/, ""),
  );
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

export function normalizeOpenAICompatibleBaseUrl(value: string | null): string {
  if (!value) {
    throw new Error("OpenAI-compatible profiles require a base URL.");
  }

  const url = new URL(value.trim());
  const trimmedPath = trimOpenAICompatibleEndpointPath(
    url.pathname.replace(/\/+$/, ""),
  );
  const segments = trimmedPath.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);

  url.pathname =
    lastSegment && /^v\d+$/i.test(lastSegment)
      ? trimmedPath
      : `${trimmedPath}/v1`;

  return url.toString().replace(/\/+$/, "");
}

function trimOpenAICompatibleEndpointPath(path: string): string {
  return trimKnownEndpointPath(path, isKnownOpenAIEndpointSuffix);
}

function trimAnthropicEndpointPath(path: string): string {
  return trimKnownEndpointPath(path, isKnownAnthropicEndpointSuffix);
}

function trimKnownEndpointPath(
  path: string,
  isKnownEndpointSuffix: (segments: string[]) => boolean,
): string {
  const segments = path.split("/").filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const versionIndex = lowerSegments.findIndex((segment) =>
    /^v\d+$/.test(segment),
  );

  if (versionIndex >= 0) {
    const afterVersion = lowerSegments.slice(versionIndex + 1);
    if (isKnownEndpointSuffix(afterVersion)) {
      return toPathname(segments.slice(0, versionIndex + 1));
    }
  }

  const endpointStartIndex = findKnownEndpointStart(
    lowerSegments,
    isKnownEndpointSuffix,
  );
  if (endpointStartIndex >= 0) {
    return toPathname(segments.slice(0, endpointStartIndex));
  }

  return path;
}

function isKnownOpenAIEndpointSuffix(segments: string[]): boolean {
  return (
    startsWithSegments(segments, ["chat", "completions"]) ||
    startsWithSegments(segments, ["completions"]) ||
    startsWithSegments(segments, ["responses"]) ||
    startsWithSegments(segments, ["models"])
  );
}

function isKnownAnthropicEndpointSuffix(segments: string[]): boolean {
  return (
    startsWithSegments(segments, ["messages"]) ||
    startsWithSegments(segments, ["models"]) ||
    startsWithSegments(segments, ["complete"]) ||
    startsWithSegments(segments, ["count_tokens"])
  );
}

function findKnownEndpointStart(
  segments: string[],
  isKnownEndpointSuffix: (segments: string[]) => boolean,
): number {
  for (let index = 0; index < segments.length; index++) {
    const rest = segments.slice(index);
    if (isKnownEndpointSuffix(rest)) {
      return index;
    }
  }

  return -1;
}

function startsWithSegments(value: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => value[index] === segment);
}

function toPathname(segments: string[]): string {
  return segments.length > 0 ? `/${segments.join("/")}` : "";
}

export function normalizeInferenceProfileBaseUrl(
  provider: InferenceProfileProvider,
  value: string | null,
): string | null {
  if (provider === "anthropic") {
    return normalizeAnthropicBaseUrl(value);
  }

  return normalizeOpenAICompatibleBaseUrl(value);
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
  provider: InferenceProfileProvider = "anthropic",
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
    return provider === "anthropic"
      ? "Anthropic credentials were rejected. Check the API key and try again."
      : "OpenAI-compatible credentials were rejected. Check the API key and try again.";
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
    /model not found/i.test(haystack) ||
    /inaccessible/i.test(haystack) ||
    /not deployed/i.test(haystack) ||
    /"param"\s*:\s*"model"/i.test(haystack)
  ) {
    return "The selected model was not found or is not accessible from this provider account. Choose a model served by this profile, then try again.";
  }

  if (
    /\b404\b/i.test(haystack) ||
    /not[\s_]?found/i.test(haystack) ||
    /invalid json response/i.test(message)
  ) {
    return provider === "anthropic"
      ? "Anthropic-compatible endpoint was not found. Check that the base URL points to a /v1 API endpoint."
      : "OpenAI-compatible endpoint was not found. Check that the base URL points to a /v1 API endpoint.";
  }

  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(haystack)) {
    return provider === "anthropic"
      ? "Could not reach the Anthropic-compatible endpoint. Check the base URL and network access."
      : "Could not reach the OpenAI-compatible endpoint. Check the base URL and network access.";
  }

  return message.length > 240
    ? `${message.slice(0, 237)}...`
    : message ||
        (provider === "anthropic"
          ? "Anthropic profile test failed."
          : "OpenAI-compatible profile test failed.");
}
