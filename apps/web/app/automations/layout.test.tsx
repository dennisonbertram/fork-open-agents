import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});
const getLastRepoByUserId = mock(async () => ({
  owner: "acme",
  repo: "widgets",
}));
const getSessionsWithUnreadByUserId = mock(async () => [{ id: "session-1" }]);
const getArchivedSessionCountByUserId = mock(async () => 3);
let serverSession: { user: { id: string; name: string } } | null = {
  user: { id: "user-1", name: "Ada" },
};

mock.module("next/navigation", () => ({ redirect }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => serverSession,
}));
mock.module("@/lib/db/last-repo", () => ({ getLastRepoByUserId }));
mock.module("@/lib/db/sessions", () => ({
  getSessionsWithUnreadByUserId,
  getArchivedSessionCountByUserId,
}));
function SessionsRouteShell() {
  return null;
}
mock.module("@/app/sessions/sessions-route-shell", () => ({
  SessionsRouteShell,
}));

const layoutModulePromise = import("./layout");

describe("Automations layout", () => {
  beforeEach(() => {
    serverSession = { user: { id: "user-1", name: "Ada" } };
    redirect.mockClear();
    getLastRepoByUserId.mockClear();
    getSessionsWithUnreadByUserId.mockClear();
    getArchivedSessionCountByUserId.mockClear();
  });

  test("redirects signed-out users before querying workspace shell data", async () => {
    serverSession = null;
    const { default: AutomationsLayout } = await layoutModulePromise;

    await expect(AutomationsLayout({ children: "protected" })).rejects.toThrow(
      "redirect:/",
    );

    expect(getLastRepoByUserId).not.toHaveBeenCalled();
    expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
    expect(getArchivedSessionCountByUserId).not.toHaveBeenCalled();
  });

  test("renders inside the shared Sessions route shell with owner-scoped data", async () => {
    const { default: AutomationsLayout } = await layoutModulePromise;

    const result = (await AutomationsLayout({
      children: "automation-content",
    })) as ReactElement<{
      currentUser: { id: string };
      initialSessionsData: { sessions: unknown[]; archivedCount: number };
      lastRepo: { owner: string; repo: string } | null;
      children: string;
    }>;

    expect(result.type).toBe(SessionsRouteShell);
    expect(getLastRepoByUserId).toHaveBeenCalledWith("user-1");
    expect(getSessionsWithUnreadByUserId).toHaveBeenCalledWith("user-1", {
      status: "active",
    });
    expect(getArchivedSessionCountByUserId).toHaveBeenCalledWith("user-1");
    expect(result.props).toMatchObject({
      currentUser: { id: "user-1" },
      initialSessionsData: { archivedCount: 3 },
      lastRepo: { owner: "acme", repo: "widgets" },
      children: "automation-content",
    });
  });
});
