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
let archiveCalls: Array<{
  userId: string;
  repoOwner: string;
  repoName: string;
}> = [];
let unarchiveCalls: Array<{
  userId: string;
  repoOwner: string;
  repoName: string;
}> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/db/repository-sidebar-archives", () => ({
  archiveRepositoryInSidebar: async (input: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }) => {
    archiveCalls.push(input);
    return {
      id: "archive-1",
      userId: input.userId,
      repoOwner: input.repoOwner.toLowerCase(),
      repoName: input.repoName.toLowerCase(),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  },
  unarchiveRepositoryInSidebar: async (input: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }) => {
    unarchiveCalls.push(input);
    return true;
  },
}));

const routeModulePromise = import("./route");

function context(repoOwner = "DennisonBertram", repoName = "Open-Agents") {
  return {
    params: Promise.resolve({ repoOwner, repoName }),
  };
}

describe("/api/settings/repositories/[repoOwner]/[repoName]/archive", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    archiveCalls = [];
    unarchiveCalls = [];
  });

  test("PUT archives a repository in the sidebar without deleting settings", async () => {
    const { PUT } = await routeModulePromise;

    const response = await PUT(new Request("http://localhost"), context());
    const body = (await response.json()) as {
      archived: boolean;
      repoOwner: string;
      repoName: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      archived: true,
      repoOwner: "dennisonbertram",
      repoName: "open-agents",
    });
    expect(archiveCalls).toEqual([
      {
        userId: "user-1",
        repoOwner: "DennisonBertram",
        repoName: "Open-Agents",
      },
    ]);
  });

  test("DELETE restores a repository to the sidebar", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(new Request("http://localhost"), context());
    const body = (await response.json()) as {
      archived: boolean;
      repoOwner: string;
      repoName: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      archived: false,
      repoOwner: "DennisonBertram",
      repoName: "Open-Agents",
    });
    expect(unarchiveCalls).toEqual([
      {
        userId: "user-1",
        repoOwner: "DennisonBertram",
        repoName: "Open-Agents",
      },
    ]);
  });

  test("PUT rejects invalid route params", async () => {
    const { PUT } = await routeModulePromise;

    const response = await PUT(
      new Request("http://localhost"),
      context("", "Open-Agents"),
    );

    expect(response.status).toBe(400);
  });
});
