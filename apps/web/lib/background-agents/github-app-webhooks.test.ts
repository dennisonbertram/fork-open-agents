import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const managedEnvKeys = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "NEXT_PUBLIC_GITHUB_APP_SLUG",
] as const;

const originalEnv = new Map<string, string | undefined>();
let appData: unknown;
let requestError: Error | null = null;
const request = mock(async () => {
  if (requestError) {
    throw requestError;
  }
  return { data: appData };
});

mock.module("@/lib/github/app", () => ({
  getAppOctokit: () => ({ request }),
}));

const modulePromise = import("./github-app-webhooks");

function configureEnv() {
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_PRIVATE_KEY = "private-key";
  process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
  process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "open-agents-dennison";
}

describe("GitHub App webhook readiness", () => {
  beforeEach(() => {
    for (const key of managedEnvKeys) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    appData = {
      slug: "open-agents-dennison",
      // pull_request_review is now required (CODE-02)
      events: [
        "pull_request",
        "issues",
        "deployment_status",
        "pull_request_review",
      ],
      permissions: {
        contents: "write",
        pull_requests: "write",
        issues: "read",
        deployments: "read",
        statuses: "read",
        metadata: "read",
      },
    };
    requestError = null;
    request.mockClear();
  });

  afterEach(() => {
    for (const key of managedEnvKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  test("reports missing app env before calling GitHub", async () => {
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check).toMatchObject({
      id: "github_app_webhooks",
      status: "missing",
      missing: [
        "GITHUB_APP_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_WEBHOOK_SECRET",
        "NEXT_PUBLIC_GITHUB_APP_SLUG",
      ],
    });
    expect(request).not.toHaveBeenCalled();
  });

  test("reports ready when required events and permissions are configured", async () => {
    configureEnv();
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check).toMatchObject({
      id: "github_app_webhooks",
      status: "ready",
      missing: [],
    });
    expect(check.detail).toContain("open-agents-dennison");
  });

  test("reports missing event subscriptions and insufficient permissions", async () => {
    configureEnv();
    appData = {
      slug: "open-agents-dennison",
      events: ["push"],
      permissions: {
        contents: "read",
        pull_requests: "read",
        issues: "read",
        deployments: "read",
        statuses: "read",
        metadata: "read",
      },
    };
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check).toMatchObject({
      status: "missing",
      missing: expect.arrayContaining([
        "event:pull_request",
        "event:issues",
        "event:deployment_status",
        "permission:contents=write",
        "permission:pull_requests=write",
      ]),
    });
  });

  test("reports metadata failure without exposing secrets", async () => {
    configureEnv();
    requestError = new Error("GitHub unavailable");
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check).toMatchObject({
      status: "missing",
      missing: ["github_app_metadata"],
    });
    expect(JSON.stringify(check)).not.toContain("private-key");
    expect(JSON.stringify(check)).not.toContain("webhook-secret");
  });

  // TASK-274: pull_request_review subscription requirement
  test("reports missing when pull_request_review is absent from installed events", async () => {
    configureEnv();
    // App subscribed to pull_request/issues/deployment_status but NOT pull_request_review
    appData = {
      slug: "open-agents-dennison",
      events: ["pull_request", "issues", "deployment_status"],
      permissions: {
        contents: "write",
        pull_requests: "write",
        issues: "read",
        deployments: "read",
        statuses: "read",
        metadata: "read",
      },
    };
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check.status).toBe("missing");
    expect(check.missing).toContain("event:pull_request_review");
  });

  test("reports ready when pull_request_review is present in installed events", async () => {
    configureEnv();
    appData = {
      slug: "open-agents-dennison",
      events: [
        "pull_request",
        "issues",
        "deployment_status",
        "pull_request_review",
      ],
      permissions: {
        contents: "write",
        pull_requests: "write",
        issues: "read",
        deployments: "read",
        statuses: "read",
        metadata: "read",
      },
    };
    const { getGitHubAppWebhookReadinessCheck } = await modulePromise;

    const check = await getGitHubAppWebhookReadinessCheck();

    expect(check.status).toBe("ready");
    expect(check.missing).not.toContain("event:pull_request_review");
  });
});
