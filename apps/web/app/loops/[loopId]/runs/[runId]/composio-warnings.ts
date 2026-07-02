/**
 * #798 — agent-loop run detail parity for Composio degradation visibility.
 *
 * Background-agent runs persist a RunSummary with a `warnings[]` field
 * (see lib/background-agents/run-summary.ts). Agent-loop runs have no
 * equivalent persisted summary — the run detail page renders directly from
 * the already-loaded `events` array — so this pure function derives the
 * same kind of human-readable warning strings from the loop-parity event
 * names emitted by agent-step.ts (agent-loop.step.composio.*).
 *
 * Scoped deliberately to warn-level events whose eventName contains
 * "composio" so a non-Composio warn/error event never produces a false
 * warning here (mirrors the scope guard in run-summary.ts).
 */
import type { AgentLoopEvent } from "@/lib/db/schema";

function truncate(value: string): string {
  const MAX_LENGTH = 300;
  return value.length <= MAX_LENGTH
    ? value
    : `${value.slice(0, MAX_LENGTH - 1)}…`;
}

/**
 * Derives human-readable Composio degradation warnings from a loop run's
 * events. Returns an empty array when no composio-prefixed warn event
 * exists (no Composio configured, or everything resolved cleanly).
 */
export function deriveLoopComposioWarnings(
  events: AgentLoopEvent[],
): string[] {
  const warnings: string[] = [];

  const composioWarnEvents = events.filter(
    (e) => e.level === "warn" && e.eventName.includes("composio"),
  );

  for (const ev of composioWarnEvents) {
    const payload = ev.payload as Record<string, unknown>;

    if (ev.eventName.endsWith(".off")) {
      const reason = typeof payload?.reason === "string" ? payload.reason : null;
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
      const errorKind =
        typeof payload?.errorKind === "string" ? payload.errorKind : null;
      warnings.push(
        truncate(
          errorKind
            ? `Composio tool resolution failed: ${errorKind}.`
            : (ev.summary ?? "Composio tool resolution failed."),
        ),
      );
    } else {
      // Forward-compatible fallback for any other composio-prefixed warn event.
      warnings.push(truncate(ev.summary ?? ev.eventName));
    }
  }

  return warnings;
}
