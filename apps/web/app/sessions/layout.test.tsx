/**
 * Tests for the onboarding gate on the sessions layout (#780).
 *
 * Protected path: "First sign-in -> guided setup." A signed-in user who
 * still needs onboarding must never see the session shell; they are
 * redirected to /get-started?next=<path> before any shell UI renders.
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

mock.module("@/lib/db/last-repo", () => ({
  getLastRepoByUserId: async () => null,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionsWithUnreadByUserId: async () => [],
  getArchivedSessionCountByUserId: async () => 0,
}));

mock.module("./sessions-route-shell", () => ({
  SessionsRouteShell: () => null,
}));

let mockNeedsOnboarding = async (_userId: string) => false;

mock.module("@/lib/onboarding", () => ({
  needsOnboarding: (userId: string) => mockNeedsOnboarding(userId),
}));

describe("SessionsLayout onboarding gate", () => {
  test("redirects to /get-started?next=/sessions when needsOnboarding is true", async () => {
    mockNeedsOnboarding = async () => true;
    const { default: SessionsLayout } = await import("./layout");

    await expect(
      SessionsLayout({ children: null }),
    ).rejects.toThrow("redirect:/get-started?next=%2Fsessions");

    expect(redirect).toHaveBeenCalledWith("/get-started?next=%2Fsessions");
  });

  test("renders the session shell without an extra redirect when onboarded", async () => {
    mockNeedsOnboarding = async () => false;
    redirect.mockClear();
    const { default: SessionsLayout } = await import("./layout");

    const result = await SessionsLayout({ children: null });

    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
