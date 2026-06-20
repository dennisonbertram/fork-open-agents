"use client";

/**
 * InboxSidebar repo sub-groups: Agents and Loops (#403)
 *
 * Renders two collapsible sub-group rows nested under a real repo group in
 * InboxSidebar:
 *   - Agents — always shown; fetched once globally via useAllAgents.
 *   - Loops  — hidden when AGENT_LOOPS_ENABLED is off (API 403 feature_disabled).
 *              Lazy-fetched: only calls the API when the sub-group is first expanded.
 *
 * Each sub-group follows the same visual language as the parent repo group:
 *   - text-xs, muted sub-header
 *   - ChevronDown disclosure with rotate-90 when collapsed
 *   - ml-6 nesting (one level deeper than the ml-4 session list)
 *   - "+" button that navigates to the create/list page for the resource
 */

import { Bot, ChevronDown, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAllAgents } from "@/hooks/use-repo-agents";
import type { SidebarAgent } from "@/hooks/use-repo-agents";
import { useRepoLoops } from "@/hooks/use-repo-loops";
import type { SidebarLoop } from "@/hooks/use-repo-loops";

// ── Pure helper — exported for tests ─────────────────────────────────────────

/**
 * Filter an all-user agents list down to those belonging to a specific repo.
 * Comparison is case-insensitive.
 */
export function filterAgentsByRepo(
  agents: SidebarAgent[],
  repoOwner: string,
  repoName: string,
): SidebarAgent[] {
  const owner = repoOwner.toLowerCase();
  const name = repoName.toLowerCase();
  return agents.filter(
    (a) =>
      a.repoOwner.toLowerCase() === owner && a.repoName.toLowerCase() === name,
  );
}

export type RepoSubGroupRailAction = {
  id: "agents" | "loops";
  ariaLabel: string;
  tooltip: string;
  href: string;
  count: number;
};

export function getRepoSubGroupRailActions({
  repoOwner,
  repoName,
  agents,
  loops,
  loopsFeatureDisabled,
}: {
  repoOwner: string;
  repoName: string;
  agents: SidebarAgent[];
  loops: SidebarLoop[] | null;
  loopsFeatureDisabled: boolean;
}): RepoSubGroupRailAction[] {
  const repoLabel = `${repoOwner}/${repoName}`;
  const encodedOwner = encodeURIComponent(repoOwner);
  const encodedName = encodeURIComponent(repoName);
  const actions: RepoSubGroupRailAction[] = [
    {
      id: "agents",
      ariaLabel: `Open agents for ${repoLabel}`,
      tooltip: agents.length > 0 ? `Agents (${agents.length})` : "Agents",
      href: `/repos/${encodedOwner}/${encodedName}/agents`,
      count: agents.length,
    },
  ];

  if (!loopsFeatureDisabled) {
    actions.push({
      id: "loops",
      ariaLabel: `Open loops for ${repoLabel}`,
      tooltip: loops && loops.length > 0 ? `Loops (${loops.length})` : "Loops",
      href: `/loops?repoOwner=${encodedOwner}&repoName=${encodedName}`,
      count: loops?.length ?? 0,
    });
  }

  return actions;
}

// ── Sub-group shared primitives ───────────────────────────────────────────────

type SubGroupHeaderProps = {
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  createHref: string;
  createLabel: string;
  icon: React.ReactNode;
};

function SubGroupHeader({
  label,
  count,
  isExpanded,
  onToggle,
  createHref,
  createLabel,
  icon,
}: SubGroupHeaderProps) {
  return (
    <div className="group/sub flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:text-foreground/80">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="min-w-0 truncate text-[11px] font-medium">
          {label}
        </span>
        {count > 0 ? (
          <span className="ml-1 shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
            {count}
          </span>
        ) : null}
        <ChevronDown
          className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${
            isExpanded ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>
      <Link
        href={createHref}
        aria-label={createLabel}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-colors hover:text-foreground group-hover/sub:opacity-100"
      >
        <Plus className="h-3 w-3" />
      </Link>
    </div>
  );
}

type SubGroupContentProps = {
  isExpanded: boolean;
  children: React.ReactNode;
};

function SubGroupContent({ isExpanded, children }: SubGroupContentProps) {
  return (
    <div
      aria-hidden={!isExpanded}
      inert={!isExpanded}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        isExpanded
          ? "grid-rows-[1fr] opacity-100"
          : "pointer-events-none grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="overflow-hidden">
        <div className="ml-5 space-y-0.5 border-l border-border/30 py-0.5 pl-1.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function SubGroupEmptyState({ label }: { label: string }) {
  return (
    <p className="px-2 py-1 text-[11px] text-muted-foreground/60">{label}</p>
  );
}

function SubGroupItemLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[12px] text-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

// ── Agents sub-group ──────────────────────────────────────────────────────────

export type RepoAgentsSubGroupProps = {
  repoOwner: string;
  repoName: string;
  /** Agents already filtered to this repo */
  agents: SidebarAgent[];
  /** Start expanded (default: false) */
  initialExpanded?: boolean;
};

export function RepoAgentsSubGroup({
  repoOwner,
  repoName,
  agents,
  initialExpanded = false,
}: RepoAgentsSubGroupProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  return (
    <div>
      <SubGroupHeader
        label="Agents"
        count={agents.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        createHref={`/repos/${repoOwner}/${repoName}/agents`}
        createLabel={`Create agent for ${repoOwner}/${repoName}`}
        icon={<Bot className="h-3 w-3" />}
      />
      <SubGroupContent isExpanded={isExpanded}>
        {agents.length === 0 ? (
          <SubGroupEmptyState label="No agents yet" />
        ) : (
          agents.map((agent) => (
            <SubGroupItemLink
              key={agent.id}
              href={`/repos/${repoOwner}/${repoName}/agents/${agent.id}`}
            >
              {agent.name}
            </SubGroupItemLink>
          ))
        )}
      </SubGroupContent>
    </div>
  );
}

// ── Loops sub-group (presentation-only, accepts props for testability) ────────

export type RepoLoopsSubGroupProps = {
  repoOwner: string;
  repoName: string;
  /** Loops for this repo, or null while loading */
  loops: SidebarLoop[] | null;
  /** True when the API returned 403 feature_disabled — renders nothing */
  featureDisabled: boolean;
  /** Start expanded (default: false) */
  initialExpanded?: boolean;
};

export function RepoLoopsSubGroup({
  repoOwner,
  repoName,
  loops,
  featureDisabled,
  initialExpanded = false,
}: RepoLoopsSubGroupProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  if (featureDisabled) {
    return null;
  }

  const newLoopHref = `/loops/new?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`;

  return (
    <div>
      <SubGroupHeader
        label="Loops"
        count={loops?.length ?? 0}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        createHref={newLoopHref}
        createLabel={`Create loop for ${repoOwner}/${repoName}`}
        icon={<RefreshCw className="h-3 w-3" />}
      />
      <SubGroupContent isExpanded={isExpanded}>
        {/* null = still loading — avoid flash of empty state */}
        {loops === null ? null : loops.length === 0 ? (
          <SubGroupEmptyState label="No loops yet" />
        ) : (
          loops.map((loop) => (
            <SubGroupItemLink key={loop.id} href={`/loops/${loop.id}`}>
              {loop.name}
            </SubGroupItemLink>
          ))
        )}
      </SubGroupContent>
    </div>
  );
}

// ── Internal: lazy loops sub-group with controlled expanded state ──────────────

type RepoLoopsSubGroupLazyProps = {
  repoOwner: string;
  repoName: string;
  loops: SidebarLoop[] | null;
  featureDisabled: boolean;
  expanded: boolean;
  onToggle: () => void;
};

function RepoLoopsSubGroupLazy({
  repoOwner,
  repoName,
  loops,
  featureDisabled,
  expanded,
  onToggle,
}: RepoLoopsSubGroupLazyProps) {
  if (featureDisabled) {
    return null;
  }

  const newLoopHref = `/loops/new?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`;

  return (
    <div>
      <SubGroupHeader
        label="Loops"
        count={loops?.length ?? 0}
        isExpanded={expanded}
        onToggle={onToggle}
        createHref={newLoopHref}
        createLabel={`Create loop for ${repoOwner}/${repoName}`}
        icon={<RefreshCw className="h-3 w-3" />}
      />
      <SubGroupContent isExpanded={expanded}>
        {loops === null ? null : loops.length === 0 ? (
          <SubGroupEmptyState label="No loops yet" />
        ) : (
          loops.map((loop) => (
            <SubGroupItemLink key={loop.id} href={`/loops/${loop.id}`}>
              {loop.name}
            </SubGroupItemLink>
          ))
        )}
      </SubGroupContent>
    </div>
  );
}

// ── Composite: both sub-groups for one repo ────────────────────────────────────

/**
 * RepoSubGroups wires up data fetching and renders both Agents and Loops
 * sub-groups for a specific repo.
 *
 * Import this component into InboxSidebar; it manages its own SWR calls so
 * the sidebar itself doesn't need any loops/agents state.
 */

export type RepoSubGroupsProps = {
  repoOwner: string;
  repoName: string;
};

export function RepoSubGroups({ repoOwner, repoName }: RepoSubGroupsProps) {
  // Agents: fetched globally (shared SWR key), filtered client-side
  const { agents: allAgents } = useAllAgents();
  const repoAgents = allAgents
    ? filterAgentsByRepo(allAgents, repoOwner, repoName)
    : [];

  // Loops: lazy — only fetch after the Loops sub-group is first expanded.
  const [loopsExpanded, setLoopsExpanded] = useState(false);
  const { loops, featureDisabled } = useRepoLoops({
    repoOwner,
    repoName,
    enabled: loopsExpanded,
  });

  return (
    <div className="mt-1 space-y-0.5">
      <RepoAgentsSubGroup
        repoOwner={repoOwner}
        repoName={repoName}
        agents={repoAgents}
      />
      <RepoLoopsSubGroupLazy
        repoOwner={repoOwner}
        repoName={repoName}
        loops={loops}
        featureDisabled={featureDisabled}
        expanded={loopsExpanded}
        onToggle={() => setLoopsExpanded((v) => !v)}
      />
    </div>
  );
}
