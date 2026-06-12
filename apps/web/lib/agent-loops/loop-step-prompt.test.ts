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
});
