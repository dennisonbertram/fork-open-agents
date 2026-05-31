import { describe, expect, test } from "bun:test";
import {
  buildBackgroundRunIdempotencyKey,
  createBackgroundAgentSchema,
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
});
