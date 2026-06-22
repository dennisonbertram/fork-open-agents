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
let requestedUserId: string | null = null;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/db/repository-sidebar-archives", () => ({
  archiveRepositoryInSidebar: async () => {
    throw new Error("archiveRepositoryInSidebar should not be called");
  },
  listRepositorySidebarArchives: async (userId: string) => {
    requestedUserId = userId;
    return [
      {
        id: "archive-1",
        userId,
        repoOwner: "dennisonbertram",
        repoName: "open-agents",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
  },
  unarchiveRepositoryInSidebar: async () => {
    throw new Error("unarchiveRepositoryInSidebar should not be called");
  },
}));

const routeModulePromise = import("./route");

describe("/api/settings/repositories/archive", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    requestedUserId = null;
  });

  test("GET lists repositories hidden from the sidebar", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      repositories: Array<{ repoOwner: string; repoName: string }>;
    };

    expect(response.status).toBe(200);
    expect(requestedUserId).toBe("user-1");
    expect(body.repositories).toEqual([
      {
        repoOwner: "dennisonbertram",
        repoName: "open-agents",
      },
    ]);
  });

  test("GET requires authentication", async () => {
    const { GET } = await routeModulePromise;
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };

    const response = await GET();

    expect(response.status).toBe(401);
    expect(requestedUserId).toBeNull();
  });
});
