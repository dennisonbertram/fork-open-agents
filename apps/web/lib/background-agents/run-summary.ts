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
  /**
   * Degradation warnings surfaced independent of run.status (#798) — e.g. a
   * succeeded run whose Composio tools were silently off, partially
   * disconnected, or errored. Populated from warn-level Composio-prefixed
   * events only (scoped deliberately; see buildRunSummary's warnings block).
   */
  warnings: string[];
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
  /**
   * Whether the agent had one or more Composio toolkit slugs configured for
   * this run (i.e. `agent.composioToolkitSlugs.length > 0` at the time the
   * run executed). Required — not optional — so every caller must make an
   * explicit, honest decision rather than silently defaulting.
   *
   * Used ONLY to gate the "tools were never resolved" copy in next[]: a
   * failed run with zero composio-prefixed events is ambiguous by itself —
   * it's indistinguishable between "this agent has no Composio tools at
   * all" (the common case) and "this agent has Composio tools but failed
   * before resolution ever ran" (#798's actual target). Without this flag,
   * every failed run of a plain non-Composio agent would get a misleading
   * Composio line.
   *
   * When the caller genuinely cannot know (e.g. the owning agent row was
   * deleted and the run/agent join returns null), pass `false` — silence
   * over noise.
   */
  composioConfigured: boolean;
};

const MAX_ITEMS = 20;
const MAX_STRING_LENGTH = 300;

/**
 * Merges a capped "newest-N" event slice with an uncapped, composio-scoped
 * event fetch, deduping by id (Codex review, PR #824, P2-1).
 *
 * The persist site's primary events query is a bounded newest-200 slice
 * (see store.ts's listBackgroundAgentEvents). Composio resolution emits
 * EARLY in a run — before the main agent loop — so on any run with more
 * than 200 total events, the composio-prefixed events can fall off that
 * slice entirely. Without this merge, buildRunSummary would never see
 * them: warnings[] would silently lose the degradation signal, AND the
 * composioConfigured guard's "zero composio events" check would become
 * falsely true, resurrecting the misleading "tools were never resolved"
 * line even though Composio WAS resolved — just outside the naive window.
 *
 * `composioEvents` should come from an uncapped, composio-scoped store
 * query (cheap: narrowed by runId first, same index as the capped query).
 */
export function mergeEventsForSummary(
  cappedEvents: MinimalEvent[],
  composioEvents: MinimalEvent[],
): MinimalEvent[] {
  const seenIds = new Set(cappedEvents.map((e) => e.id));
  const additional = composioEvents.filter((e) => !seenIds.has(e.id));
  return [...cappedEvents, ...additional];
}

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
  const { run, events, outputs, composioConfigured } = params;

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
    // Additional errorKinds from events (different from run-level errorKind).
    //
    // Excludes warn-level events (defect fix, Codex review P2-3): a
    // warn-level "failed" event (e.g. background-agent.composio.error,
    // which is nonfatal by design and already surfaced in warnings[])
    // must not be listed here as if it caused the run to fail. Only
    // error-level events represent genuine failure causes for blocked[].
    const failEvents = events.filter(
      (e) =>
        e.status === "failed" &&
        e.level !== "warn" &&
        e.errorKind &&
        e.errorKind !== errorKind,
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

  // --- warnings: degradation signals surfaced independent of run.status (#798) ---
  // Scoped deliberately to warn-level events with a "composio" segment in
  // their eventName (e.g. background-agent.composio.off / .error /
  // .not_connected, plus their agent-loop.step.composio.* equivalents) so a
  // non-Composio warn-level event never populates this array (BT-011).
  const warnings: string[] = [];
  const composioWarnEvents = events.filter(
    (e) => e.level === "warn" && e.eventName.includes("composio"),
  );
  for (const ev of composioWarnEvents) {
    if (warnings.length >= MAX_ITEMS) {
      break;
    }
    const payload = ev.payload as Record<string, unknown>;
    if (ev.eventName.endsWith(".off")) {
      const reason =
        typeof payload?.reason === "string" ? payload.reason : null;
      const blockedSlugs = Array.isArray(payload?.blockedSlugs)
        ? (payload.blockedSlugs as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [];
      if (reason === "repo_policy_blocked") {
        warnings.push(
          truncate(
            blockedSlugs.length > 0
              ? `Composio tools blocked by repo policy: ${blockedSlugs.join(", ")}.`
              : "Composio tools blocked by repo policy.",
          ),
        );
      } else {
        warnings.push(
          truncate(
            ev.summary ??
              "Composio tools requested but no toolkit slugs were selected.",
          ),
        );
      }
    } else if (ev.eventName.endsWith(".not_connected")) {
      const disconnectedToolkits = Array.isArray(payload?.disconnectedToolkits)
        ? (payload.disconnectedToolkits as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [];
      warnings.push(
        truncate(
          disconnectedToolkits.length > 0
            ? `Composio toolkits resolved but not connected: ${disconnectedToolkits.join(", ")}.`
            : (ev.summary ?? "Composio toolkits resolved but not connected."),
        ),
      );
    } else if (ev.eventName.endsWith(".error")) {
      const errorKind = ev.errorKind;
      warnings.push(
        truncate(
          errorKind
            ? `Composio tool resolution failed: ${errorKind}.`
            : (ev.summary ?? "Composio tool resolution failed."),
        ),
      );
    } else {
      // Any other composio-prefixed warn event (forward-compatible fallback).
      warnings.push(truncate(ev.summary ?? ev.eventName));
    }
  }

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
    // #798: distinguish "tools never reached" from "tools failed" — a run
    // that failed before Composio resolution ever executed has zero
    // composio-prefixed events at all (not even an error/off event).
    //
    // Gated on composioConfigured (defect fix, post-review): zero composio
    // events is ALSO true for the common case of an agent with no Composio
    // toolkits configured at all — without this guard, every failed run of
    // a plain non-Composio agent got a misleading "Composio tools were
    // never resolved" line.
    const anyComposioEvent = events.some((e) =>
      e.eventName.includes("composio"),
    );
    if (composioConfigured && !anyComposioEvent) {
      next.push(
        "Composio tools were never resolved for this run — it failed before tool resolution ran.",
      );
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
    warnings: capArray(warnings),
  };
}
