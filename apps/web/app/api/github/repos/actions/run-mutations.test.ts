import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

type RepoAccess =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      userPermission: "read" | "write";
    }
  | { ok: false; reason: "no_installation" | "app_no_access" };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let repoAccess: RepoAccess = {
  ok: true,
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "develop",
  userPermission: "write",
};
let readinessIsReady = true;

const rerunRun = mock(async () => undefined);
const rerunFailedJobs = mock(async () => undefined);
const cancelRun = mock(async () => undefined);
const dispatchWorkflow = mock(async () => undefined);
const pollForDispatchedRun = mock(async () => ({
  id: 501,
  runNumber: 77,
  name: "CI",
  status: "queued",
  conclusion: null,
  branch: "develop",
  event: "workflow_dispatch",
  actor: "octocat",
  createdAt: "2026-06-19T14:00:02Z",
  updatedAt: "2026-06-19T14:00:02Z",
  htmlUrl: "https://github.com/acme/widgets/actions/runs/501",
  durationMs: null,
  display: {
    label: "Queued",
    tone: "queued",
    className: "bg-amber-500",
  },
}));
const emitActionsManagerEvent = mock(async () => null);

const withScopedInstallationOctokit = mock(
  async (params: { operation: (octokit: unknown) => Promise<unknown> }) =>
    params.operation({ rest: { actions: {} } }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => repoAccess,
}));

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit,
}));

mock.module("@/lib/github/actions-manager/readiness", () => ({
  getActionsManagerReadinessCheck: async () =>
    readinessIsReady
      ? {
          status: "ready",
          headline: "Connected - Actions write available",
        }
      : {
          status: "action-needed",
          headline: "Re-authorize the GitHub App to manage Actions",
          errorKind: "app_no_actions_permission",
        },
}));

mock.module("@/lib/github/actions-manager/runs", () => ({
  rerunRun,
  rerunFailedJobs,
  cancelRun,
}));

mock.module("@/lib/github/actions-manager/dispatch", () => ({
  dispatchWorkflow,
  pollForDispatchedRun,
}));

mock.module("@/lib/github/actions-manager/events", () => ({
  emitActionsManagerEvent,
}));

function runContext() {
  return {
    params: Promise.resolve({ owner: "acme", repo: "widgets", runId: "42" }),
  };
}

function workflowContext() {
  return {
    params: Promise.resolve({
      owner: "acme",
      repo: "widgets",
      workflowId: "ci.yml",
    }),
  };
}

describe("GitHub Actions mutation routes", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    repoAccess = {
      ok: true,
      installationId: 123,
      repositoryId: 456,
      defaultBranch: "develop",
      userPermission: "write",
    };
    readinessIsReady = true;
    rerunRun.mockClear();
    rerunFailedJobs.mockClear();
    cancelRun.mockClear();
    dispatchWorkflow.mockClear();
    pollForDispatchedRun.mockClear();
    emitActionsManagerEvent.mockClear();
    withScopedInstallationOctokit.mockClear();
  });

  test("reruns failed jobs with actions:write and emits an audit event", async () => {
    const { POST } =
      await import("../[owner]/[repo]/actions/runs/[runId]/rerun/route");

    const response = await POST(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/runs/42/rerun?onlyFailed=true",
        { method: "POST" },
      ),
      runContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, action: "run.rerun_failed" });
    expect(withScopedInstallationOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 123,
        repositoryId: 456,
        permissions: { actions: "write", metadata: "read" },
      }),
    );
    expect(rerunFailedJobs).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      42,
    );
    expect(emitActionsManagerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "run.rerun_failed",
        userId: "user-1",
        installationId: 123,
        repoId: 456,
        runId: 42,
        redactionStatus: "not_required",
      }),
    );
  });

  test("cancels a run with actions:write and emits an audit event", async () => {
    const { POST } =
      await import("../[owner]/[repo]/actions/runs/[runId]/cancel/route");

    const response = await POST(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/runs/42/cancel",
        { method: "POST" },
      ),
      runContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, action: "run.cancel" });
    expect(cancelRun).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      42,
    );
    expect(emitActionsManagerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "run.cancel", runId: 42 }),
    );
  });

  test("dispatches a workflow and surfaces a newly polled run", async () => {
    const { POST } =
      await import("../[owner]/[repo]/actions/workflows/[workflowId]/dispatch/route");

    const response = await POST(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/workflows/ci.yml/dispatch",
        {
          method: "POST",
          body: JSON.stringify({
            ref: "develop",
            inputs: { environment: "dev", api_token: "secret-value" },
          }),
        },
      ),
      workflowContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, action: "workflow.dispatch" });
    expect(body.run).toMatchObject({ id: 501, runNumber: 77 });
    expect(dispatchWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        workflowId: "ci.yml",
        ref: "develop",
        defaultBranch: "develop",
        inputs: { environment: "dev", api_token: "secret-value" },
      }),
    );
    expect(emitActionsManagerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workflow.dispatch",
        workflowId: "ci.yml",
        dispatchRef: "develop",
        inputKeys: ["environment", "api_token"],
      }),
    );
  });

  test("rejects non-default branch workflow dispatches", async () => {
    const { POST } =
      await import("../[owner]/[repo]/actions/workflows/[workflowId]/dispatch/route");

    const response = await POST(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/workflows/ci.yml/dispatch",
        {
          method: "POST",
          body: JSON.stringify({ ref: "feature", inputs: {} }),
        },
      ),
      workflowContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      ok: false,
      errorKind: "workflow_not_on_default_branch",
    });
    expect(dispatchWorkflow).not.toHaveBeenCalled();
  });

  test("does not mint write tokens or emit events when actions:write is missing", async () => {
    readinessIsReady = false;
    const { POST } =
      await import("../[owner]/[repo]/actions/runs/[runId]/cancel/route");

    const response = await POST(
      new Request(
        "http://localhost/api/github/repos/acme/widgets/actions/runs/42/cancel",
        { method: "POST" },
      ),
      runContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorKind: "app_no_actions_permission" });
    expect(withScopedInstallationOctokit).not.toHaveBeenCalled();
    expect(cancelRun).not.toHaveBeenCalled();
    expect(emitActionsManagerEvent).not.toHaveBeenCalled();
  });
});
