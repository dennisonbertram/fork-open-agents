import Link from "next/link";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { listAgentLoops } from "@/lib/agent-loops/store";
import type { AgentLoop } from "@/lib/db/schema";
import { CollapsibleDashboardCard } from "./collapsible-dashboard-card";
import { DashboardStatusPill } from "./dashboard-status-pill";

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
export function buildWorkflowsSummary(loops: Pick<AgentLoop, "status">[]): string {
  const total = loops.length;
  const active = loops.filter((l) => l.status === "active").length;
  const loopWord = total === 1 ? "workflow" : "workflows";
  return `${total} ${loopWord} · ${active} active`;
}

function newWorkflowHref(repoOwner: string, repoName: string): string {
  return `/loops/new?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`;
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

  const action = (
    <Link
      href={newHref}
      className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
    >
      New workflow
    </Link>
  );

  return (
    <CollapsibleDashboardCard
      cardKey="workflows"
      title="Workflows"
      summary={summary}
      action={action}
      ariaLabel="Workflows window"
    >
      {loops.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <p>No workflows configured for this repository.</p>
          <Link
            href={newHref}
            className="mt-3 inline-block rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/40 hover:text-foreground"
          >
            Create your first workflow
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {loops.map((loop) => (
            <Link
              key={loop.id}
              href={`/loops/${loop.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{loop.name}</p>
                {loop.description ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {loop.description}
                  </p>
                ) : null}
              </div>
              <DashboardStatusPill status={loop.status} />
            </Link>
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

  return <WorkflowsWindowView loops={loops} repoOwner={repoOwner} repoName={repoName} />;
}
