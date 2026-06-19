import { describe, expect, test } from "bun:test";
import {
  actionsSummaryStat,
  issuesSummaryStat,
  prSummaryStat,
} from "./dashboard-card-stats";
import type {
  ActionsSummary,
  IssueSummary,
  PrItem,
  PrSummary,
} from "@/lib/github/repo-dashboard";

function pr(overrides: Partial<PrItem>): PrItem {
  return {
    number: 1,
    title: "A PR",
    isDraft: false,
    author: "octocat",
    baseBranch: "main",
    updatedAt: "2026-06-01T00:00:00Z",
    checksStatus: "passing",
    url: "https://example.test/pr/1",
    ...overrides,
  };
}

describe("prSummaryStat", () => {
  test("summarizes open, draft, and failing counts", () => {
    const summary: PrSummary = {
      ok: true,
      prs: [
        pr({ number: 1 }),
        pr({ number: 2, isDraft: true }),
        pr({ number: 3, checksStatus: "failing" }),
      ],
    };
    expect(prSummaryStat(summary)).toBe("3 open · 1 draft · 1 failing");
  });

  test("omits draft/failing when zero", () => {
    const summary: PrSummary = { ok: true, prs: [pr({ number: 1 })] };
    expect(prSummaryStat(summary)).toBe("1 open");
  });

  test("reports none open when empty", () => {
    expect(prSummaryStat({ ok: true, prs: [] })).toBe("None open");
  });

  test("returns null on error", () => {
    expect(
      prSummaryStat({ ok: false, errorKind: "provider_unavailable" }),
    ).toBeNull();
  });
});

describe("issuesSummaryStat", () => {
  test("reports open count", () => {
    const summary: IssueSummary = { ok: true, totalOpen: 12, recent: [] };
    expect(issuesSummaryStat(summary)).toBe("12 open");
  });

  test("reports none open when zero", () => {
    expect(issuesSummaryStat({ ok: true, totalOpen: 0, recent: [] })).toBe(
      "None open",
    );
  });

  test("returns null on error", () => {
    expect(
      issuesSummaryStat({ ok: false, errorKind: "github_not_connected" }),
    ).toBeNull();
  });
});

describe("actionsSummaryStat", () => {
  test("reports latest status", () => {
    const summary: ActionsSummary = {
      ok: true,
      latestStatus: "passing",
      recentRuns: [
        {
          runId: 1,
          name: "CI",
          conclusion: "success",
          status: "completed",
          createdAt: "2026-06-01T00:00:00Z",
          url: "https://example.test/run/1",
        },
      ],
    };
    expect(actionsSummaryStat(summary)).toBe("Latest: passing");
  });

  test("maps pending to 'in progress'", () => {
    const summary: ActionsSummary = {
      ok: true,
      latestStatus: "pending",
      recentRuns: [
        {
          runId: 1,
          name: "CI",
          conclusion: null,
          status: "in_progress",
          createdAt: "2026-06-01T00:00:00Z",
          url: "https://example.test/run/1",
        },
      ],
    };
    expect(actionsSummaryStat(summary)).toBe("Latest: in progress");
  });

  test("reports no runs when empty", () => {
    expect(
      actionsSummaryStat({ ok: true, latestStatus: "pending", recentRuns: [] }),
    ).toBe("No runs");
  });

  test("returns null on error", () => {
    expect(
      actionsSummaryStat({ ok: false, errorKind: "provider_rate_limited" }),
    ).toBeNull();
  });
});
