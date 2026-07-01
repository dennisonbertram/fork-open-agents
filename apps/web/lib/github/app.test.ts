import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// The real mintInstallationToken/withScopedInstallationOctokit call chain
// mints a GitHub App JWT via @octokit/auth-app before hitting the GitHub
// REST API. Stub that JWT minting so we can drive the fetch layer directly.
mock.module("@octokit/auth-app", () => ({
  createAppAuth: (_config: { appId: number; privateKey: string }) => {
    return async (_params: { type: string }) => ({ token: "fake-app-jwt" });
  },
}));

process.env.GITHUB_APP_ID = "12345";
process.env.GITHUB_APP_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----";

const { mintInstallationToken, withScopedInstallationOctokit } =
  await import("./app");

const originalFetch = globalThis.fetch;

type CapturedFetchCall = {
  url: string;
  body: Record<string, unknown> | undefined;
};

function stubMintTokenFetch(options?: { status?: number; body?: unknown }) {
  const calls: CapturedFetchCall[] = [];
  const responseBody = options?.body ?? {
    token: "scoped-token",
    expires_at: "2099-01-01T00:00:00Z",
  };
  const status = options?.status ?? 200;

  globalThis.fetch = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        body: init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status });
    },
  ) as unknown as typeof fetch;

  return calls;
}

describe("mintInstallationToken", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("mints a token scoped to multiple repositoryIds and echoes them back", async () => {
    const calls = stubMintTokenFetch();

    const result = await mintInstallationToken({
      installationId: 1,
      repositoryIds: [42, 43],
      permissions: { contents: "write" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body?.repository_ids).toEqual([42, 43]);
    expect(result.repositoryIds).toEqual([42, 43]);
    expect(result.token).toBe("scoped-token");
    expect(result.installationId).toBe(1);
  });

  test("rejects an empty repositoryIds array (never mints an unbounded token)", async () => {
    stubMintTokenFetch();

    await expect(
      mintInstallationToken({
        installationId: 1,
        repositoryIds: [],
        permissions: { contents: "write" },
      }),
    ).rejects.toThrow(/at least one repo/i);
  });

  test("single-element repositoryIds still mints successfully (backward compatible)", async () => {
    const calls = stubMintTokenFetch();

    const result = await mintInstallationToken({
      installationId: 7,
      repositoryIds: [42],
      permissions: { contents: "read" },
    });

    expect(calls[0]?.body?.repository_ids).toEqual([42]);
    expect(result.repositoryIds).toEqual([42]);
  });
});

describe("withScopedInstallationOctokit", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("threads a multi-repo repositoryIds list through to the minted token", async () => {
    const calls = stubMintTokenFetch();

    const result = await withScopedInstallationOctokit({
      installationId: 1,
      repositoryIds: [42, 43],
      permissions: { contents: "write" },
      operation: async () => "operation-result",
    });

    expect(result).toBe("operation-result");
    expect(calls[0]?.body?.repository_ids).toEqual([42, 43]);
  });

  test("still accepts a single repositoryId (backward compatible with existing callers)", async () => {
    const calls = stubMintTokenFetch();

    const result = await withScopedInstallationOctokit({
      installationId: 1,
      repositoryId: 99,
      permissions: { contents: "read" },
      operation: async () => "single-repo-result",
    });

    expect(result).toBe("single-repo-result");
    expect(calls[0]?.body?.repository_ids).toEqual([99]);
  });
});
