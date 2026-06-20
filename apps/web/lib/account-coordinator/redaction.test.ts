import { describe, expect, test } from "bun:test";
import { redactJsonValue, redactMetadata, redactText } from "./redaction";

describe("account coordinator redaction", () => {
  test("redacts common secret-looking values and bounds strings", () => {
    expect(redactText("Bearer abc.def", 50)).toBe("[redacted]");
    expect(redactText("x".repeat(20), 8)).toBe("xxxxxxx…");
  });

  test("redacts secret keys and omits nested raw objects", () => {
    expect(
      redactMetadata({
        token: "ghp_secret",
        stdout: "raw logs",
        sessionId: "session-1",
        title: "safe",
        nested: { prompt: "do not expose" },
      }),
    ).toEqual({
      token: "[redacted]",
      stdout: "[redacted]",
      sessionId: "session-1",
      title: "safe",
    });
  });

  test("redacts nested diagnostic JSON and bounds arrays", () => {
    expect(
      redactJsonValue(
        {
          payload: {
            authorization: "Bearer abc.def",
            message: "safe",
            nested: [
              { token: "ghp_secret" },
              { value: "ok" },
              { value: "skip" },
            ],
          },
        },
        { maxArrayItems: 2 },
      ),
    ).toEqual({
      payload: {
        authorization: "[redacted]",
        message: "safe",
        nested: [{ token: "[redacted]" }, { value: "ok" }],
      },
    });
  });
});
