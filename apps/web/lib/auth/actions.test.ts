import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const deletedCookies: Array<{ name: string; path: string }> = [];
let signedOut = false;
let redirectTo: string | null = null;

mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    delete: (cookie: { name: string; path: string }) => {
      deletedCookies.push(cookie);
    },
  }),
}));

mock.module("next/navigation", () => ({
  redirect: (url: string) => {
    redirectTo = url;
  },
}));

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      signOut: async () => {
        signedOut = true;
      },
    },
  },
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: { id: "dev-managed-runtime-user" },
  }),
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => null,
}));

const { signOut } = await import("./actions");

describe("signOut", () => {
  beforeEach(() => {
    deletedCookies.length = 0;
    signedOut = false;
    redirectTo = null;
  });

  test("clears the test-auth cookie before redirecting home", async () => {
    await signOut();

    expect(signedOut).toBe(true);
    expect(deletedCookies).toEqual([
      { name: "open_agents_test_user_id", path: "/" },
    ]);
    expect(redirectTo).toBe("/");
  });
});
