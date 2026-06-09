export type CollapsedRailAction = {
  id: "expand" | "new-session" | "quick-chat";
  ariaLabel: string;
  tooltip: string;
};

/**
 * Returns the ordered list of icon-rail actions shown when the sidebar is
 * collapsed to icon width. The caller is responsible for wiring the actual
 * click handlers; this helper owns the identity, labels, and order.
 */
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
