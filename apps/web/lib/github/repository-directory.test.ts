import { describe, expect, mock, test } from "bun:test";
import type { RepositoryDirectoryDependencies } from "./repository-directory";

mock.module("server-only", () => ({}));

const { loadRepositoryDirectory } = await import("./repository-directory");

function repository(fullName: string, updatedAt: string) {
  const name = fullName.slice(fullName.indexOf("/") + 1);
  return {
    name,
    full_name: fullName,
    description: null,
    private: true,
    clone_url: `https://github.com/${fullName}.git`,
    updated_at: updatedAt,
    language: "TypeScript",
  };
}

function dependencies(
  overrides: Partial<RepositoryDirectoryDependencies> = {},
): RepositoryDirectoryDependencies {
  return {
    hasGitHubAccount: mock(async () => true),
    getInstallations: mock(async () => [
      { installationId: 1, accountLogin: "acme" },
    ]),
    getUserToken: mock(async () => "token"),
    createRequestId: () => "request-1",
    listInstallationRepositories: mock(async () => [
      repository("acme/widgets", "2026-07-11T00:00:00.000Z"),
    ]),
    ...overrides,
  };
}

describe("loadRepositoryDirectory", () => {
  test("loads every owned installation, deduplicates, and keeps recent order", async () => {
    const listInstallationRepositories = mock(
      async ({ installationId }: { installationId: number }) =>
        installationId === 1
          ? [
              repository("acme/shared", "2026-07-09T00:00:00.000Z"),
              repository("acme/older", "2026-07-08T00:00:00.000Z"),
            ]
          : [
              repository("ACME/shared", "2026-07-11T00:00:00.000Z"),
              repository("acme/newer", "2026-07-10T00:00:00.000Z"),
            ],
    );
    const snapshot = await loadRepositoryDirectory(
      "user-1",
      dependencies({
        getInstallations: mock(async () => [
          { installationId: 1, accountLogin: "acme" },
          { installationId: 2, accountLogin: "ACME" },
        ]),
        listInstallationRepositories,
      }),
    );

    expect(snapshot.status).toBe("ready");
    expect(snapshot.repositories.map((repo) => repo.fullName)).toEqual([
      "ACME/shared",
      "ACME/newer",
      "acme/older",
    ]);
    expect(listInstallationRepositories).toHaveBeenCalledTimes(2);
    expect(listInstallationRepositories).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        installationId: 1,
        userToken: "token",
        owner: "acme",
      }),
    );
  });

  test("distinguishes connection, installation, empty, and token failures", async () => {
    expect(
      await loadRepositoryDirectory(
        "user-1",
        dependencies({ hasGitHubAccount: mock(async () => false) }),
      ),
    ).toMatchObject({
      status: "github_not_connected",
      repositories: [],
      requestId: "request-1",
    });

    expect(
      await loadRepositoryDirectory(
        "user-1",
        dependencies({ getInstallations: mock(async () => []) }),
      ),
    ).toMatchObject({ status: "installation_required", repositories: [] });

    expect(
      await loadRepositoryDirectory(
        "user-1",
        dependencies({ getUserToken: mock(async () => null) }),
      ),
    ).toMatchObject({ status: "error", errorKind: "provider_unavailable" });

    expect(
      await loadRepositoryDirectory(
        "user-1",
        dependencies({ listInstallationRepositories: mock(async () => []) }),
      ),
    ).toMatchObject({ status: "empty", repositories: [] });
  });

  test("preserves usable repositories and labels a partial installation failure", async () => {
    const snapshot = await loadRepositoryDirectory(
      "user-1",
      dependencies({
        getInstallations: mock(async () => [
          { installationId: 1, accountLogin: "acme" },
          { installationId: 2, accountLogin: "other" },
        ]),
        listInstallationRepositories: mock(
          async ({ installationId }: { installationId: number }) => {
            if (installationId === 2) throw new Error("GitHub unavailable");
            return [repository("acme/widgets", "2026-07-11T00:00:00.000Z")];
          },
        ),
      }),
    );

    expect(snapshot).toMatchObject({
      status: "partial",
      failedInstallationCount: 1,
      installationCount: 2,
    });
    expect(snapshot.repositories.map((repo) => repo.fullName)).toEqual([
      "acme/widgets",
    ]);
  });

  test("reports error instead of empty when every installation fails", async () => {
    const snapshot = await loadRepositoryDirectory(
      "user-1",
      dependencies({
        getInstallations: mock(async () => [
          { installationId: 1, accountLogin: "acme" },
          { installationId: 2, accountLogin: "other" },
        ]),
        listInstallationRepositories: mock(async () => {
          throw new Error("provider down");
        }),
      }),
    );

    expect(snapshot).toMatchObject({
      status: "error",
      errorKind: "provider_unavailable",
      failedInstallationCount: 2,
      repositories: [],
    });
  });

  test("classifies invalid provider payloads without exposing raw provider details", async () => {
    const snapshot = await loadRepositoryDirectory(
      "user-1",
      dependencies({
        listInstallationRepositories: mock(async () => {
          throw new Error(
            "Invalid GitHub user installation repositories response: raw secret",
          );
        }),
      }),
    );

    expect(snapshot).toMatchObject({
      status: "error",
      errorKind: "provider_invalid_response",
      requestId: "request-1",
    });
    expect(JSON.stringify(snapshot)).not.toContain("raw secret");
  });

  test("turns installation bootstrap failures into a safe correlated error", async () => {
    const snapshot = await loadRepositoryDirectory(
      "user-1",
      dependencies({
        getInstallations: mock(async () => {
          throw new Error("database DSN and provider body must not escape");
        }),
      }),
    );

    expect(snapshot).toEqual({
      status: "error",
      repositories: [],
      installationCount: 0,
      failedInstallationCount: 0,
      errorKind: "provider_unavailable",
      requestId: "request-1",
    });
  });
});
