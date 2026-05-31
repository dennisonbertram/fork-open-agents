import { describe, expect, test } from "bun:test";
import {
  assessGitHubAppReadiness,
  GitHubAppReadinessError,
  parseRepo,
} from "./background-agent-github-app-readiness";

describe("background-agent-github-app-readiness", () => {
  test("validates owner/repo input", () => {
    expect(parseRepo("acme/widgets")).toBe("acme/widgets");
    expect(() => parseRepo("acme")).toThrow(GitHubAppReadinessError);
    expect(() => parseRepo("../widgets")).toThrow(GitHubAppReadinessError);
  });

  test("reports ready when installation, events, and permissions are present", () => {
    const result = assessGitHubAppReadiness({
      repo: "acme/widgets",
      installation: {
        ok: true,
        status: 200,
        installationId: 123,
        repositorySelection: "all",
        accountLogin: "acme",
      },
      app: {
        slug: "open-agents",
        events: ["pull_request", "issues", "deployment_status"],
        permissions: {
          contents: "write",
          pull_requests: "write",
          issues: "read",
          deployments: "read",
          statuses: "read",
          metadata: "read",
        },
      },
    });

    expect(result.ready).toBe(true);
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["installation", "ready"],
      ["event_subscriptions", "ready"],
      ["permissions", "ready"],
    ]);
    expect(JSON.stringify(result)).not.toContain("ghs_example_token");
  });

  test("reports missing event subscriptions and insufficient permissions", () => {
    const result = assessGitHubAppReadiness({
      repo: "acme/widgets",
      installation: {
        ok: true,
        status: 200,
        installationId: 123,
        repositorySelection: "all",
        accountLogin: "acme",
      },
      app: {
        events: ["push"],
        permissions: {
          contents: "read",
          pull_requests: "read",
          issues: "read",
          deployments: "read",
          statuses: "read",
          metadata: "read",
        },
      },
    });

    expect(result.ready).toBe(false);
    expect(
      result.checks.find((check) => check.id === "event_subscriptions"),
    ).toMatchObject({
      status: "missing",
      missing: [
        "event:pull_request",
        "event:issues",
        "event:deployment_status",
      ],
    });
    expect(
      result.checks.find((check) => check.id === "permissions"),
    ).toMatchObject({
      status: "missing",
      missing: ["permission:contents=write", "permission:pull_requests=write"],
    });
  });

  test("reports missing repo installation", () => {
    const result = assessGitHubAppReadiness({
      repo: "acme/widgets",
      installation: {
        ok: false,
        status: 404,
      },
      app: {
        events: ["pull_request", "issues", "deployment_status"],
        permissions: {
          contents: "write",
          pull_requests: "write",
          issues: "read",
          deployments: "read",
          statuses: "read",
          metadata: "read",
        },
      },
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === "installation")).toEqual({
      id: "installation",
      label: "Repo installation",
      status: "missing",
      detail: "GitHub App installation does not cover the disposable repo.",
      missing: ["repo_installation"],
      evidence: ["repo=acme/widgets", "status=404"],
    });
  });
});
