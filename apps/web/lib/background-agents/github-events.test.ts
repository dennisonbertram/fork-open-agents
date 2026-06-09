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

  // BT-001: merged-detection — closed+merged:true → merged:true
  test("surfaces merged:true when pull_request closed and merged is true", () => {
    const event = normalizeGitHubBackgroundEvent("pull_request", {
      action: "closed",
      repository: { name: "repo", owner: { login: "owner" } },
      sender: { login: "alice" },
      pull_request: {
        id: 200,
        number: 42,
        title: "Merge feature",
        html_url: "https://github.com/owner/repo/pull/42",
        merged: true,
        head: { ref: "feature", sha: "sha200" },
        base: { ref: "main" },
        labels: [],
      },
    });

    expect(event).not.toBeNull();
    expect(event?.merged).toBe(true);
    expect(event?.action).toBe("closed");
    expect(event?.kind).toBe("github.pull_request");
  });

  // BT-002: merged-detection — closed+merged:false → merged:false
  test("surfaces merged:false when pull_request closed but not merged", () => {
    const event = normalizeGitHubBackgroundEvent("pull_request", {
      action: "closed",
      repository: { name: "repo", owner: { login: "owner" } },
      sender: { login: "alice" },
      pull_request: {
        id: 201,
        number: 43,
        title: "Close feature",
        html_url: "https://github.com/owner/repo/pull/43",
        merged: false,
        head: { ref: "feature", sha: "sha201" },
        base: { ref: "main" },
        labels: [],
      },
    });

    expect(event).not.toBeNull();
    expect(event?.merged).toBe(false);
  });

  // BT-003: review normalization
  test("normalizes pull_request_review.submitted to kind github.pull_request_review with correct fields and externalId", () => {
    const event = normalizeGitHubBackgroundEvent("pull_request_review", {
      action: "submitted",
      repository: { name: "repo", owner: { login: "owner" } },
      sender: { login: "reviewer" },
      review: {
        id: 9999,
        state: "approved",
        html_url:
          "https://github.com/owner/repo/pull/42#pullrequestreview-9999",
        user: { login: "reviewer" },
      },
      pull_request: {
        id: 200,
        number: 42,
        title: "Merge feature",
        html_url: "https://github.com/owner/repo/pull/42",
        head: { ref: "feature", sha: "sha200" },
        base: { ref: "main" },
      },
    });

    expect(event).not.toBeNull();
    expect(event?.kind).toBe("github.pull_request_review");
    expect(event?.action).toBe("submitted");
    expect(event?.reviewState).toBe("approved");
    expect(event?.reviewId).toBe(9999);
    expect(event?.prNumber).toBe(42);
    expect(event?.reviewerLogin).toBe("reviewer");
    expect(event?.externalId).toBe("pull_request_review:9999:submitted");
    expect(event?.source).toBe("github");
    expect(event?.repoOwner).toBe("owner");
    expect(event?.repoName).toBe("repo");
  });
});
