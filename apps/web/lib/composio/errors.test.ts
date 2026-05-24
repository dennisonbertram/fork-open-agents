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

    expect(getComposioErrorKind(error)).toBe("invalid_api_key");
    expect(getComposioUserFacingError(error)).toBe(
      "Composio tools could not start because COMPOSIO_API_KEY is invalid. Update the key in your deployment environment, then retry, or turn Tools off for this chat.",
    );
  });
});
