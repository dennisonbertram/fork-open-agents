export type SidebarToggleAction = {
  id: "collapse" | "open";
  ariaLabel: string;
  tooltip: string;
};

/**
 * Returns the metadata for the two sidebar toggle affordances used by the
 * sessions sidebar (collapsible="offcanvas").
 *
 * - "collapse": button shown in the sidebar header when the panel is expanded.
 * - "open": button shown in the content area when the panel is collapsed
 *   (offcanvas hides the sidebar entirely, so the only way to reopen it is
 *   this content-area control or the ⌘/Ctrl-B keyboard shortcut).
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
    {
      id: "open",
      ariaLabel: "Open panel",
      tooltip: "Open panel",
    },
  ];
}

// ---------------------------------------------------------------------------
// Legacy export — kept for backward-compat while callers migrate.
// The icon-rail (collapsible="icon") was replaced by offcanvas collapse.
// ---------------------------------------------------------------------------

/** @deprecated Use getSidebarToggleActions instead. */
export type CollapsedRailAction = {
  id: "expand" | "new-session" | "quick-chat";
  ariaLabel: string;
  tooltip: string;
};

/** @deprecated The icon rail no longer exists; use getSidebarToggleActions. */
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
  ];
}
