import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileRank } from "./profile-rank";

describe("ProfileRank", () => {
  test("renders a skeleton while loading", () => {
    const html = renderToStaticMarkup(
      <ProfileRank rank={null} loading={true} />,
    );
    expect(html).toContain("animate-pulse");
  });

  test("renders nothing when the user has no eligible domain", () => {
    const html = renderToStaticMarkup(
      <ProfileRank rank={null} loading={false} />,
    );
    expect(html).toBe("");
  });

  test("renders a real, leaderboard-linked rank when eligible", () => {
    const html = renderToStaticMarkup(
      <ProfileRank
        rank={{ rank: 3, total: 10, domain: "vercel.com" }}
        loading={false}
      />,
    );
    expect(html).toContain("#3 of 10");
    expect(html).toContain("vercel.com");
    expect(html).toContain('href="/settings/leaderboard"');
  });

  test("never fabricates a #1 standing", () => {
    const html = renderToStaticMarkup(
      <ProfileRank
        rank={{ rank: 7, total: 12, domain: "withtally.com" }}
        loading={false}
      />,
    );
    expect(html).not.toContain("#1 in Vercel");
    expect(html).toContain("#7 of 12");
    expect(html).toContain("withtally.com");
  });
});
