import { describe, expect, test } from "bun:test";
import type { BackgroundAgent } from "@/lib/db/schema";
import {
  buildBackgroundAgentExecutionSnapshot,
  hashBackgroundAgentExecutionSnapshot,
  parseBackgroundAgentExecutionSnapshot,
} from "./execution-snapshot";

function buildAgent(
  overrides: Partial<BackgroundAgent> = {},
): BackgroundAgent {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "agent-1",
    userId: "user-1",
    name: "PR reviewer",
    description: null,
    status: "enabled",
    repoOwner: "Acme",
    repoName: "Widgets",
    instructions: "Review the pull request and implement safe fixes.",
    permissions: { github: { contents: "write", pullRequests: "write" } },
    checkCommand: " bun --bun run ci ",
    composioToolkitSlugs: ["github", "slack", "github"],
    builtinToolNames: ["bash", "read_file", "bash"],
    githubActions: {
      comment_on_pr_or_issue: true,
      open_pull_request: true,
    },
    writeScope: {
      mode: "specific_repos",
      repos: [
        { owner: "Acme", name: "Widgets" },
        { owner: "acme", name: "Docs" },
      ],
    },
    requireCiGreenForMerge: true,
    runBudgetPerTarget: 10,
    modelId: " anthropic/claude-haiku-4.5 ",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BackgroundAgentExecutionSnapshotV1", () => {
  test("builds a strict normalized non-secret execution contract", () => {
    const snapshot = buildBackgroundAgentExecutionSnapshot(buildAgent());

    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      source: {
        definitionId: "agent-1",
        name: "PR reviewer",
        updatedAt: "2026-07-11T12:00:00.000Z",
        builtinKind: null,
      },
      repository: { owner: "Acme", name: "Widgets" },
      checkCommand: "bun --bun run ci",
      composioToolkitSlugs: ["github", "slack"],
      builtinToolNames: ["bash", "read_file"],
      modelId: "anthropic/claude-haiku-4.5",
    });
    expect(snapshot.githubActions).toEqual({
      open_pull_request: true,
      comment_on_pr_or_issue: true,
      approve_pull_request: false,
      request_changes: false,
      merge_pull_request: false,
      push: false,
      delete_branch: false,
    });
    expect(snapshot).not.toHaveProperty("userId");
    expect(snapshot).not.toHaveProperty("status");
    expect(snapshot).not.toHaveProperty("runBudgetPerTarget");
    expect(snapshot).not.toHaveProperty("triggers");
  });

  test("canonical SHA-256 is stable across object-key and set-like array order", () => {
    const first = buildBackgroundAgentExecutionSnapshot(buildAgent());
    const second = buildBackgroundAgentExecutionSnapshot(
      buildAgent({
        composioToolkitSlugs: ["slack", "github"],
        builtinToolNames: ["read_file", "bash"],
        permissions: {
          github: { pullRequests: "write", contents: "write" },
        },
      }),
    );

    expect(hashBackgroundAgentExecutionSnapshot(first)).toBe(
      hashBackgroundAgentExecutionSnapshot(second),
    );
    expect(hashBackgroundAgentExecutionSnapshot(first)).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  test("any behavior change changes the definition hash", () => {
    const first = buildBackgroundAgentExecutionSnapshot(buildAgent());
    const changed = buildBackgroundAgentExecutionSnapshot(
      buildAgent({ instructions: "Write the implementation." }),
    );

    expect(hashBackgroundAgentExecutionSnapshot(changed)).not.toBe(
      hashBackgroundAgentExecutionSnapshot(first),
    );
  });

  test("rejects unknown versions and unsafe fields at every strict boundary", () => {
    const snapshot = buildBackgroundAgentExecutionSnapshot(buildAgent());

    expect(() =>
      parseBackgroundAgentExecutionSnapshot({
        ...snapshot,
        snapshotVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      parseBackgroundAgentExecutionSnapshot({
        ...snapshot,
        accessToken: "instructions-canary-secret",
      }),
    ).toThrow();
    expect(() =>
      parseBackgroundAgentExecutionSnapshot({
        ...snapshot,
        repository: { ...snapshot.repository, rawWebhookBody: {} },
      }),
    ).toThrow();
  });

  test("freezes the learnings path as an explicit builtin discriminant", () => {
    const snapshot = buildBackgroundAgentExecutionSnapshot(
      buildAgent({
        instructions:
          "[builtin:pr-review-learnings] Extract durable engineering lessons.",
      }),
    );

    expect(snapshot.source.builtinKind).toBe("pr_review_learnings");
  });
});
