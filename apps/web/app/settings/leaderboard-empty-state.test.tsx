import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardEmptyState } from "./leaderboard-empty-state";

describe("LeaderboardEmptyState", () => {
  test("no-domain explains work-email grouping with no misleading CTA", () => {
    const html = renderToStaticMarkup(
      <LeaderboardEmptyState reason="no-domain" />,
    );
    expect(html).toContain("No leaderboard yet");
    expect(html).toContain("work email domain");
    expect(html).not.toContain("teammates run agents");
  });

  test("no-data gives an encouraging first-run message", () => {
    const html = renderToStaticMarkup(
      <LeaderboardEmptyState reason="no-data" />,
    );
    expect(html).toContain("No leaderboard yet");
    expect(html).toContain("teammates run agents");
    expect(html).not.toContain("Sign in with your work account");
  });
});
