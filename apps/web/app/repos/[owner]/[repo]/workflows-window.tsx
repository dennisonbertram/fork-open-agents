import Link from "next/link";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { listAgentLoops } from "@/lib/agent-loops/store";
import type { AgentLoop } from "@/lib/db/schema";
import { CollapsibleDashboardCard } from "./collapsible-dashboard-card";
import { DashboardStatusPill } from "./dashboard-status-pill";
import { LoopRunPreview } from "./loop-run-preview";

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkflowsWindowProps = {
  userId: string;
  repoOwner: string;
  repoName: string;
  /**
   * Loops already fetched by the page's Promise.allSettled block.
   * When provided, the component renders synchronously (no DB round-trip).
   * Falls back to a fresh fetch when omitted (standalone component use in tests).
   */
  preloadedLoops?: AgentLoop[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Exported for test use — computes the collapsed summary line. */
export function buildWorkflowsSummary(
  loops: Pick<AgentLoop, "status">[],
): string {
  const total = loops.length;
  const active = loops.filter((l) => l.status === "active").length;
  const loopWord = total === 1 ? "loop" : "loops";
  return `${total} ${loopWord} · ${active} active`;
}

function newWorkflowHref(repoOwner: string, repoName: string): string {
  return `/loops/new?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`;
}

function repoLoopsHref(repoOwner: string, repoName: string): string {
  return `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/loops`;
}

// ── Presentational component (sync) ───────────────────────────────────────────

/**
 * Pure sync rendering component — accepts pre-fetched loops.
 * Exposed so page.tsx can render it after its Promise.allSettled block.
 */
export function WorkflowsWindowView({
  loops,
  repoOwner,
  repoName,
}: {
  loops: AgentLoop[];
  repoOwner: string;
  repoName: string;
}) {
  const summary = buildWorkflowsSummary(loops);
  const newHref = newWorkflowHref(repoOwner, repoName);
  const allHref = repoLoopsHref(repoOwner, repoName);

  const action = (
    <div className="flex items-center gap-1.5">
      {loops.length > 0 ? (
        <Link
          href={allHref}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          See all
        </Link>
      ) : null}
      <Link
        href={newHref}
        className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      >
        New loop
      </Link>
    </div>
  );

  return (
    <CollapsibleDashboardCard
      cardKey="workflows"
      title="Loops"
      summary={summary}
      action={action}
      ariaLabel="Loops window"
    >
      {loops.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <p>No loops configured for this repository.</p>
          <Link
            href={newHref}
            className="mt-3 inline-block rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/40 hover:text-foreground"
          >
            Create your first loop
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {loops.map((loop) => (
            <div key={loop.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/loops/${loop.id}`}
                  className="min-w-0 flex-1 transition-colors hover:text-foreground"
                >
                  <p className="truncate text-sm font-medium">{loop.name}</p>
                  {loop.description ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {loop.description}
                    </p>
                  ) : null}
                </Link>
                <DashboardStatusPill status={loop.status} />
              </div>
              <LoopRunPreview loopId={loop.id} />
            </div>
          ))}
        </div>
      )}
    </CollapsibleDashboardCard>
  );
}

// ── WorkflowsWindow (async, standalone) ───────────────────────────────────────

/**
 * Async server component: fetches loops and renders the Workflows window.
 * Returns null when AGENT_LOOPS_ENABLED is off.
 *
 * Used in standalone contexts (e.g. component tests, Storybook).
 * In the dashboard page.tsx, prefer `WorkflowsWindowView` with pre-fetched
 * loops from the page's Promise.allSettled block.
 */
export async function WorkflowsWindow({
  userId,
  repoOwner,
  repoName,
  preloadedLoops,
}: WorkflowsWindowProps): Promise<React.JSX.Element | null> {
  if (!isAgentLoopsEnabled()) {
    return null;
  }

  let loops: AgentLoop[];
  if (preloadedLoops !== undefined) {
    loops = preloadedLoops;
  } else {
    try {
      loops = await listAgentLoops(userId, { repoOwner, repoName });
    } catch {
      // Fetch failure → degrade to empty state; dashboard remains intact.
      loops = [];
    }
  }

  return (
    <WorkflowsWindowView
      loops={loops}
      repoOwner={repoOwner}
      repoName={repoName}
    />
  );
}
