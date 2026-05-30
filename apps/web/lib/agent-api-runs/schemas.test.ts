import { describe, expect, test } from "bun:test";
import { agentRunCreateSchema, createApiTokenSchema } from "./schemas";

describe("agent API schemas", () => {
  test("defaults create requests to managed runtime", () => {
    const parsed = agentRunCreateSchema.parse({
      prompt: "Run the tests",
    });

    expect(parsed.runtimeMode).toBe("managed_runtime");
    expect(parsed.metadata).toEqual({});
  });

  test("caps prompt and metadata input shape", () => {
    const parsed = agentRunCreateSchema.safeParse({
      prompt: "",
    });

    expect(parsed.success).toBe(false);
  });

  test("normalizes token creation scopes", () => {
    const parsed = createApiTokenSchema.parse({
      name: "Local runner",
    });

    expect(parsed.scopes).toEqual([
      "agent_runs:create",
      "agent_runs:read",
      "agent_runs:cancel",
    ]);
  });

  test("rejects malformed repository allowlist entries", () => {
    const parsed = createApiTokenSchema.safeParse({
      name: "Local runner",
      allowedRepositories: ["not-a-repo"],
    });

    expect(parsed.success).toBe(false);
  });
});
