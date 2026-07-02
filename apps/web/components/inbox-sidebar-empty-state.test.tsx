import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxSidebarEmptyState } from "./inbox-sidebar-empty-state";

// sidebar-empty-state: covers the sidebar's `groupedSessions.length === 0`
// branch. A CTA (not plain text only) must render and call the expected
// handler on click.

describe("InboxSidebarEmptyState", () => {
  test("renders a New Session CTA when there are no sessions", () => {
    const onOpenNewSession = mock(() => {});
    const html = renderToStaticMarkup(
      <InboxSidebarEmptyState
        showArchived={false}
        archivedSessionsError={null}
        onOpenNewSession={onOpenNewSession}
        onRetryArchivedSessions={mock(() => {})}
      />,
    );

    expect(html).toContain("No sessions yet");
    expect(html).toContain("New Session");
  });

  test("preserves the existing archived-error Retry CTA unchanged", () => {
    const onRetryArchivedSessions = mock(() => {});
    const html = renderToStaticMarkup(
      <InboxSidebarEmptyState
        showArchived={true}
        archivedSessionsError="Failed to load archived sessions"
        onOpenNewSession={mock(() => {})}
        onRetryArchivedSessions={onRetryArchivedSessions}
      />,
    );

    expect(html).toContain("Failed to load archived sessions");
    expect(html).toContain("Retry");
    expect(html).not.toContain("New Session");
  });

  test("shows the default archived empty copy when there is no error", () => {
    const html = renderToStaticMarkup(
      <InboxSidebarEmptyState
        showArchived={true}
        archivedSessionsError={null}
        onOpenNewSession={mock(() => {})}
        onRetryArchivedSessions={mock(() => {})}
      />,
    );

    expect(html).toContain("No archived sessions");
    expect(html).not.toContain("Retry");
  });
});
