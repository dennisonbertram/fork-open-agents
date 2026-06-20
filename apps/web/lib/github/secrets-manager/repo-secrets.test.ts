import { describe, expect, mock, test } from "bun:test";
import type { Octokit } from "@octokit/rest";

mock.module("server-only", () => ({}));

describe("listRepoSecrets", () => {
  test("paginates repository secrets and returns metadata only", async () => {
    const { listRepoSecrets } = await import("./repo-secrets");
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `TOKEN_${index}`,
      created_at: "2026-06-19T10:00:00Z",
      updated_at: "2026-06-19T10:05:00Z",
    }));
    const request = mock(async (_route: string, params: { page?: number }) => ({
      data:
        params.page === 1
          ? { total_count: 101, secrets: firstPage }
          : {
              total_count: 101,
              secrets: [
                {
                  name: "FINAL_TOKEN",
                  created_at: "2026-06-19T11:00:00Z",
                  updated_at: "2026-06-19T11:05:00Z",
                },
              ],
            },
    }));
    const octokit = { request } as unknown as Octokit;

    const secrets = await listRepoSecrets(octokit, "acme", "widgets");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "GET /repos/{owner}/{repo}/actions/secrets",
      {
        owner: "acme",
        repo: "widgets",
        page: 1,
        per_page: 100,
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "GET /repos/{owner}/{repo}/actions/secrets",
      {
        owner: "acme",
        repo: "widgets",
        page: 2,
        per_page: 100,
      },
    );
    expect(secrets).toHaveLength(101);
    expect(secrets.at(-1)).toEqual({
      name: "FINAL_TOKEN",
      createdAt: "2026-06-19T11:00:00Z",
      updatedAt: "2026-06-19T11:05:00Z",
    });
    expect(JSON.stringify(secrets)).not.toContain("value");
  });
});
