/**
 * Agent Loops — loop-step-prompt builder tests
 *
 * Tests for buildLoopStepPrompt({ node, contextSlice, repo, branch }).
 *
 * Behavioral assertions:
 *   BP-001: prompt includes node instructions
 *   BP-002: prompt includes serialized context slice
 *   BP-003: prompt includes output contract (write JSON to /tmp/loop-step-output.json)
 *   BP-004: prompt includes prohibition against pushing
 *   BP-005: prompt includes prohibition against opening PRs
 *   BP-006: prompt includes prohibition against writing outside workspace
 *   BP-007: prompt includes repo + branch context
 *   BP-008: prompt includes field 'branch' in output contract
 *   BP-013/#765: prompt PERMITS `gh pr create` when the node's
 *     permissions.github.pullRequests === "write" (the minted token already
 *     carries that scope — agent-step.ts:permissionsToInstallationToken).
 *   BP-014/#765: all other steps (no permission, or read-only) keep the
 *     PR-creation prohibition verbatim.
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildLoopStepPrompt } = await import("./loop-step-prompt");

const baseNode = {
  id: "impl-step-1",
  kind: "agent_step" as const,
  label: "Implement Issue",
  position: { x: 0, y: 0 },
  instructions: "Implement the feature described in the context.",
};

const baseContextSlice = {
  openIssueCount: 3,
  issues: [{ number: 42, title: "Add dark mode" }],
};

describe("buildLoopStepPrompt", () => {
  test("BP-001: prompt includes node instructions", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    expect(prompt).toContain(baseNode.instructions);
  });

  test("BP-002: prompt includes serialized context slice", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    // Context slice should appear in some form (JSON or YAML-like)
    expect(prompt).toContain("openIssueCount");
    expect(prompt).toContain("42");
  });

  test("BP-003: prompt includes output contract path /tmp/loop-step-output.json", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    expect(prompt).toContain("/tmp/loop-step-output.json");
  });

  test("BP-004: prompt includes prohibition against pushing", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    // Must instruct agent not to push
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/do not.*push|never.*push|must not.*push/);
  });

  test("BP-005: prompt includes prohibition against opening PRs", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    const lower = prompt.toLowerCase();
    expect(lower).toMatch(
      /do not.*pull request|never.*pr|must not.*open.*pr|do not.*open.*pr/,
    );
  });

  test("BP-006: prompt includes prohibition against writing outside workspace", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    // Prohibition language about file writes
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(
      /do not write outside|only.*workspace|restrict.*workspace/,
    );
  });

  test("BP-007: prompt includes repo and branch", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "feat/test-branch",
    });

    expect(prompt).toContain("acme/my-repo");
    expect(prompt).toContain("feat/test-branch");
  });

  test("BP-008: prompt includes 'branch' field in output contract", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    // The output contract must mention the 'branch' field so the agent declares
    // the branch it worked on in the output JSON
    expect(prompt).toContain('"branch"');
  });

  test("BP-009: prompt is a non-empty string", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: {},
      repo: "acme/repo",
      branch: "main",
    });

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("BP-010: prompt with no instructions still includes output contract", () => {
    const nodeNoInstructions = { ...baseNode, instructions: undefined };
    const prompt = buildLoopStepPrompt({
      node: nodeNoInstructions,
      contextSlice: {},
      repo: "acme/repo",
      branch: "main",
    });

    expect(prompt).toContain("/tmp/loop-step-output.json");
  });

  test("BP-011: prompt includes watchdog hint section when stepInput.watchdogHint is present", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
      watchdogHint: "Try using exponential backoff for the API calls.",
    });

    expect(prompt).toContain("Watchdog hint");
    expect(prompt).toContain(
      "Try using exponential backoff for the API calls.",
    );
  });

  test("BP-012: prompt does NOT include watchdog hint section when watchdogHint is absent", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    expect(prompt).not.toContain("Watchdog hint");
  });

  test("BP-013/#765: prompt PERMITS `gh pr create` when permissions.github.pullRequests === 'write'", () => {
    const nodeWithPrWrite = {
      ...baseNode,
      permissions: { github: { pullRequests: "write" as const } },
    };
    const prompt = buildLoopStepPrompt({
      node: nodeWithPrWrite,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    // Must NOT contain the blanket prohibition against opening PRs.
    const lower = prompt.toLowerCase();
    expect(lower).not.toMatch(
      /do not.*open.*pull request|never.*open.*pr|must not.*open.*pr/,
    );
    // Must explicitly say PR creation is permitted for this step.
    expect(lower).toMatch(/gh pr create/);
    expect(lower).toMatch(/may open|permitted|allowed to open/);
  });

  test("BP-014/#765: prompt keeps the PR-creation prohibition when permissions.github.pullRequests is 'read'", () => {
    const nodeWithPrRead = {
      ...baseNode,
      permissions: { github: { pullRequests: "read" as const } },
    };
    const prompt = buildLoopStepPrompt({
      node: nodeWithPrRead,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    const lower = prompt.toLowerCase();
    expect(lower).toMatch(
      /do not.*pull request|never.*pr|must not.*open.*pr|do not.*open.*pr/,
    );
  });

  test("BP-015/#765: prompt keeps the PR-creation prohibition when permissions is absent (default)", () => {
    const prompt = buildLoopStepPrompt({
      node: baseNode,
      contextSlice: baseContextSlice,
      repo: "acme/my-repo",
      branch: "main",
    });

    const lower = prompt.toLowerCase();
    expect(lower).toMatch(
      /do not.*pull request|never.*pr|must not.*open.*pr|do not.*open.*pr/,
    );
  });
});
