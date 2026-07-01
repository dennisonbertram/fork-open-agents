import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// listAppInstallationRepositories mints an installation-scoped READ token via
// @octokit/auth-app (type: "installation") — never the write-scoped token
// used for commits/PRs. Stub the JWT/installation-token minting so we can
// drive the fetch layer directly, mirroring app.test.ts's pattern.
mock.module("@octokit/auth-app", () => ({
  createAppAuth: (_config: { appId: number; privateKey: string }) => {
    return async (params: { type: string; installationId?: number }) => {
      expect(params.type).toBe("installation");
      return { token: "fake-installation-read-token" };
    };
  },
}));

process.env.GITHUB_APP_ID = "12345";
process.env.GITHUB_APP_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----";

const { listAppInstallationRepositories } = await import("./repos");

const originalFetch = globalThis.fetch;

function createRepo(id: number, name: string, isPrivate = false) {
  return {
    id,
    name,
    full_name: `acme/${name}`,
    private: isPrivate,
  };
}

function createPage(repos: ReturnType<typeof createRepo>[], page: number) {
  return [
    ...repos,
    ...Array.from({ length: 50 - repos.length }, (_, index) =>
      createRepo(10_000 + page * 100 + index, `filler-${page}-${index}`),
    ),
  ];
}

describe("listAppInstallationRepositories", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns numeric ids for repos accessible to the installation", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/installation/repositories");
      return Response.json({
        repositories: [createRepo(11, "alpha"), createRepo(12, "beta", true)],
      });
    }) as unknown as typeof fetch;

    const repos = await listAppInstallationRepositories({
      installationId: 42,
    });

    expect(repos).toEqual([
      { id: 11, name: "alpha", full_name: "acme/alpha", private: false },
      { id: 12, name: "beta", full_name: "acme/beta", private: true },
    ]);
  });

  test("authenticates with the installation-scoped read token, not a raw app JWT", async () => {
    const captured: { auth: string | null | undefined } = { auth: null };
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init) => {
      captured.auth = (
        init?.headers as Record<string, string> | undefined
      )?.Authorization;
      return Response.json({ repositories: [] });
    }) as unknown as typeof fetch;

    await listAppInstallationRepositories({ installationId: 42 });

    expect(captured.auth).toBe("Bearer fake-installation-read-token");
  });

  test("filters results by query (case-insensitive, substring match)", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        repositories: [createRepo(1, "docs"), createRepo(2, "frontend")],
      }),
    ) as unknown as typeof fetch;

    const repos = await listAppInstallationRepositories({
      installationId: 42,
      query: "DOC",
    });

    expect(repos.map((repo) => repo.name)).toEqual(["docs"]);
  });

  test("caps results at the requested limit", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        repositories: [
          createRepo(1, "a"),
          createRepo(2, "b"),
          createRepo(3, "c"),
        ],
      }),
    ) as unknown as typeof fetch;

    const repos = await listAppInstallationRepositories({
      installationId: 42,
      limit: 2,
    });

    expect(repos).toHaveLength(2);
  });

  test("stops paging once a page returns fewer repos than a full page", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const page = url.searchParams.get("page");

      if (page === "1") {
        return Response.json({
          repositories: createPage([createRepo(1, "alpha")], 1),
        });
      }

      return Response.json({
        repositories: [createRepo(999, "omega")],
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const repos = await listAppInstallationRepositories({
      installationId: 42,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 pages + 1 revoke
    expect(repos.some((repo) => repo.name === "omega")).toBe(true);
  });

  test("regression: enumeration issues only GET (repos) + DELETE (revoke) requests and never touches the write-mint access_tokens endpoint", async () => {
    const requests: { url: string; method: string | undefined }[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init) => {
      requests.push({ url: input.toString(), method: init?.method });
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return Response.json({
        repositories: [createRepo(1, "alpha")],
      });
    }) as unknown as typeof fetch;

    await listAppInstallationRepositories({ installationId: 42 });

    expect(requests).toHaveLength(2);
    expect(
      requests[0]?.method === undefined || requests[0]?.method === "GET",
    ).toBe(true);
    expect(requests[0]?.url).toContain("/installation/repositories");
    expect(requests.every((r) => !r.url.includes("access_tokens"))).toBe(true);
  });

  test("revokes the installation-scoped read token after enumeration succeeds, since it is not API-restricted to read-only and should not outlive the request", async () => {
    const revokeCalls: { url: string; auth: string | null | undefined }[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init) => {
      const url = input.toString();
      if (init?.method === "DELETE") {
        revokeCalls.push({
          url,
          auth: (init?.headers as Record<string, string> | undefined)
            ?.Authorization,
        });
        return new Response(null, { status: 204 });
      }
      return Response.json({
        repositories: [createRepo(1, "alpha")],
      });
    }) as unknown as typeof fetch;

    await listAppInstallationRepositories({ installationId: 42 });

    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0]?.url).toBe(
      "https://api.github.com/installation/token",
    );
    expect(revokeCalls[0]?.auth).toBe("Bearer fake-installation-read-token");
  });

  test("revokes the installation-scoped read token even when enumeration fails", async () => {
    const revokeCalls: string[] = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init) => {
      if (init?.method === "DELETE") {
        revokeCalls.push("revoked");
        return new Response(null, { status: 204 });
      }
      return new Response("installation suspended", { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      listAppInstallationRepositories({ installationId: 42 }),
    ).rejects.toThrow(/403/);

    expect(revokeCalls).toHaveLength(1);
  });

  test("regression: a non-ok GitHub response is surfaced as a thrown error, not swallowed as an empty list", async () => {
    globalThis.fetch = mock(
      async () => new Response("installation suspended", { status: 403 }),
    ) as unknown as typeof fetch;

    await expect(
      listAppInstallationRepositories({ installationId: 42 }),
    ).rejects.toThrow(/403/);
  });
});
