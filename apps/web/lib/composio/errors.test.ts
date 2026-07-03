import { describe, expect, test } from "bun:test";
import {
  getComposioErrorKind,
  getComposioUserFacingError,
  redactComposioErrorMessage,
} from "./errors";

describe("Composio error formatting", () => {
  test("redacts Composio API key fragments", () => {
    expect(redactComposioErrorMessage("Invalid API key: ak_secret123")).toBe(
      "Invalid API key: ak_[redacted]",
    );
  });

  test("classifies wrapped invalid API key errors", () => {
    const error = new Error(
      'FatalError: 401 {"error":{"message":"Invalid API key: ak_secret123","code":10401}}',
    );

    expect(getComposioErrorKind(error)).toBe("composio_invalid_api_key");
    expect(getComposioUserFacingError(error)).toBe(
      "Composio tools could not start because COMPOSIO_API_KEY is invalid. Update the key in your deployment environment, then retry, or turn Tools off for this chat.",
    );
  });
});

describe("Composio errorKind 7-value taxonomy (#800)", () => {
  test("classifies missing API key", () => {
    const error = new Error(
      "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
    );
    expect(getComposioErrorKind(error)).toBe("composio_missing_api_key");
  });

  test("classifies invalid API key", () => {
    const error = new Error("COMPOSIO_API_KEY is invalid");
    expect(getComposioErrorKind(error)).toBe("composio_invalid_api_key");
  });

  test("classifies auth expiry (EXPIRED connected account)", () => {
    const error = new Error(
      "Composio tool resolution failed: connected account is EXPIRED for toolkit slack.",
    );
    expect(getComposioErrorKind(error)).toBe("composio_auth_expired");
    const userFacing = getComposioUserFacingError(error).toLowerCase();
    expect(userFacing).toContain("expired");
    expect(userFacing).toContain("reconnect");
  });

  test("classifies repo-policy-blocked errors and passes through the specific message", () => {
    const error = new Error("Blocked toolkit for this repository: gmail.");
    expect(getComposioErrorKind(error)).toBe("composio_repo_policy_blocked");
    expect(getComposioUserFacingError(error)).toBe(
      "Blocked toolkit for this repository: gmail.",
    );
  });

  test("REG-799: classifies the chat composio.repo_policy.blocked event's multi-slug, reason-suffixed summary format (post-review fix)", () => {
    // Exact summary format emitted by apps/web/app/workflows/chat.ts's
    // composio.repo_policy.blocked event (#799 post-review). Proves the
    // substring classifier still matches when the message names multiple
    // slugs with their per-slug reason in parens, not just the single-slug
    // form the profile-path ComposioSetupError uses.
    const error = new Error(
      "Blocked toolkit for this repository: gmail (repo_policy_blocked), slack (not_in_repo_allowlist).",
    );
    expect(getComposioErrorKind(error)).toBe("composio_repo_policy_blocked");
    expect(getComposioUserFacingError(error)).toBe(
      "Blocked toolkit for this repository: gmail (repo_policy_blocked), slack (not_in_repo_allowlist).",
    );
  });

  test("classifies not-connected (never connected) toolkits", () => {
    const error = new Error("No connected account for toolkit gmail.");
    expect(getComposioErrorKind(error)).toBe("composio_not_connected");
  });

  test("classifies unreachable", () => {
    const error = new Error("Composio is unreachable");
    expect(getComposioErrorKind(error)).toBe("composio_unreachable");
  });

  test("falls back to unknown for unrecognized errors", () => {
    const error = new Error("Something else entirely broke");
    expect(getComposioErrorKind(error)).toBe("composio_unknown");
  });

  test("profile-missing message still falls into a taxonomy value (not a stale kind)", () => {
    const error = new Error("The selected Composio profile no longer exists.");
    const kind = getComposioErrorKind(error);
    expect([
      "composio_missing_api_key",
      "composio_invalid_api_key",
      "composio_auth_expired",
      "composio_repo_policy_blocked",
      "composio_not_connected",
      "composio_unreachable",
      "composio_unknown",
    ]).toContain(kind);
  });
});
