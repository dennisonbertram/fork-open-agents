import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrSummary, IssueSummary, ActionsSummary } from "./github-windows";
import {
  PullRequestsWindow,
  IssuesWindow,
  ActionsWindow,
} from "./github-windows";

// ---- PullRequestsWindow tests ---------------------------------------------

describe("PullRequestsWindow", () => {
  // BT-W-001: github_not_connected state
  test("BT-W-001: shows GitHub not connected message when errorKind is github_not_connected", () => {
    const summary: PrSummary = {
      ok: false,
      errorKind: "github_not_connected",
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Pull Requests");
    expect(html).toMatch(/not connected|not available|connect/i);
  });

  // BT-W-002: empty PRs state
  test("BT-W-002: shows empty state when there are no open pull requests", () => {
    const summary: PrSummary = {
      ok: true,
      prs: [],
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Pull Requests");
    expect(html).toMatch(/no open|no pull requests/i);
  });

  // BT-W-003: populated PRs
  test("BT-W-003: shows PR number, title, author, and draft label when PRs exist", () => {
    const summary: PrSummary = {
      ok: true,
      prs: [
        {
          number: 42,
          title: "feat: add telemetry",
          isDraft: true,
          author: "alice",
          baseBranch: "main",
          updatedAt: "2026-05-15T10:00:00Z",
          checksStatus: "failing",
          url: "https://github.com/acme/widgets/pull/42",
        },
        {
          number: 7,
          title: "fix: null pointer in dashboard",
          isDraft: false,
          author: "bob",
          baseBranch: "develop",
          updatedAt: "2026-06-01T08:00:00Z",
          checksStatus: "passing",
          url: "https://github.com/acme/widgets/pull/7",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("#42");
    expect(html).toContain("feat: add telemetry");
    expect(html).toContain("alice");
    expect(html).toContain("draft");
    expect(html).toContain("#7");
    expect(html).toContain("fix: null pointer in dashboard");
    expect(html).toContain("bob");
  });

  // BT-W-004: partial failure state
  test("BT-W-004: shows partial-failure message when errorKind is provider_unavailable", () => {
    const summary: PrSummary = {
      ok: false,
      errorKind: "provider_unavailable",
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Pull Requests");
    // Should show some error/unavailable messaging
    expect(html).toMatch(/unavailable|failed|error|could not load/i);
  });

  // BT-W-005: app_no_access state shows setup message
  test("BT-W-005: shows setup state when errorKind is app_no_access", () => {
    const summary: PrSummary = {
      ok: false,
      errorKind: "app_no_access",
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Pull Requests");
    expect(html).toMatch(/app|access|install|setup/i);
  });
});

// ---- IssuesWindow tests ---------------------------------------------------

describe("IssuesWindow", () => {
  // BT-W-006: github_not_connected
  test("BT-W-006: shows not connected message when GitHub is not connected", () => {
    const summary: IssueSummary = {
      ok: false,
      errorKind: "github_not_connected",
    };
    const html = renderToStaticMarkup(
      <IssuesWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Issues");
    expect(html).toMatch(/not connected|not available|connect/i);
  });

  // BT-W-007: empty issues
  test("BT-W-007: shows empty state when there are no open issues", () => {
    const summary: IssueSummary = {
      ok: true,
      totalOpen: 0,
      recent: [],
    };
    const html = renderToStaticMarkup(
      <IssuesWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Issues");
    expect(html).toMatch(/no open issues/i);
  });

  // BT-W-008: populated issues with count
  test("BT-W-008: shows totalOpen count and recent issue titles", () => {
    const summary: IssueSummary = {
      ok: true,
      totalOpen: 12,
      recent: [
        {
          number: 5,
          title: "Widget crashes on null input",
          labels: ["bug", "priority:high"],
          updatedAt: "2026-06-01T09:00:00Z",
          url: "https://github.com/acme/widgets/issues/5",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <IssuesWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Issues");
    expect(html).toContain("12");
    expect(html).toContain("#5");
    expect(html).toContain("Widget crashes on null input");
    expect(html).toContain("bug");
  });
});

// ---- ActionsWindow tests --------------------------------------------------

describe("ActionsWindow", () => {
  // BT-W-009: github_not_connected
  test("BT-W-009: shows not connected message when GitHub is not connected", () => {
    const summary: ActionsSummary = {
      ok: false,
      errorKind: "github_not_connected",
    };
    const html = renderToStaticMarkup(
      <ActionsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Actions");
    expect(html).toMatch(/not connected|not available|connect/i);
  });

  // BT-W-010: passing status
  test("BT-W-010: shows passing status when latest workflow run is passing", () => {
    const summary: ActionsSummary = {
      ok: true,
      latestStatus: "passing",
      recentRuns: [
        {
          name: "CI",
          conclusion: "success",
          status: "completed",
          runId: 1,
          createdAt: "2026-06-01T10:00:00Z",
          url: "https://github.com/acme/widgets/actions/runs/1",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ActionsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Actions");
    expect(html).toMatch(/passing|success|green/i);
    expect(html).toContain("CI");
  });

  // BT-W-011: failing status
  test("BT-W-011: shows failing status when latest workflow run is failing", () => {
    const summary: ActionsSummary = {
      ok: true,
      latestStatus: "failing",
      recentRuns: [
        {
          name: "Deploy",
          conclusion: "failure",
          status: "completed",
          runId: 2,
          createdAt: "2026-06-01T11:00:00Z",
          url: "https://github.com/acme/widgets/actions/runs/2",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ActionsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Actions");
    expect(html).toMatch(/failing|failure|failed/i);
    expect(html).toContain("Deploy");
  });

  // BT-W-012: no workflow runs
  test("BT-W-012: shows empty state when no workflow runs exist", () => {
    const summary: ActionsSummary = {
      ok: true,
      latestStatus: "passing",
      recentRuns: [],
    };
    const html = renderToStaticMarkup(
      <ActionsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Actions");
    expect(html).toMatch(/no runs|no workflow|no action/i);
  });

  // BT-W-013: partial failure state
  test("BT-W-013: shows partial-failure message when errorKind is provider_rate_limited", () => {
    const summary: ActionsSummary = {
      ok: false,
      errorKind: "provider_rate_limited",
    };
    const html = renderToStaticMarkup(
      <ActionsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    expect(html).toContain("Actions");
    expect(html).toMatch(/rate limit|unavailable|failed|could not load/i);
  });
});
