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
});
