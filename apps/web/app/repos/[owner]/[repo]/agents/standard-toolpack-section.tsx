"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { STANDARD_TOOLPACK_ITEMS } from "@/lib/background-agents/builtin-toolpack";
import type { OutputMode, WriteScopeMode } from "@/lib/background-agents/agent-spec";
import { GitHubWriteScopeSection } from "./github-write-scope-section";

export interface StandardToolpackSectionProps {
  /** Currently enabled built-in tool names (excludes the fixed GitHub row). */
  enabledToolNames: string[];
  /** Called with the updated array when a toggle changes. */
  onChange: (names: string[]) => void;
  /** Disable interaction while the parent form is saving. */
  disabled?: boolean;
  /**
   * Drives the caption on the fixed GitHub row: "ready_pr" describes the
   * pull-request-opening capability, every other mode describes read-only
   * access. Mirrors describeOutputModePermissions in agent-spec.ts.
   */
  outputMode: OutputMode;
  /** The agent's repo — used to exclude the home repo from the write-scope repo picker. */
  repoOwner?: string;
  repoName?: string;
  /**
   * The agent owner's GitHub App installation ID (for the write-scope repo
   * search) and repositorySelection ("all" | "selected" | null — gates
   * whether "All repos" can be offered). Both optional so existing callers
   * that haven't been updated to source these from a server page keep
   * compiling; absent means the write-scope repo picker fails closed (no
   * installationId to query, "All repos" disabled).
   */
  installationId?: number | null;
  repositorySelection?: "all" | "selected" | null;
  /** Write-scope selection state, lifted to the parent editor. */
  writeScopeMode?: WriteScopeMode;
  writeScopeRepos?: string[];
  onWriteScopeChange?: (next: {
    writeScopeMode: WriteScopeMode;
    writeScopeRepos: string[];
  }) => void;
}

/**
 * Pure helper: returns the updated enabled-tool-names array after toggling
 * `name` on/off. Extracted so it's unit-testable without DOM interaction —
 * this repo's component tests use renderToStaticMarkup, which cannot
 * simulate clicks (see composio-toolkit-picker-helpers.ts's toggleSlug for
 * the established pattern).
 */
export function toggleBuiltinToolName(
  enabledToolNames: string[],
  name: string,
): string[] {
  if (enabledToolNames.includes(name)) {
    return enabledToolNames.filter((n) => n !== name);
  }
  return [...enabledToolNames, name];
}

/**
 * "Standard toolpack" entry in AgentSpecEditor's Tools panel — an
 * expandable (chevron) list of the built-in sandbox tools every background
 * agent can use, plus a fixed, non-toggleable "GitHub (scoped to this
 * repo)" row describing the always-present, installation-token-based GitHub
 * capability. Collapsed by default, following the same disclosure pattern
 * as "Refine when it runs" in the Trigger section.
 *
 * The GitHub row is display-only and intentionally NOT part of
 * enabledToolNames/onChange — its write capability is derived from Result
 * (outputMode) elsewhere (see buildAgentPayload), not from this toolpack.
 */
export function StandardToolpackSection({
  enabledToolNames,
  onChange,
  disabled = false,
  outputMode,
  repoOwner = "",
  repoName = "",
  installationId = null,
  repositorySelection = null,
  writeScopeMode = "this_repo",
  writeScopeRepos = [],
  onWriteScopeChange = () => {},
}: StandardToolpackSectionProps) {
  const [open, setOpen] = useState(false);

  const githubCaption =
    outputMode === "ready_pr"
      ? "Reads this repo via the GitHub App; opens a pull request when Result = Open a pull request."
      : "Reads this repo via the GitHub App — read-only.";

  return (
    <div className="border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
        Standard toolpack
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        Sandbox tools this agent can use during a run. Auto-approved because
        runs are unattended and sandboxed.
      </p>
      {/* Always render children — use CSS visibility so labels remain in
          markup for tests, matching the "Refine when it runs" pattern. */}
      <div className={cn("mt-3 space-y-2", open ? "" : "hidden")}>
        {/* Fixed, non-toggleable scoped GitHub row */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-2.5">
          <div>
            <p className="text-sm font-medium">GitHub (scoped to this repo)</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {githubCaption}
            </p>
          </div>
          <span className="shrink-0 self-center text-[10px] font-medium uppercase text-muted-foreground">
            Always on
          </span>
        </div>
        <GitHubWriteScopeSection
          outputMode={outputMode}
          repositorySelection={repositorySelection}
          installationId={installationId}
          repoOwner={repoOwner}
          repoName={repoName}
          writeScopeMode={writeScopeMode}
          writeScopeRepos={writeScopeRepos}
          onChange={onWriteScopeChange}
          disabled={disabled}
        />

        {STANDARD_TOOLPACK_ITEMS.map((item) => {
          const checked = enabledToolNames.includes(item.name);
          return (
            <div
              key={item.name}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5"
            >
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                {item.caption && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.caption}
                  </p>
                )}
              </div>
              <Switch
                checked={checked}
                disabled={disabled}
                aria-label={item.label}
                onCheckedChange={() =>
                  onChange(toggleBuiltinToolName(enabledToolNames, item.name))
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
