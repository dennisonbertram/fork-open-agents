"use client";

import { Github } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GitHub access level for the tool card.
 * "read-only" = contents:read, pullRequests:read.
 * "pr" = contents:write, pullRequests:write.
 */
export type GitHubToolAccess = "read-only" | "pr";

export interface GitHubToolCardProps {
  /** Current access level, derived from permissionContents/permissionPullRequests state. */
  access: GitHubToolAccess;
  /** Called when the user picks a different access level. */
  onChange: (level: GitHubToolAccess) => void;
  /** Disable the control while the parent form is saving. */
  disabled?: boolean;
}

const OPTIONS = [
  {
    value: "read-only" as const,
    label: "Read-only",
    description:
      "Reads code, pull requests, issues and checks. Won’t change anything.",
  },
  {
    value: "pr" as const,
    label: "Open pull requests",
    description:
      "Can push a branch and open a pull request for review. Never merges.",
  },
] as const;

function autonomySentence(access: GitHubToolAccess): string {
  if (access === "pr") {
    return "This agent can propose changes as pull requests, but never merges.";
  }
  return "This agent can look but not touch.";
}

/**
 * First-class GitHub tool card for the Tools section of AgentSpecEditor.
 * GitHub is fixed and non-removable for v1. The card surfaces a two-option
 * inline segmented control (no popover) for Read-only vs. Open pull requests.
 */
export function GitHubToolCard({
  access,
  onChange,
  disabled = false,
}: GitHubToolCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <Github className="h-5 w-5 text-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">GitHub</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read and write to issues, pull requests, code, and checks via the
            GitHub App.
          </p>
        </div>
        {/* Fixed badge */}
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Required
        </span>
      </div>

      {/* Inline segmented control */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Access level
        </p>
        <div
          className="flex rounded-md border border-border bg-muted/20 p-0.5"
          role="group"
          aria-label="GitHub access level"
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              aria-pressed={access === opt.value}
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors text-center",
                access === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected option description */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        {OPTIONS.find((o) => o.value === access)?.description}
      </p>

      {/* Autonomy sentence */}
      <p
        className="text-xs text-muted-foreground italic"
        aria-label="Autonomy summary"
      >
        {autonomySentence(access)}
      </p>

      {/* Static read-only permissions (always shown for transparency) */}
      <div className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono">issues</span>
          <span>read</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono">deployments</span>
          <span>read</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono">checks</span>
          <span>read</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Converts permission levels from FormState into a GitHubToolAccess value
 * for the card. Both write => "pr"; anything else => "read-only".
 */
export function permissionsToAccess(
  contents: "read" | "write",
  pullRequests: "read" | "write",
): GitHubToolAccess {
  return contents === "write" && pullRequests === "write" ? "pr" : "read-only";
}
