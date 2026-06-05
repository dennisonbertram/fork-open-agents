/**
 * Failing tests for #162 review blockers in page.tsx:
 * - BLOCKER 1: page.tsx has same coupling issue — a throw in listRepoBackgroundAgents
 *   breaks the whole server component render.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let sessionUserId: string | null = "user-1";
let agentsError: Error | null = null;
let runsError: Error | null = null;

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents: async () => {
    if (agentsError) throw agentsError;
    return [];
  },
  listBackgroundAgentRuns: async () => {
    if (runsError) throw runsError;
    return [];
  },
}));

mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async () => ({
    prSummary: {
      ok: true,
      prs: [
        {
          number: 3,
          title: "Important PR",
          isDraft: false,
          author: "alice",
          baseBranch: "main",
          updatedAt: new Date().toISOString(),
          checksStatus: "passing",
          url: "https://github.com/acme/widgets/pull/3",
        },
      ],
    },
    issueSummary: { ok: true, totalOpen: 5, recent: [] },
    actionsSummary: { ok: true, latestStatus: "passing", recentRuns: [] },
  }),
}));

const pageModulePromise = import("./page");

describe("Page review-fix: BLOCKER 1 — partial-failure isolation in server component", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    agentsError = null;
    runsError = null;
    redirect.mockClear();
  });

  // BLOCKER1-PAGE-A: when listRepoBackgroundAgents throws, page must still render
  // GitHub windows — it must NOT throw and break the entire page.
  test("BLOCKER1-PAGE-A: page still renders GitHub windows when listRepoBackgroundAgents throws", async () => {
    agentsError = new Error("DB offline");

    const { default: RepoDashboardPage } = await pageModulePromise;

    // Currently page.tsx uses Promise.all — this will throw, breaking the render
    // After fix, it should catch the error and render a safe fallback
    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // GitHub windows must still appear
    expect(html).toContain("Pull Requests");
    expect(html).toContain("Important PR");
    expect(html).toContain("Issues");
    expect(html).toContain("Actions");
  });

  // BLOCKER1-PAGE-B: when listBackgroundAgentRuns throws, page still renders
  test("BLOCKER1-PAGE-B: page still renders when listBackgroundAgentRuns throws", async () => {
    runsError = new Error("Runs DB connection refused");

    const { default: RepoDashboardPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await RepoDashboardPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // GitHub windows still render
    expect(html).toContain("Pull Requests");
    expect(html).toContain("Important PR");
  });
});
