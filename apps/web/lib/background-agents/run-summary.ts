/**
 * Deterministic run-summary builder for background-agent runs (#163).
 * Produces a bounded, redaction-safe summary from events and outputs.
 * No model prose — all fields are derived from structured data.
 *
 * This module is pure (no server-only imports) so it can be tested in isolation.
 * Database persistence lives in run-summary-persist.ts.
 */

export type RunSummaryArtifact = {
  kind: string;
  label: string;
  url?: string | null;
  prNumber?: number | null;
  issueNumber?: number | null;
};

export type RunSummary = {
  headline: string;
  checked: string[];
  changed: string[];
  blocked: string[];
  artifacts: RunSummaryArtifact[];
  next: string[];
};

export type MinimalRun = {
  id: string;
  status: string;
  repoOwner: string;
  repoName: string;
  outputUrl: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  errorKind: string | null;
  errorMessage: string | null;
};

export type MinimalEvent = {
  id: string;
  eventName: string;
  status: string;
  level: string;
  summary: string | null;
  errorKind: string | null;
  payload: Record<string, unknown>;
};

export type MinimalOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  prNumber: number | null;
};

export type BuildRunSummaryParams = {
  run: MinimalRun;
  events: MinimalEvent[];
  outputs: MinimalOutput[];
};

const MAX_ITEMS = 20;
const MAX_STRING_LENGTH = 300;

/**
 * Deterministic, human-readable headline verb for a recorded output kind
 * (#746). Falls back to the raw kind for values not in this map so a future
 * output kind never produces a blank headline.
 */
const OUTPUT_KIND_HEADLINE_VERB: Record<string, string> = {
  ready_pr: "Opened PR",
  pr_comment: "Commented",
  pr_review: "Reviewed PR",
  merge: "Merged PR",
  push: "Pushed changes",
  branch_delete: "Deleted branch",
  comment: "Commented",
  issue: "Created issue",
  notification: "Sent notification",
};

function describeOutputKind(kind: string): string {
  return OUTPUT_KIND_HEADLINE_VERB[kind] ?? kind;
}

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH - 1)}…`;
}

function capArray<T>(arr: T[]): T[] {
  return arr.slice(0, MAX_ITEMS);
}

/**
 * Builds a bounded, deterministic run summary from structured run data.
 * Does NOT include raw payloads, prompt content, or unbounded stdout.
 */
export function buildRunSummary(params: BuildRunSummaryParams): RunSummary {
  const { run, events, outputs } = params;

  // --- headline ---
  let headline: string;
  if (run.status === "succeeded") {
    const createdOutputs = outputs.filter((o) => o.status === "created");
    if (createdOutputs.length > 0) {
      const first = createdOutputs[0]!;
      const prSuffix = first.prNumber ? ` #${first.prNumber}` : "";
      headline = truncate(
        `Run succeeded — ${describeOutputKind(first.kind)}${prSuffix}`,
      );
    } else {
      headline = truncate("Run succeeded — no output created");
    }
  } else if (run.status === "failed") {
    const kind = run.errorKind ?? "unknown_error";
    headline = truncate(`Run failed — ${kind}`);
  } else {
    headline = truncate(`Run ${run.status}`);
  }

  // --- checked: successful check events (uses only event.summary, never raw payload) ---
  const checkEvents = events.filter(
    (e) =>
      e.eventName.includes("check") &&
      e.status === "succeeded" &&
      e.summary !== null,
  );
  const checked = capArray(
    checkEvents.map((e) => truncate(e.summary ?? e.eventName)),
  );

  // --- changed: signals no-output for succeeded+no-output runs ---
  const changed: string[] = [];
  if (
    run.status === "succeeded" &&
    outputs.filter((o) => o.status === "created").length === 0
  ) {
    changed.push("no output created");
  }

  // --- blocked: failure reasons (structured, no raw payloads) ---
  const blocked: string[] = [];
  if (run.status === "failed") {
    const errorKind = run.errorKind;
    const errorMessage = run.errorMessage;
    if (errorKind) {
      const msg = errorMessage ? `${errorKind}: ${errorMessage}` : errorKind;
      blocked.push(truncate(msg));
    }
    // Additional errorKinds from events (different from run-level errorKind)
    const failEvents = events.filter(
      (e) => e.status === "failed" && e.errorKind && e.errorKind !== errorKind,
    );
    for (const ev of failEvents) {
      if (blocked.length >= MAX_ITEMS) {
        break;
      }
      if (ev.errorKind) {
        const msg = ev.summary
          ? `${ev.errorKind}: ${ev.summary}`
          : ev.errorKind;
        blocked.push(truncate(msg));
      }
    }
  }

  // --- artifacts: derived from outputs only (never raw payloads) ---
  const artifacts: RunSummaryArtifact[] = capArray(
    outputs
      .filter((o) => o.status === "created")
      .map((o): RunSummaryArtifact => {
        const prSuffix = o.prNumber ? ` #${o.prNumber}` : "";
        const label = truncate(
          o.kind === "ready_pr" ? `PR${prSuffix}` : `${o.kind}${prSuffix}`,
        );
        return {
          kind: o.kind,
          label,
          url: o.url ?? null,
          prNumber: o.prNumber ?? null,
        };
      }),
  );

  // --- next: actionable guidance (structured, not model prose) ---
  const next: string[] = [];
  if (run.status === "failed") {
    const kind = run.errorKind;
    if (kind === "checks_failed") {
      next.push("Fix CI and re-trigger");
    } else if (
      kind === "permission_missing" ||
      kind === "installation_missing"
    ) {
      next.push("Grant required GitHub App permissions and re-trigger");
    } else if (kind === "sandbox_unavailable") {
      next.push("Retry the run; sandbox may have been temporarily unavailable");
    } else {
      next.push("Review error details and re-trigger");
    }
  } else if (
    run.status === "succeeded" &&
    outputs.filter((o) => o.status === "created").length === 0
  ) {
    next.push("no output created");
  }

  return {
    headline,
    checked,
    changed,
    blocked: capArray(blocked),
    artifacts,
    next: capArray(next),
  };
}
