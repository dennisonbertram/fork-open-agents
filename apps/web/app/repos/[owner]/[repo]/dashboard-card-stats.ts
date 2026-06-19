import type {
  ActionsSummary,
  IssueSummary,
  PrSummary,
} from "@/lib/github/repo-dashboard";

/**
 * One-line summary strings shown in a dashboard card header when it is
 * collapsed. Pure functions over the existing summary types — return `null`
 * when there is nothing meaningful to summarize (error state), in which case
 * the collapsed header just shows the title.
 */

export function prSummaryStat(summary: PrSummary): string | null {
  if (!summary.ok) {
    return null;
  }
  const open = summary.prs.length;
  if (open === 0) {
    return "None open";
  }
  const parts = [`${open} open`];
  const drafts = summary.prs.filter((pr) => pr.isDraft).length;
  if (drafts > 0) {
    parts.push(`${drafts} draft`);
  }
  const failing = summary.prs.filter(
    (pr) => pr.checksStatus === "failing",
  ).length;
  if (failing > 0) {
    parts.push(`${failing} failing`);
  }
  return parts.join(" · ");
}

export function issuesSummaryStat(summary: IssueSummary): string | null {
  if (!summary.ok) {
    return null;
  }
  return summary.totalOpen === 0 ? "None open" : `${summary.totalOpen} open`;
}

export function actionsSummaryStat(summary: ActionsSummary): string | null {
  if (!summary.ok) {
    return null;
  }
  if (summary.recentRuns.length === 0) {
    return "No runs";
  }
  const label =
    summary.latestStatus === "pending" ? "in progress" : summary.latestStatus;
  return `Latest: ${label}`;
}
