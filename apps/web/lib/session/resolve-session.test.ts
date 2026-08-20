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
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;
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

  test("refuses the test-auth cookie when VERCEL_ENV is production even if the flag is set", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    const session = await resolveSessionFromHeaders(
      headers({
        cookie: "open_agents_test_user_id=dev-managed-runtime-user",
      }),
    );

    expect(session).toBeUndefined();
    expect(getSessionCalls).toBe(1);
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

  test("delegates to Better Auth when authorization credentials are present", async () => {
    await resolveSessionFromHeaders(
      headers({ authorization: "Bearer session-token" }),
    );

    expect(getSessionCalls).toBe(1);
  });
});
