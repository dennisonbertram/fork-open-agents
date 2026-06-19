import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const zeroInsights = {
  lookbackDays: 280,
  pr: {
    trackedPrCount: 0,
    sessionsWithPrCount: 0,
    openPrCount: 0,
    mergedPrCount: 0,
    closedPrCount: 0,
    mergeRate: 0,
  },
  efficiency: {
    mainAssistantTurnCount: 0,
    averageTokensPerMainTurn: 0,
    largestMainTurnTokens: 0,
    toolCallsPerMainTurn: 0,
    cacheReadRatio: 0,
  },
  code: {
    linesAdded: 0,
    linesRemoved: 0,
    totalLinesChanged: 0,
  },
  topRepositories: [],
};

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: {
      user: {
        id: "user_1",
        username: "dennison",
        name: "Dennison Bertram",
        email: "dennison@example.com",
        avatar: null,
      },
    },
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    hasGitHub: true,
    hasGitHubAccount: true,
    hasGitHubInstallations: true,
  }),
}));

mock.module("@/hooks/use-leaderboard-rank", () => ({
  useLeaderboardRank: () => ({
    rank: null,
    loading: false,
  }),
}));

mock.module("swr", () => ({
  default: (key: string | null) => {
    if (key === "/api/usage") {
      return {
        data: {
          usage: [],
          insights: zeroInsights,
          domainLeaderboard: null,
        },
        isLoading: false,
        error: null,
      };
    }

    if (key === "/api/models") {
      return {
        data: {
          models: [],
        },
        isLoading: false,
        error: null,
      };
    }

    return {
      data: undefined,
      isLoading: false,
      error: null,
    };
  },
}));

describe("ProfilePage empty usage state", () => {
  test("puts identity first and explains that there is no agent activity yet", async () => {
    const { default: ProfilePage } = await import("./page");
    const html = renderToStaticMarkup(<ProfilePage />);

    expect(html).toContain("Your profile information is synced from Vercel");
    expect(html).toContain("Username");
    expect(html).toContain("Email");
    expect(html).toContain("Name");
    expect(html).toContain("No agent activity yet");
    expect(html).toContain("start a chat to see usage");
    expect(html).toContain("last ~9 months of daily activity");
    expect(html).not.toContain("#1 in Vercel");
  });
});
