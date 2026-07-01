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
});

describe("background agent config surface (#745)", () => {
  const baseInput = {
    name: "PR reviewer",
    repoOwner: "dennisonbertram",
    repoName: "fork-open-agents",
    instructions: "Review new pull requests.",
    triggers: [
      {
        name: "Pull request",
        kind: "github.pull_request" as const,
        conditions: { actions: ["opened"] },
      },
    ],
  };

  test("createBackgroundAgentSchema defaults githubActions, writeScope, requireCiGreenForMerge, modelId", () => {
    const parsed = createBackgroundAgentSchema.parse(baseInput);

    expect(parsed.githubActions).toEqual({
      open_pull_request: true,
      comment_on_pr_or_issue: true,
    });
    expect(parsed.writeScope).toEqual({ mode: "this_repo" });
    expect(parsed.requireCiGreenForMerge).toBe(true);
    expect(parsed.modelId).toBeNull();
  });

  test("createBackgroundAgentSchema accepts a full githubActions toggle set", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      githubActions: {
        open_pull_request: true,
        comment_on_pr_or_issue: true,
        approve_pull_request: false,
        request_changes: false,
        merge_pull_request: true,
        push: true,
        delete_branch: false,
      },
    });

    expect(parsed.githubActions.merge_pull_request).toBe(true);
    expect(parsed.githubActions.delete_branch).toBe(false);
  });

  test("createBackgroundAgentSchema rejects unknown githubActions keys", () => {
    const result = createBackgroundAgentSchema.safeParse({
      ...baseInput,
      githubActions: { open_pull_request: true, unknown_toggle: true },
    });

    expect(result.success).toBe(false);
  });

  test("createBackgroundAgentSchema accepts writeScope mode=specific_repos with repos", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "dennisonbertram", name: "fork-open-agents" }],
      },
    });

    expect(parsed.writeScope).toEqual({
      mode: "specific_repos",
      repos: [{ owner: "dennisonbertram", name: "fork-open-agents" }],
    });
  });

  test("createBackgroundAgentSchema rejects an invalid writeScope mode", () => {
    const result = createBackgroundAgentSchema.safeParse({
      ...baseInput,
      writeScope: { mode: "everywhere" },
    });

    expect(result.success).toBe(false);
  });

  test("createBackgroundAgentSchema accepts requireCiGreenForMerge=false", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      requireCiGreenForMerge: false,
    });

    expect(parsed.requireCiGreenForMerge).toBe(false);
  });

  test("createBackgroundAgentSchema accepts a gateway-format modelId", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      modelId: "anthropic/claude-opus-4",
    });

    expect(parsed.modelId).toBe("anthropic/claude-opus-4");
  });

  test("createBackgroundAgentSchema accepts a user-profile: prefixed modelId", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      modelId: "user-profile:profile_123:custom-model",
    });

    expect(parsed.modelId).toBe("user-profile:profile_123:custom-model");
  });

  test("createBackgroundAgentSchema rejects a modelId that is neither gateway format nor user-profile prefixed", () => {
    const result = createBackgroundAgentSchema.safeParse({
      ...baseInput,
      modelId: "not-a-valid-model-id",
    });

    expect(result.success).toBe(false);
  });

  test("createBackgroundAgentSchema accepts null modelId to inherit default", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      modelId: null,
    });

    expect(parsed.modelId).toBeNull();
  });

  test("createBackgroundAgentSchema still accepts deprecated outputMode alongside new fields", () => {
    const parsed = createBackgroundAgentSchema.parse({
      ...baseInput,
      outputMode: "comment",
      githubActions: { comment_on_pr_or_issue: true },
    });

    expect(parsed.outputMode).toBe("comment");
    expect(parsed.githubActions.comment_on_pr_or_issue).toBe(true);
  });

  test("updateBackgroundAgentSchema allows partial config-surface updates", () => {
    const parsed = updateBackgroundAgentSchema.parse({
      requireCiGreenForMerge: false,
    });

    expect(parsed.requireCiGreenForMerge).toBe(false);
    expect(parsed.githubActions).toBeUndefined();
  });

  test("updateBackgroundAgentSchema rejects invalid modelId shape", () => {
    const result = updateBackgroundAgentSchema.safeParse({
      modelId: "bad model id with spaces",
    });

    expect(result.success).toBe(false);
  });
});
