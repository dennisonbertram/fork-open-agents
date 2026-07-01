import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AppInstallationRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
};

const listAppInstallationRepositories = mock(
  async (): Promise<AppInstallationRepository[]> => [],
);

mock.module("@/lib/github/repos", () => ({
  listAppInstallationRepositories,
}));

const { resolveWriteScopeRepositoryIds } = await import("./write-scope");

function repo(id: number, fullName: string): AppInstallationRepository {
  const [, name] = fullName.split("/");
  return { id, name: name ?? fullName, full_name: fullName, private: false };
}

beforeEach(() => {
  listAppInstallationRepositories.mockClear();
  listAppInstallationRepositories.mockImplementation(async () => []);
});

describe("resolveWriteScopeRepositoryIds", () => {
  test("this_repo (default) resolves to just the home repo, without enumerating the installation", async () => {
    const result = await resolveWriteScopeRepositoryIds({
      github: undefined,
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "selected",
    });

    expect(result).toEqual({ ok: true, repositoryIds: [42] });
    expect(listAppInstallationRepositories).not.toHaveBeenCalled();
  });

  test("explicit this_repo mode behaves identically to absent mode", async () => {
    const result = await resolveWriteScopeRepositoryIds({
      github: { writeScopeMode: "this_repo" },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "all",
    });

    expect(result).toEqual({ ok: true, repositoryIds: [42] });
    expect(listAppInstallationRepositories).not.toHaveBeenCalled();
  });

  test("all_repos with repositorySelection 'all' resolves to a sorted, deduped union of every accessible repo plus the home repo", async () => {
    listAppInstallationRepositories.mockImplementation(async () => [
      repo(43, "acme/beta"),
      repo(42, "acme/widgets"), // same id as home repo — must be deduped
      repo(7, "acme/alpha"),
    ]);

    const result = await resolveWriteScopeRepositoryIds({
      github: { writeScopeMode: "all_repos" },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "all",
    });

    expect(result).toEqual({ ok: true, repositoryIds: [7, 42, 43] });
  });

  test("all_repos with repositorySelection 'selected' is denied with a typed error and never enumerates or mints", async () => {
    const result = await resolveWriteScopeRepositoryIds({
      github: { writeScopeMode: "all_repos" },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "selected",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      errorKind: "write_scope_denied",
    });
    // The gate must be checked BEFORE any enumeration call — an installation
    // that has been narrowed to "selected" must never even list its repos
    // for a broader-than-authorized request.
    expect(listAppInstallationRepositories).not.toHaveBeenCalled();
  });

  test("repo_list resolves each requested full_name against the installation's accessible repos, unioned with home", async () => {
    listAppInstallationRepositories.mockImplementation(async () => [
      repo(43, "acme/beta"),
      repo(44, "acme/gamma"),
    ]);

    const result = await resolveWriteScopeRepositoryIds({
      github: {
        writeScopeMode: "repo_list",
        writeScopeRepos: ["acme/beta"],
      },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "selected",
    });

    expect(result).toEqual({ ok: true, repositoryIds: [42, 43] });
  });

  test("repo_list denies the whole request when any requested repo is not accessible to the installation", async () => {
    listAppInstallationRepositories.mockImplementation(async () => [
      repo(43, "acme/beta"),
    ]);

    const result = await resolveWriteScopeRepositoryIds({
      github: {
        writeScopeMode: "repo_list",
        writeScopeRepos: ["acme/beta", "acme/not-accessible"],
      },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "all",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      errorKind: "write_scope_denied",
    });
  });

  test("regression: repo_list with no writeScopeRepos still returns a non-empty list scoped to just the home repo", async () => {
    const result = await resolveWriteScopeRepositoryIds({
      github: { writeScopeMode: "repo_list", writeScopeRepos: [] },
      homeRepositoryId: 42,
      installationId: 99,
      repositorySelection: "all",
    });

    expect(result).toEqual({ ok: true, repositoryIds: [42] });
  });

  test("regression: the resolver never returns an ok result with an empty repositoryIds array, across every mode", async () => {
    const modes: Array<{
      github: Parameters<typeof resolveWriteScopeRepositoryIds>[0]["github"];
      repositorySelection: "all" | "selected";
    }> = [
      { github: undefined, repositorySelection: "selected" },
      { github: { writeScopeMode: "this_repo" }, repositorySelection: "all" },
      {
        github: { writeScopeMode: "all_repos" },
        repositorySelection: "all",
      },
      {
        github: { writeScopeMode: "repo_list", writeScopeRepos: [] },
        repositorySelection: "all",
      },
    ];

    for (const { github, repositorySelection } of modes) {
      listAppInstallationRepositories.mockImplementation(async () => []);
      const result = await resolveWriteScopeRepositoryIds({
        github,
        homeRepositoryId: 42,
        installationId: 99,
        repositorySelection,
      });
      if (result.ok) {
        expect(result.repositoryIds.length).toBeGreaterThan(0);
        expect(result.repositoryIds).toContain(42);
      }
    }
  });
});
