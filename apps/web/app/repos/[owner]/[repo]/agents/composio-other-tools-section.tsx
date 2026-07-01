"use client";

import Link from "next/link";
import { ComposioToolkitPicker } from "@/app/settings/composio-toolkit-picker";

export interface ComposioOtherToolsSectionProps {
  /** Currently selected toolkit slugs. */
  selectedSlugs: string[];
  /** Called when the selection changes. */
  onChange: (slugs: string[]) => void;
  /** Disable interaction while the parent form is saving. */
  disabled?: boolean;
  /** Reserved for future repo-level filtering. */
  repoOwner: string;
  repoName: string;
}

/**
 * "Other tools" sub-section in AgentSpecEditor's Tools panel.
 * Reuses the existing ComposioToolkitPicker verbatim — this wrapper only
 * adds the heading, description, and a link to connect accounts in Settings.
 *
 * The picker self-fetches connected-accounts and toolkits via SWR, so it
 * surfaces its own connection status ("not connected" amber flags) and
 * empty-connected affordances.
 */
export function ComposioOtherToolsSection({
  selectedSlugs,
  onChange,
  disabled = false,
  repoOwner,
  repoName,
}: ComposioOtherToolsSectionProps) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Other tools</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect Composio toolkits — Gmail, Slack, Linear, and more — to give
          this agent access beyond GitHub.{" "}
          <Link
            href="/settings/background-agents"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Connect accounts in Settings
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">
          Adding GitHub here grants live, broader GitHub access across your
          whole connected account (not scoped to this repo) and runs mid-turn
          during unattended, auto-approved runs. The built-in GitHub capability
          in the Standard toolpack above is scoped to this repository and only
          opens a pull request after the run.
        </p>
      </div>
      <ComposioToolkitPicker
        selectedSlugs={selectedSlugs}
        onChange={onChange}
        disabled={disabled}
        source="connected"
        repoOwner={repoOwner}
        repoName={repoName}
        connectHint="Settings → Background agents"
      />
    </div>
  );
}
