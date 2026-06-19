import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let authResult = { ok: true as const, userId: "user-1" };
let repoAccess = {
  ok: true as const,
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "develop",
  userPermission: "write" as const,
};
let readiness = {
  status: "ready" as "ready" | "action-needed" | "unavailable" | "error",
  headline: "Connected - Secrets read/write available",
  subtext: "Repository secrets can be viewed and managed.",
  canRead: true,
  canWrite: true,
};

const putRepoSecret = mock(async () => ({ status: 204 as const }));
const deleteRepoSecret = mock(async () => undefined);
const emitSessionEvent = mock(async (input: Record<string, unknown>) => input);
const withScopedInstallationOctokit = mock(
  async (params: { operation: (octokit: unknown) => Promise<unknown> }) =>
    params.operation({ request: mock(async () => ({})) }),
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

mock.module("@/lib/github/secrets-manager/readiness", () => ({
  getSecretsManagerReadinessCheck: async () => readiness,
}));

mock.module("@/lib/github/secrets-manager/repo-secrets", () => ({
  putRepoSecret,
  deleteRepoSecret,
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent,
}));

let routeModulePromise = import("./route");

function createJsonRequest(body: unknown) {
  return new Request(
    "http://localhost/api/github/repos/acme/widgets/secrets/MY_TOKEN",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function createDeleteRequest() {
  return new Request(
    "http://localhost/api/github/repos/acme/widgets/secrets/MY_TOKEN",
    { method: "DELETE" },
  );
}

function routeContext(name = "MY_TOKEN") {
  return { params: Promise.resolve({ owner: "acme", repo: "widgets", name }) };
}

describe("repository Actions secret item route", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    repoAccess = {
      ok: true,
      installationId: 123,
      repositoryId: 456,
      defaultBranch: "develop",
      userPermission: "write",
    };
    readiness = {
      status: "ready",
      headline: "Connected - Secrets read/write available",
      subtext: "Repository secrets can be viewed and managed.",
      canRead: true,
      canWrite: true,
    };
    putRepoSecret.mockClear();
    deleteRepoSecret.mockClear();
    emitSessionEvent.mockClear();
    withScopedInstallationOctokit.mockClear();
    routeModulePromise = import("./route");
  });

  test("updates a secret value without returning or auditing plaintext", async () => {
    const { PUT } = await routeModulePromise;

    const response = await PUT(
      createJsonRequest({ value: "replacement-token" }),
      routeContext(),
    );
    const body = await response.json();
    const serialized = JSON.stringify({
      response: body,
      event: emitSessionEvent.mock.calls[0]?.[0],
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, name: "MY_TOKEN" });
    expect(putRepoSecret).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      "MY_TOKEN",
      "replacement-token",
    );
    expect(serialized).not.toContain("replacement-token");
    expect(serialized).not.toContain("encrypted_value");
  });

  test("deletes a secret and audits the name only", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(createDeleteRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(deleteRepoSecret).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      "MY_TOKEN",
    );
    expect(emitSessionEvent.mock.calls[0]?.[0]).toMatchObject({
      eventName: "secret.deleted",
      status: "succeeded",
      payload: expect.objectContaining({
        secretName: "MY_TOKEN",
      }),
    });
  });

  test("blocks writes when secrets write is not available", async () => {
    readiness = {
      status: "action-needed",
      headline: "Re-authorize the GitHub App to manage Secrets",
      subtext: "This repo needs the GitHub App's Secrets write permission.",
      canRead: true,
      canWrite: false,
    };
    const { PUT } = await routeModulePromise;

    const response = await PUT(
      createJsonRequest({ value: "replacement-token" }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      errorKind: "app_no_secrets_permission",
    });
    expect(putRepoSecret).not.toHaveBeenCalled();
    expect(emitSessionEvent).toHaveBeenCalledTimes(1);
  });
});
