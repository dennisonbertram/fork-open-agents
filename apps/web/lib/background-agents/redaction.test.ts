import { describe, expect, test } from "bun:test";
import { redactBackgroundAgentPayload } from "./redaction";

describe("redactBackgroundAgentPayload", () => {
  test("redacts secret keys and common secret values inside command output", () => {
    const payload = redactBackgroundAgentPayload({
      token: "ghp_should-not-survive",
      stdout:
        "Authorization: Bearer abcdefghijklmnop\napi_key=super-secret\nok",
      nested: {
        stderr: "pushed with ghp_abcdefghijklmnopqrstuvwxyz123456",
      },
    });

    expect(payload.token).toBe("[REDACTED]");
    expect(payload.stdout).toContain("Bearer [REDACTED]");
    expect(payload.stdout).toContain("api_key=[REDACTED]");
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(JSON.stringify(payload)).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
    );
  });
});
