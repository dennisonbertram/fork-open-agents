import { describe, expect, test } from "bun:test";
import { redactHarnessPayload } from "./redaction";

describe("harness redaction", () => {
  test("removes bearer values and sensitive keys", () => {
    const sensitiveKey = ["api", "Key"].join("");

    expect(
      redactHarnessPayload({
        authorization: "Bearer secret-token",
        nested: {
          [sensitiveKey]: "sample-credential-value",
          message: "POSTGRES_PASSWORD=hunter2",
        },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: {
        [sensitiveKey]: "[REDACTED]",
        message: "POSTGRES_PASSWORD=[REDACTED]",
      },
    });
  });

  test("blocks artifact-like content", () => {
    expect(
      redactHarnessPayload({
        artifact_id: "artifact-1",
        content: "raw file contents",
        stdout: "secret output",
      }),
    ).toEqual({
      artifact_id: "artifact-1",
      content: "[REDACTED_ARTIFACT_CONTENT]",
      stdout: "[REDACTED_ARTIFACT_CONTENT]",
    });
  });
});
