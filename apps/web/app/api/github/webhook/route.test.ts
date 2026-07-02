import { createHmac } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";

const dispatchBackgroundTriggerEvent = mock(async () => ({
  enabled: true,
  matched: 1,
  created: 1,
  duplicates: 0,
  runIds: ["run-1"],
}));
const findSessions = mock(async () => []);
const updateSession = mock(async () => null);
const archiveSession = mock(async () => ({
  session: null,
  archiveTriggered: false,
}));

mock.module("next/server", () => ({
  after: (callback: () => void) => callback(),
}));

mock.module("@/lib/background-agents/dispatcher", () => ({
  dispatchBackgroundTriggerEvent,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessions: {
        findMany: findSessions,
      },
    },
  },
}));

mock.module("@/lib/db/installations", () => ({
  deleteInstallationByInstallationId: async () => 0,
  getInstallationsByInstallationId: async () => [],
  updateInstallationsByInstallationId: async () => 0,
  upsertInstallation: async () => undefined,
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession,
}));

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession,
}));

const routeModulePromise = import("./route");

function sign(payload: string, secret = "github-secret") {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function githubRequest(params: {
  event: string;
  payload: unknown;
  signatureSecret?: string;
  requestId?: string;
}) {
  const body = JSON.stringify(params.payload);
  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "x-github-event": params.event,
      "x-hub-signature-256": sign(body, params.signatureSecret),
      ...(params.requestId ? { "x-request-id": params.requestId } : {}),
    },
  });
}

function pullRequestPayload(action = "opened") {
  return {
    action,
    repository: {
      name: "widgets",
      owner: { login: "acme" },
    },
    sender: { login: "mona" },
    pull_request: {
      id: 101,
      number: 7,
      title: "Fix widgets",
      html_url: "https://github.com/acme/widgets/pull/7",
      merged: false,
      head: {
        ref: "feature/widgets",
        sha: "abc123",
      },
      base: {
        ref: "main",
      },
      labels: [{ name: "bug" }],
    },
  };
}

function pullRequestReviewPayload(action = "submitted", prNumber = 7) {
  return {
    action,
    repository: {
      name: "widgets",
      owner: { login: "acme" },
    },
    sender: { login: "reviewer-alice" },
    review: {
      id: 9001,
      state: "approved",
      html_url: "https://github.com/acme/widgets/pull/7#pullrequestreview-9001",
      user: { login: "reviewer-alice" },
    },
    pull_request: {
      id: 101,
      number: prNumber,
      title: "Fix widgets",
      html_url: "https://github.com/acme/widgets/pull/7",
      head: {
        ref: "feature/widgets",
        sha: "abc123",
      },
      base: {
        ref: "main",
      },
    },
  };
}

describe("POST /api/github/webhook background agent dispatch", () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "github-secret";
    dispatchBackgroundTriggerEvent.mockClear();
    dispatchBackgroundTriggerEvent.mockImplementation(async () => ({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    }));
    findSessions.mockClear();
    updateSession.mockClear();
    archiveSession.mockClear();
  });

  test("rejects invalid signatures before dispatching", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "issues",
        payload: { action: "opened" },
        signatureSecret: "wrong-secret",
      }),
    );

    expect(response.status).toBe(401);
    expect(dispatchBackgroundTriggerEvent).not.toHaveBeenCalled();
  });

  test("dispatches pull request events while preserving existing session behavior", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "pull_request",
        payload: pullRequestPayload("opened"),
        requestId: "req-1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      ignored: true,
      action: "opened",
      backgroundAgents: {
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
        runIds: ["run-1"],
      },
    });
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith({
      requestId: "req-1",
      event: {
        source: "github",
        kind: "github.pull_request",
        externalId: "pull_request:101:opened:abc123",
        repoOwner: "acme",
        repoName: "widgets",
        action: "opened",
        ref: "feature/widgets",
        sha: "abc123",
        branch: "main",
        prNumber: 7,
        labels: ["bug"],
        title: "Fix widgets",
        url: "https://github.com/acme/widgets/pull/7",
        actor: "mona",
        // merged is surfaced from pull_request.merged (false for non-merged PRs)
        merged: false,
      },
    });
    expect(findSessions).not.toHaveBeenCalled();
  });

  test("dispatches issue events", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "issues",
        payload: {
          action: "opened",
          repository: {
            name: "widgets",
            owner: { login: "acme" },
          },
          sender: { login: "mona" },
          issue: {
            id: 202,
            number: 9,
            title: "Broken checkout",
            html_url: "https://github.com/acme/widgets/issues/9",
            labels: [{ name: "production" }],
          },
        },
        requestId: "req-2",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event).toBe("issues");
    expect(body.backgroundAgents.runIds).toEqual(["run-1"]);
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith({
      requestId: "req-2",
      event: {
        source: "github",
        kind: "github.issue",
        externalId: "issue:202:opened",
        repoOwner: "acme",
        repoName: "widgets",
        action: "opened",
        issueNumber: 9,
        labels: ["production"],
        title: "Broken checkout",
        url: "https://github.com/acme/widgets/issues/9",
        actor: "mona",
      },
    });
  });

  // TASK-274: pull_request_review dispatch
  test("dispatches pull_request_review.submitted into dispatchBackgroundTriggerEvent", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "pull_request_review",
        payload: pullRequestReviewPayload("submitted"),
        requestId: "req-review-1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event).toBe("pull_request_review");
    expect(body.backgroundAgents).toBeDefined();
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith({
      requestId: "req-review-1",
      event: expect.objectContaining({
        kind: "github.pull_request_review",
        action: "submitted",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    });
  });

  test("dispatches pull_request closed+merged=true with merged condition", async () => {
    const { POST } = await routeModulePromise;
    const mergedPayload = {
      ...pullRequestPayload("closed"),
      pull_request: {
        ...pullRequestPayload("closed").pull_request,
        merged: true,
      },
    };

    const response = await POST(
      githubRequest({
        event: "pull_request",
        payload: mergedPayload,
        requestId: "req-merged-pr",
      }),
    );

    expect(response.status).toBe(200);
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          merged: true,
          action: "closed",
        }),
      }),
    );
  });

  test("rejects pull_request_review delivery with invalid signature", async () => {
    const { POST } = await routeModulePromise;

    const body = JSON.stringify(pullRequestReviewPayload("submitted"));
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        body,
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": "sha256=invalidsignature",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(dispatchBackgroundTriggerEvent).not.toHaveBeenCalled();
  });

  test("dispatches deployment status events and surfaces disabled agents", async () => {
    dispatchBackgroundTriggerEvent.mockImplementationOnce(async () => ({
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "deployment_status",
        payload: {
          action: "created",
          repository: {
            name: "widgets",
            owner: { login: "acme" },
          },
          sender: { login: "mona" },
          deployment: {
            id: 303,
            ref: "main",
            sha: "def456",
            environment: "Production",
          },
          deployment_status: {
            id: 404,
            state: "failure",
            target_url: "https://example.com/deploy/404",
            environment: "Production",
          },
        },
        requestId: "req-3",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      event: "deployment_status",
      backgroundAgents: {
        enabled: false,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
      },
    });
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith({
      requestId: "req-3",
      event: {
        source: "github",
        kind: "github.deployment_status",
        externalId: "deployment_status:404:failure",
        repoOwner: "acme",
        repoName: "widgets",
        action: "failure",
        ref: "main",
        sha: "def456",
        branch: "main",
        environment: "Production",
        deploymentUrl: "https://example.com/deploy/404",
        url: "https://example.com/deploy/404",
        actor: "mona",
      },
    });
  });

  // #749: check_suite trigger — merge-bot backstop
  test("dispatches check_suite completed events", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "check_suite",
        payload: {
          action: "completed",
          repository: {
            name: "widgets",
            owner: { login: "acme" },
          },
          sender: { login: "merge-bot" },
          check_suite: {
            id: 909,
            conclusion: "success",
            head_sha: "sha909",
            head_branch: "feature/widgets",
            pull_requests: [{ number: 7 }],
          },
        },
        requestId: "req-check-suite",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      event: "check_suite",
      backgroundAgents: {
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
        runIds: ["run-1"],
      },
    });
    expect(dispatchBackgroundTriggerEvent).toHaveBeenCalledWith({
      requestId: "req-check-suite",
      event: {
        source: "github",
        kind: "github.check_suite",
        externalId: "check_suite:909:success:sha909",
        repoOwner: "acme",
        repoName: "widgets",
        action: "success",
        sha: "sha909",
        branch: "feature/widgets",
        prNumber: 7,
        actor: "merge-bot",
      },
    });
  });

  test("ignores check_suite events that are not yet completed", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      githubRequest({
        event: "check_suite",
        payload: {
          action: "requested",
          repository: {
            name: "widgets",
            owner: { login: "acme" },
          },
          sender: { login: "merge-bot" },
          check_suite: {
            id: 910,
            conclusion: null,
            head_sha: "sha910",
          },
        },
        requestId: "req-check-suite-requested",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, ignored: true, event: "check_suite" });
    expect(dispatchBackgroundTriggerEvent).not.toHaveBeenCalled();
  });
});
