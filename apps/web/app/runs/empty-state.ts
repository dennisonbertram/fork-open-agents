export type RunsEmptyState = {
  heading: string;
  body: string;
  action: string;
  href: string;
};

/**
 * Which "no runs" message the list shows, and what it offers to do about it.
 *
 * Three situations that look the same to the renderer are not the same to the
 * reader:
 *
 * - The account has never produced a run. The useful next step is creating an
 *   Automation.
 * - A status tab is selected and nothing has that status. The useful next step
 *   is widening to every run. Nothing was filtered, so offering to clear
 *   filters names a thing the reader never set.
 * - A real filter is applied — a repository, an automation, a trigger. Now
 *   clearing filters is the correct offer.
 */
export function resolveRunsEmptyState(params: {
  isFiltered: boolean;
  view: string;
  viewLabel: string;
}): RunsEmptyState {
  if (params.isFiltered) {
    return {
      heading: "No runs found",
      body: "Try another status, or clear the repository and trigger filters.",
      action: "Clear filters",
      href: "/runs",
    };
  }

  if (params.view !== "all") {
    return {
      heading: `No runs in ${params.viewLabel}`,
      body: "No run has this status right now. Other runs may still exist.",
      action: "View all runs",
      href: "/runs",
    };
  }

  return {
    heading: "No runs yet",
    body: "Create an Automation and run it before execution history appears here.",
    action: "Create an Automation",
    href: "/automations",
  };
}
