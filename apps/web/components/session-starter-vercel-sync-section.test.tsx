import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionStarterVercelSyncSection } from "./session-starter-vercel-sync-section";

// BT-001: Vercel-projects load error — retry button is rendered when onRetry is provided
describe("SessionStarterVercelSyncSection - retry on error", () => {
  test("BT-001: renders a Retry button in compact error branch when onRetry is provided", () => {
    const onRetry = mock(() => {});
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="Failed to load"
        requiresVercelChoice={false}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={onRetry}
      />,
    );
    // The compact collapsed error row should contain a Retry button
    expect(html.toLowerCase()).toContain("retry");
  });

  test("BT-002: renders a Retry button in expanded error branch when onRetry is provided", () => {
    const onRetry = mock(() => {});
    // requiresVercelChoice=true forces expanded view
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="Network error"
        requiresVercelChoice={true}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={onRetry}
      />,
    );
    expect(html.toLowerCase()).toContain("retry");
  });

  test("BT-003: does not render Retry button when onRetry is not provided (backward compat)", () => {
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="Failed to load"
        requiresVercelChoice={false}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
      />,
    );
    // When no onRetry prop, no Retry button — safe default
    expect(html.toLowerCase()).not.toContain("retry");
  });
});
