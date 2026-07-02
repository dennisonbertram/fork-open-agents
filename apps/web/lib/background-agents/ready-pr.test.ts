import { describe, expect, it } from "bun:test";
import { isSafeBranchName } from "@/lib/git/helpers";
import {
  buildBackgroundAgentRunbookPrompt,
  buildBackgroundBranchName,
} from "./ready-pr";

describe("background agent ready PR helpers", () => {
  it("builds a safe deterministic background branch name", () => {
    const branchName = buildBackgroundBranchName({
      agentName: "Smoke Checks / Deploy!",
      runId: "run_1234567890abcdef",
    });

    expect(branchName).toBe(
      "background-agent/smoke-checks-deploy/run_12345678",
    );
    expect(isSafeBranchName(branchName)).toBe(true);
  });

  it("builds a runbook prompt with the trigger, enabled tools, and working branch", () => {
    const prompt = buildBackgroundAgentRunbookPrompt({
      agentName: "PR reviewer",
      instructions: "Fix obvious type errors.",
      triggerKind: "github.pull_request",
      repoOwner: "acme",
      repoName: "widgets",
      ref: "refs/pull/5/head",
      sha: "abc123",
      branch: "feature/test",
      prNumber: 5,
      payloadSummary: { title: "Fix widgets", actor: "mona" },
      checkCommand: "bun test",
      workingBranch: "background-agent/pr-reviewer/run_12345678",
      enabledGithubActionTools: ["github_push", "github_open_pull_request"],
    });

    expect(prompt).toContain('background agent named "PR reviewer"');
    expect(prompt).toContain("Trigger: github.pull_request");
    expect(prompt).toContain("Fix obvious type errors.");
    expect(prompt).toContain("Do not ask the user questions.");
    expect(prompt).toContain("github_push, github_open_pull_request");
    expect(prompt).toContain("background-agent/pr-reviewer/run_12345678");
    expect(prompt).toContain("bun test");
  });

  it("tells the agent no GitHub tools are enabled when the toggle list is empty", () => {
    const prompt = buildBackgroundAgentRunbookPrompt({
      agentName: "Read-only reviewer",
      instructions: "Summarize the diff.",
      triggerKind: "github.pull_request",
      repoOwner: "acme",
      repoName: "widgets",
      payloadSummary: { title: "Fix widgets" },
      enabledGithubActionTools: [],
    });

    expect(prompt).toContain("No GitHub action tools are enabled");
  });
});
