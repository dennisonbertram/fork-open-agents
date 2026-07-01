import { describe, expect, test } from "bun:test";
import {
  buildBackgroundRunIdempotencyKey,
  createBackgroundAgentSchema,
  updateBackgroundAgentSchema,
} from "./types";

describe("background agent contract types", () => {
  test("creates stable idempotency keys from agent, trigger, and external event identity", () => {
    const key = buildBackgroundRunIdempotencyKey({
      agentId: "agent_1",
      triggerId: "trigger_1",
      event: {
        source: "github",
        kind: "github.pull_request",
        externalId: "pull_request:123:opened:abc",
        repoOwner: "dennisonbertram",
        repoName: "fork-open-agents",
      },
    });

    expect(key).toBe(
      "agent_1:trigger_1:github:github.pull_request:pull_request:123:opened:abc",
    );
  });

  test("accepts v1 GitHub permissions while leaving external tool providers out of execution config", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      permissions: {
        github: {
          contents: "read",
          pullRequests: "write",
          issues: "read",
          checks: "read",
        },
      },
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.status).toBe("disabled");
    expect(parsed.permissions.github?.pullRequests).toBe("write");
    expect(parsed.triggers[0]?.status).toBe("enabled");
  });

  test("createBackgroundAgentSchema accepts builtinToolNames", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      builtinToolNames: ["read", "bash"],
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toEqual(["read", "bash"]);
  });

  test("createBackgroundAgentSchema accepts a null builtinToolNames (falls back to the default toolpack)", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      builtinToolNames: null,
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toBeNull();
  });

  test("REGRESSION: omitting builtinToolNames entirely still validates (backward-compatible with pre-toolpack API clients)", () => {
    // If builtinToolNames were ever changed from nullish() to a required
    // field, every existing agent-create/update client that doesn't send
    // this new key would start getting 400s. This guards that the field
    // stays optional.
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toBeUndefined();
  });

  test("REGRESSION: updateBackgroundAgentSchema (PATCH) accepts builtinToolNames via its createBackgroundAgentSchema.partial() inheritance", () => {
    // updateBackgroundAgentSchema is derived from createBackgroundAgentSchema
    // via .omit({triggers:true}).partial().extend(...). This test guards
    // that derivation actually carries builtinToolNames through — a
    // .strict() PATCH route would 400 on it otherwise, exactly like the
    // .strict() bug this step fixes for POST.
    const parsed = updateBackgroundAgentSchema.parse({
      builtinToolNames: ["bash", "web_fetch"],
    });

    expect(parsed.builtinToolNames).toEqual(["bash", "web_fetch"]);
  });
});
