import { describe, expect, test } from "bun:test";
import { normalizeGitHubBackgroundEvent } from "./github-events";

describe("normalizeGitHubBackgroundEvent", () => {
  test("normalizes pull request events", () => {
    const event = normalizeGitHubBackgroundEvent("pull_request", {
      action: "opened",
      repository: { name: "repo", owner: { login: "owner" } },
      sender: { login: "alice" },
      pull_request: {
        id: 123,
        number: 7,
        title: "Add feature",
        html_url: "https://github.com/owner/repo/pull/7",
        head: { ref: "feature", sha: "abc123" },
        base: { ref: "main" },
        labels: [{ name: "ui" }],
      },
    });

    expect(event).toEqual({
      source: "github",
      kind: "github.pull_request",
      externalId: "pull_request:123:opened:abc123",
      repoOwner: "owner",
      repoName: "repo",
      action: "opened",
      ref: "feature",
      sha: "abc123",
      branch: "main",
      prNumber: 7,
      labels: ["ui"],
      title: "Add feature",
      url: "https://github.com/owner/repo/pull/7",
      actor: "alice",
    });
  });

  test("normalizes deployment status events", () => {
    const event = normalizeGitHubBackgroundEvent("deployment_status", {
      action: "created",
      repository: { name: "repo", owner: { login: "owner" } },
      deployment: {
        id: 20,
        ref: "main",
        sha: "def456",
        environment: "Preview",
      },
      deployment_status: {
        id: 21,
        state: "success",
        target_url: "https://preview.example.com",
      },
    });

    expect(event).toMatchObject({
      source: "github",
      kind: "github.deployment_status",
      externalId: "deployment_status:21:success",
      repoOwner: "owner",
      repoName: "repo",
      action: "success",
      sha: "def456",
      deploymentUrl: "https://preview.example.com",
    });
  });

  test("returns null for unsupported events", () => {
    expect(normalizeGitHubBackgroundEvent("push", {})).toBeNull();
  });
});
