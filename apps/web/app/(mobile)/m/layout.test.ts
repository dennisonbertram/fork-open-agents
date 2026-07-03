/**
 * Tests for the mobile layout's unauthenticated redirect (#793).
 *
 * Protected path: "A signed-out user who opens a mobile deep link, signs in,
 * and is returned to that same mobile destination" — specifically `/m/*`
 * routes guarded by MobileLayout.
 *
 * Before this fix, an unauthenticated visit to any `/m/*` route redirected
 * unconditionally to `/`, dropping the requested path. This test proves the
 * redirect target now carries the original path as a `next` query param, and
 * that the well-known `x-invoke-path` header (set by proxy.ts for `/m/*`) is
 * how the layout learns the incoming path server-side.
 */

import { describe, expect, mock, test } from "bun:test";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});

mock.module("next/navigation", () => ({ redirect }));

let mockHeaderValue: string | null = "/m/chat/some-id";

mock.module("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-invoke-path" ? mockHeaderValue : null),
  }),
}));

let mockSession: { user: { id: string } } | null = null;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => mockSession,
}));

describe("MobileLayout unauthenticated redirect", () => {
  test("redirects to /?next=<encoded original path> when signed out", async () => {
    mockSession = null;
    mockHeaderValue = "/m/chat/some-id";
    const { default: MobileLayout } = await import("./layout");

    await expect(MobileLayout({ children: null })).rejects.toThrow(
      "redirect:/?next=%2Fm%2Fchat%2Fsome-id",
    );

    expect(redirect).toHaveBeenCalledWith("/?next=%2Fm%2Fchat%2Fsome-id");
  });

  test("preserves query params on the original mobile path", async () => {
    mockSession = null;
    mockHeaderValue = "/m/chat/some-id?foo=bar";
    const { default: MobileLayout } = await import("./layout");

    await expect(MobileLayout({ children: null })).rejects.toThrow();

    expect(redirect).toHaveBeenCalledWith(
      "/?next=%2Fm%2Fchat%2Fsome-id%3Ffoo%3Dbar",
    );
  });

  test("falls back to a bare / when the incoming path header is missing", async () => {
    mockSession = null;
    mockHeaderValue = null;
    const { default: MobileLayout } = await import("./layout");

    await expect(MobileLayout({ children: null })).rejects.toThrow(
      "redirect:/",
    );

    expect(redirect).toHaveBeenCalledWith("/");
  });

  test("renders children without redirecting when signed in", async () => {
    mockSession = { user: { id: "user-1" } };
    mockHeaderValue = "/m/chat/some-id";
    redirect.mockClear();
    const { default: MobileLayout } = await import("./layout");

    const result = await MobileLayout({ children: null });

    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
