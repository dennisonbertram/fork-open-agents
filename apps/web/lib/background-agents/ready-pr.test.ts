import { describe, expect, it } from "bun:test";
import { isSafeBranchName } from "@/lib/git/helpers";
import {
  buildBackgroundAgentMutationPrompt,
  buildBackgroundBranchName,
  buildBackgroundPullRequestBody,
  buildBackgroundPullRequestTitle,
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

  it("builds an unattended mutation prompt with the trigger and no-PR constraint", () => {
    const prompt = buildBackgroundAgentMutationPrompt({
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
    });

    expect(prompt).toContain('background agent named "PR reviewer"');
    expect(prompt).toContain("Trigger: github.pull_request");
    expect(prompt).toContain("Fix obvious type errors.");
    expect(prompt).toContain("Do not ask the user questions.");
    expect(prompt).toContain("Do not create, push, or open a pull request");
    expect(prompt).toContain("bun test");
  });

  it("builds a bounded PR title and evidence-heavy body", () => {
    const title = buildBackgroundPullRequestTitle(
      "Investigate production deployment failures and add smoke coverage",
    );
    const body = buildBackgroundPullRequestBody({
      runId: "run_123",
      agentName: "Deploy smoke",
      triggerKind: "github.deployment_status",
      repoOwner: "acme",
      repoName: "widgets",
      baseBranch: "main",
      branchName: "background-agent/deploy-smoke/run_123",
      commitSha: "abc123def",
      checkCommand: "bun --bun run ci",
      runUrl: "https://app.example.com/background-runs/run_123",
    });

    expect(title.length).toBeLessThanOrEqual(72);
    expect(body).toContain(
      "[Background run](https://app.example.com/background-runs/run_123)",
    );
    expect(body).toContain("`github.deployment_status`");
    expect(body).toContain("`abc123def`");
    expect(body).toContain("`bun --bun run ci`");
    expect(body).toContain("created only after");
  });
});
