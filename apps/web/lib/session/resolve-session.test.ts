import { beforeEach, describe, expect, mock, test } from "bun:test";

let getSessionCalls = 0;
let linkedAccounts: Array<{ providerId: string }> = [];
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

mock.module("server-only", () => ({}));

const accountQuery = {
  from: () => accountQuery,
  where: () => accountQuery,
  orderBy: () => accountQuery,
  limit: async () => linkedAccounts,
};

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => accountQuery,
  },
}));

mock.module("@/lib/db/schema", () => ({
  accounts: {
    userId: "userId",
    providerId: "providerId",
    updatedAt: "updatedAt",
  },
}));

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
    linkedAccounts = [];
    authSession = undefined;
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

  test("resolves a Vercel-authenticated session as vercel", async () => {
    linkedAccounts = [{ providerId: "vercel" }];
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-1",
        username: "dennison",
        email: "person@example.com",
        image: "https://example.com/avatar.png",
      },
    };

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

  test("resolves a GitHub-authenticated session as github", async () => {
    linkedAccounts = [{ providerId: "github" }];
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-1",
        name: "GitHub User",
      },
    };

    const session = await resolveSessionFromHeaders(
      headers({ cookie: "better-auth.session_token=value" }),
    );

    expect(session?.authProvider).toBe("github");
  });

  test("keeps the Vercel provider when the linked account is unavailable", async () => {
    authSession = {
      session: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      user: {
        id: "user-1",
        name: "Unknown User",
      },
    };

    const session = await resolveSessionFromHeaders(
      headers({ cookie: "better-auth.session_token=value" }),
    );

    expect(session?.authProvider).toBe("vercel");
  });

  test("delegates to Better Auth when authorization credentials are present", async () => {
    await resolveSessionFromHeaders(
      headers({ authorization: "Bearer session-token" }),
    );

    expect(getSessionCalls).toBe(1);
  });
});
