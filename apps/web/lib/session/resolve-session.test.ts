import { beforeEach, describe, expect, mock, test } from "bun:test";

let getSessionCalls = 0;
let authSession:
  | {
      session: { createdAt: Date };
      user: {
        id: string;
        name?: string | null;
        username?: string | null;
        email?: string | null;
        image?: string | null;
      };
    }
  | undefined;

let accountRows: { providerId: string }[] = [];

mock.module("server-only", () => ({}));

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      getSession: async () => {
        getSessionCalls++;
        return authSession;
      },
    },
  },
}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => accountRows,
          }),
        }),
      }),
    }),
  },
}));

const { resolveSessionFromHeaders } = await import("./resolve-session");

function headers(values: Record<string, string | undefined>) {
  const nextHeaders = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) {
      nextHeaders.set(name, value);
    }
  }
  return nextHeaders;
}

describe("resolveSessionFromHeaders", () => {
  beforeEach(() => {
    getSessionCalls = 0;
    authSession = undefined;
    accountRows = [];
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
  });

  test("skips Better Auth when no session credential headers are present", async () => {
    const session = await resolveSessionFromHeaders(headers({}));

    expect(session).toBeUndefined();
    expect(getSessionCalls).toBe(0);
  });

  test("uses test auth cookie before Better Auth", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";

    const session = await resolveSessionFromHeaders(
      headers({
        cookie: "open_agents_test_user_id=dev-managed-runtime-user",
      }),
    );

    expect(session?.user.id).toBe("dev-managed-runtime-user");
    expect(getSessionCalls).toBe(0);
  });

  test("delegates to Better Auth when cookie credentials are present", async () => {
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-1",
        username: "dennison",
        email: "person@example.com",
        image: "https://example.com/avatar.png",
      },
    };
    accountRows = [{ providerId: "vercel" }];

    const session = await resolveSessionFromHeaders(
      headers({ cookie: "better-auth.session_token=value" }),
    );

    expect(getSessionCalls).toBe(1);
    expect(session).toEqual({
      created: new Date("2026-01-01T00:00:00.000Z").getTime(),
      authProvider: "vercel",
      user: {
        id: "user-1",
        username: "dennison",
        email: "person@example.com",
        avatar: "https://example.com/avatar.png",
      },
    });
  });

  test("resolves authProvider to github for a GitHub-originated session", async () => {
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-2",
        username: "octocat",
        email: "octocat@example.com",
        image: "https://example.com/octocat.png",
      },
    };
    accountRows = [{ providerId: "github" }];

    const session = await resolveSessionFromHeaders(
      headers({ cookie: "better-auth.session_token=value" }),
    );

    expect(session?.authProvider).toBe("github");
  });

  test("falls back to undefined session when the account provider is unrecognized", async () => {
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-3",
        username: "mystery",
        email: "mystery@example.com",
        image: null,
      },
    };
    accountRows = [{ providerId: "email" }];

    const session = await resolveSessionFromHeaders(
      headers({ cookie: "better-auth.session_token=value" }),
    );

    expect(session).toBeUndefined();
  });

  test("delegates to Better Auth when authorization credentials are present", async () => {
    await resolveSessionFromHeaders(
      headers({ authorization: "Bearer session-token" }),
    );

    expect(getSessionCalls).toBe(1);
  });
});
