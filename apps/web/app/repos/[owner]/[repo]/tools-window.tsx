import Link from "next/link";
import type { RepoToolkitEffectiveStatus } from "@/lib/composio/repo-tools-effective-status";
import { getRepoToolkitStatusCopy } from "@/lib/composio/repo-tools-status-copy";

/**
 * Repo dashboard "Tools" tab (#805, epic #796 T9 — discoverable per-repo
 * Tools surface). Renders every relevant toolkit with one effective status
 * (allowed / blocked+rule / selected / default-on / expired / not-connected),
 * sourced server-side from deriveRepoToolkitEffectiveStatuses so this
 * component never recomputes policy or connection state itself.
 *
 * This is a read-only view: the allow/block EDIT controls live on the
 * settings/repositories page (RepoSettingsSection, via the shared
 * ComposioWorkspaceSettingsPanel editor — Codex P2-1, PR #848), which shares
 * the same status-copy helpers. This tab's job is discoverability — a user
 * reaches a Tools view from the repo page without opening a chat session
 * (finding W8) — and it links to the editable surface for making changes.
 */

type ToolsWindowProps = {
  repoOwner: string;
  repoName: string;
  toolStatuses: RepoToolkitEffectiveStatus[];
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  allowed:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  default_on:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  selected:
    "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  blocked:
    "border-destructive/40 bg-destructive/10 text-destructive dark:text-destructive",
  not_connected: "border-border bg-muted/40 text-muted-foreground",
  // Codex P2-2: expired must never look "healthy" — amber, matching the
  // existing "needs reconnect" treatment elsewhere (composio-toolkit-picker.tsx).
  expired:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function ToolsWindow({
  repoOwner,
  repoName,
  toolStatuses,
}: ToolsWindowProps) {
  const editHref = `/settings/repositories/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`;

  return (
    <section
      aria-label="Tools window"
      className="rounded-md border border-border"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Tools</h2>
        <Link
          href={editHref}
          className="text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
        >
          Manage tool access
        </Link>
      </div>

      {toolStatuses.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <p>No tools connected yet for this account.</p>
          <p>
            Connect a tool (Gmail, Slack, Linear, and more) to give agents
            working in this repository access beyond GitHub.{" "}
            <Link
              href="/settings/composio"
              className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
            >
              Connect tools
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {toolStatuses.map((toolStatus) => {
            const copy = getRepoToolkitStatusCopy(toolStatus);
            const badgeClass =
              STATUS_BADGE_CLASSES[toolStatus.status] ??
              "border-border bg-muted/40 text-muted-foreground";
            return (
              <div
                key={toolStatus.slug}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {toolStatus.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {copy.explanation}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                    title={copy.explanation}
                  >
                    {copy.label}
                  </span>
                  {toolStatus.status === "not_connected" ? (
                    <Link
                      href="/settings/composio"
                      className="text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
                    >
                      Connect
                    </Link>
                  ) : null}
                  {toolStatus.status === "expired" ? (
                    <Link
                      href="/settings/composio"
                      className="text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
                    >
                      Reconnect
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
