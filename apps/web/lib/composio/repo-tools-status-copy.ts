import type {
  RepoToolkitEffectiveStatus,
  RepoToolkitEffectiveStatusKind,
} from "./repo-tools-effective-status";

/**
 * Plain-language copy for each effective status (#805) — reused by both the
 * repo dashboard Tools tab and the settings/repositories page so the two
 * surfaces never drift on vocabulary. Every status carries both a short
 * label (for the chip, shown as TEXT — not color/icon alone, per findings
 * W3/W5) and a one-line explanation (for hover/expand copy).
 */

export type RepoToolkitStatusCopy = {
  label: string;
  explanation: string;
};

const STATUS_COPY: Record<
  RepoToolkitEffectiveStatusKind,
  RepoToolkitStatusCopy
> = {
  allowed: {
    label: "Allowed",
    explanation: "Connected and available to agents in this repository.",
  },
  blocked: {
    label: "Blocked",
    explanation: "Agents working in this repository can't use this tool.",
  },
  selected: {
    label: "Selected",
    explanation: "Explicitly turned on for this repository.",
  },
  default_on: {
    label: "Default on",
    explanation: "GitHub is available unless explicitly blocked.",
  },
  not_connected: {
    label: "Not connected",
    explanation:
      "No account connected yet — connect it before agents can use it here.",
  },
};

export function getRepoToolkitStatusCopy(
  status: RepoToolkitEffectiveStatus,
): RepoToolkitStatusCopy {
  if (status.status === "blocked") {
    return {
      label: "Blocked",
      explanation:
        status.blockReason === "repo_policy_blocked"
          ? "Blocked by repo policy for this repository."
          : "Not in this repository's tool allowlist.",
    };
  }
  return STATUS_COPY[status.status];
}

/**
 * Plain-language summary of a single toolkit's name + status, e.g.
 * "Gmail — Blocked by repo policy for this repository." Used for the save
 * confirmation copy ("Blocked: Gmail.") and accessible labels.
 */
export function describeRepoToolkitStatus(
  status: RepoToolkitEffectiveStatus,
): string {
  const copy = getRepoToolkitStatusCopy(status);
  return `${status.name} — ${copy.explanation}`;
}
