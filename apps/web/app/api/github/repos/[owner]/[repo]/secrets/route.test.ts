import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let repoAccess:
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
      userPermission: "read" | "write";
    }
  | {
      ok: false;
      reason:
        | "no_user_token"
        | "user_no_access"
        | "user_no_write"
        | "no_installation"
        | "app_no_access";
    } = {
  ok: true,
  installationId: 123,
  repositoryId: 456,
  defaultBranch: "develop",
  userPermission: "write",
};
let readiness = {
  status: "ready" as "ready" | "action-needed" | "unavailable" | "error",
  headline: "Connected - Secrets read/write available",
  subtext: "Repository secrets can be viewed and managed.",
  canRead: true,
  canWrite: true,
};

const listRepoSecrets = mock(async () => [
  {
    name: "MY_TOKEN",
    createdAt: "2026-06-19T10:00:00Z",
    updatedAt: "2026-06-19T10:05:00Z",
  },
]);
const putRepoSecret = mock(async () => ({ status: 201 as const }));
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
  listRepoSecrets,
  putRepoSecret,
  deleteRepoSecret,
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent,
}));

let routeModulePromise = import("./route");

function createRequest(path = "/api/github/repos/acme/widgets/secrets") {
  return new Request(`http://localhost${path}`);
}

function createJsonRequest(body: unknown) {
  return new Request("http://localhost/api/github/repos/acme/widgets/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext() {
  return { params: Promise.resolve({ owner: "acme", repo: "widgets" }) };
}

describe("repository Actions secrets route", () => {
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
    listRepoSecrets.mockClear();
    putRepoSecret.mockClear();
    deleteRepoSecret.mockClear();
    emitSessionEvent.mockClear();
    withScopedInstallationOctokit.mockClear();
    routeModulePromise = import("./route");
  });

  test("lists secret names and metadata without value fields", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest(), routeContext());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.secrets).toEqual([
      {
        name: "MY_TOKEN",
        createdAt: "2026-06-19T10:00:00Z",
        updatedAt: "2026-06-19T10:05:00Z",
      },
    ]);
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("encrypted_value");
    expect(withScopedInstallationOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: { metadata: "read", secrets: "read" },
      }),
    );
  });

  test("blocks inventory when the GitHub App lacks secrets read", async () => {
    readiness = {
      status: "action-needed",
      headline: "Re-authorize the GitHub App to manage Secrets",
      subtext: "This repo needs the GitHub App's Secrets read permission.",
      canRead: false,
      canWrite: false,
    };
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      errorKind: "app_no_secrets_permission",
    });
    expect(listRepoSecrets).not.toHaveBeenCalled();
  });

  test.each([
    ["no_user_token", "github_not_connected"],
    ["user_no_access", "repo_access_denied"],
    ["user_no_write", "repo_access_denied"],
    ["app_no_access", "app_no_access"],
  ] as const)(
    "maps repo access denial %s without calling GitHub secrets",
    async (reason, errorKind) => {
      repoAccess = { ok: false, reason };
      const { GET } = await routeModulePromise;

      const response = await GET(createRequest(), routeContext());
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ errorKind });
      expect(listRepoSecrets).not.toHaveBeenCalled();
    },
  );

  test("creates a secret through a scoped installation token and emits a redacted audit event", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ name: "MY_TOKEN", value: "plaintext-token" }),
      routeContext(),
    );
    const body = await response.json();
    const event = emitSessionEvent.mock.calls[0]?.[0];
    const serializedEvent = JSON.stringify(event);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, name: "MY_TOKEN" });
    expect(putRepoSecret).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      "MY_TOKEN",
      "plaintext-token",
    );
    expect(withScopedInstallationOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: { metadata: "read", secrets: "write" },
      }),
    );
    expect(event).toMatchObject({
      eventName: "secret.created",
      status: "succeeded",
      sessionId: "github-secrets:acme/widgets",
      payload: expect.objectContaining({
        service: "github-secrets-manager",
        action: "secret.created",
        secretName: "MY_TOKEN",
      }),
    });
    expect(serializedEvent).not.toContain("plaintext-token");
    expect(serializedEvent).not.toContain("encrypted_value");
  });

  test("validates secret names before calling GitHub", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ name: "1BAD", value: "plaintext-token" }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ errorKind: "secret_name_invalid" });
    expect(putRepoSecret).not.toHaveBeenCalled();
    expect(emitSessionEvent).toHaveBeenCalledTimes(1);
  });
});
