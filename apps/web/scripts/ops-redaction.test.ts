import { describe, expect, test } from "bun:test";
import { assertNoSecretLikeText, redactOpsText } from "./ops-redaction";

describe("ops redaction", () => {
  test("redacts token-like values", () => {
    expect(redactOpsText("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz")).toBe(
      "[redacted]",
    );
    expect(redactOpsText("authorization: Bearer abc.def.ghi")).toBe(
      "[redacted]",
    );
  });

  test("throws before unsafe text is printed", () => {
    expect(() => assertNoSecretLikeText("COOKIE: session=secret")).toThrow(
      "Refusing to print secret-like output.",
    );
  });
});
