export type SidebarToggleAction = {
  id: "collapse";
  ariaLabel: string;
  tooltip: string;
};

/**
 * Returns the metadata for the expanded sidebar toggle affordance.
 *
 * - "collapse": button shown in the sidebar header when the panel is expanded.
 *
 * The caller is responsible for wiring click handlers; this helper owns
 * identity, labels, and order.
 */
export function getSidebarToggleActions(): SidebarToggleAction[] {
  return [
    {
      id: "collapse",
      ariaLabel: "Collapse panel",
      tooltip: "Collapse panel",
    },
  ];
}

export type CollapsedRailAction = {
  id: "expand" | "new-session" | "quick-chat" | "settings";
  ariaLabel: string;
  tooltip: string;
};

export function getCollapsedRailActions(): CollapsedRailAction[] {
  return [
    {
      id: "expand",
      ariaLabel: "Expand panel",
      tooltip: "Expand panel",
    },
    {
      id: "new-session",
      ariaLabel: "New session",
      tooltip: "New session",
    },
    {
      id: "quick-chat",
      ariaLabel: "Quick chat (no repo)",
      tooltip: "Quick chat (no repo)",
    },
    {
      id: "settings",
      ariaLabel: "Open settings",
      tooltip: "Settings",
    },
  ];
}

export type CollapsedRepoRailAction = {
  id:
    | "repo-dashboard"
    | "repo-branch"
    | "repo-settings"
    | "repo-new-session"
    | "repo-agents"
    | "repo-loops";
  ariaLabel: string;
  tooltip: string;
  href?: string;
};

export function getCollapsedRepoRailActions(
  repoOwner: string,
  repoName: string,
): CollapsedRepoRailAction[] {
  const repoLabel = `${repoOwner}/${repoName}`;
  const encodedOwner = encodeURIComponent(repoOwner);
  const encodedName = encodeURIComponent(repoName);

  return [
    {
      id: "repo-dashboard",
      ariaLabel: `Open repo dashboard for ${repoLabel}`,
      tooltip: "Repo dashboard",
      href: `/repos/${encodedOwner}/${encodedName}`,
    },
    {
      id: "repo-branch",
      ariaLabel: `Create session from branch for ${repoLabel}`,
      tooltip: "Create from branch",
    },
    {
      id: "repo-settings",
      ariaLabel: `Open workspace settings for ${repoLabel}`,
      tooltip: "Workspace settings",
    },
    {
      id: "repo-new-session",
      ariaLabel: `Create session for ${repoLabel}`,
      tooltip: "Create session",
    },
    {
      id: "repo-agents",
      ariaLabel: `Open agents for ${repoLabel}`,
      tooltip: "Agents",
      href: `/repos/${encodedOwner}/${encodedName}/agents`,
    },
    {
      id: "repo-loops",
      ariaLabel: `Open loops for ${repoLabel}`,
      tooltip: "Loops",
      href: `/loops?repoOwner=${encodedOwner}&repoName=${encodedName}`,
    },
  ];
}
