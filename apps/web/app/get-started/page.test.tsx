/**
 * Loop-freedom tests for /get-started (#780).
 *
 * Protected path: an already-onboarded user hitting /get-started (no
 * step=github) must redirect to /sessions (or the requested `next`) and
 * that redirect must not bounce back to /get-started, since both this page
 * and the sessions layout guard rely on the same needsOnboarding() check.
 */

import { describe, expect, mock, test } from "bun:test";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: { id: "user-1" },
  }),
}));

let mockNeedsOnboarding = async (_userId: string) => false;

mock.module("@/lib/onboarding", () => ({
  needsOnboarding: (userId: string) => mockNeedsOnboarding(userId),
}));

mock.module("./get-started-flow", () => ({
  GetStartedFlow: () => null,
}));

describe("GetStartedPage loop-freedom", () => {
  test("already-onboarded user with no next param redirects to /sessions", async () => {
    mockNeedsOnboarding = async () => false;
    redirect.mockClear();
    const { default: GetStartedPage } = await import("./page");

    await expect(
      GetStartedPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/sessions");

    expect(redirect).toHaveBeenCalledWith("/sessions");
  });

  test("already-onboarded user with next=/sessions/abc redirects there, not to /get-started", async () => {
    mockNeedsOnboarding = async () => false;
    redirect.mockClear();
    const { default: GetStartedPage } = await import("./page");

    await expect(
      GetStartedPage({
        searchParams: Promise.resolve({ next: "/sessions/abc" }),
      }),
    ).rejects.toThrow("redirect:/sessions/abc");

    expect(redirect).toHaveBeenCalledWith("/sessions/abc");
    expect(redirect).not.toHaveBeenCalledWith(
      expect.stringContaining("/get-started"),
    );
  });

  test.each(["https://evil.example/x", "//evil.example/x", "\\evil.example/x"])(
    "sanitizes hostile next %s to Sessions",
    async (next) => {
      mockNeedsOnboarding = async () => false;
      redirect.mockClear();
      const { default: GetStartedPage } = await import("./page");
      await expect(
        GetStartedPage({ searchParams: Promise.resolve({ next }) }),
      ).rejects.toThrow("redirect:/sessions");
    },
  );

  test("sanitizes array next values to Sessions", async () => {
    mockNeedsOnboarding = async () => false;
    redirect.mockClear();
    const { default: GetStartedPage } = await import("./page");
    await expect(
      GetStartedPage({ searchParams: Promise.resolve({ next: ["/runs", "//evil"] }) }),
    ).rejects.toThrow("redirect:/sessions");
  });

  test("needs-onboarding user renders GetStartedFlow without redirecting", async () => {
    mockNeedsOnboarding = async () => true;
    redirect.mockClear();
    const { default: GetStartedPage } = await import("./page");

    const result = await GetStartedPage({
      searchParams: Promise.resolve({}),
    });

    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
