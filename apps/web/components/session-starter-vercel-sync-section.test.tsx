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

// REGRESSION: Vercel retry button must survive future refactors
describe("SessionStarterVercelSyncSection - regression coverage", () => {
  test("REGRESSION-001: Retry button text is rendered in compact row even when error message is long", () => {
    // If the retry button were removed from the compact label, this fails.
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="A very detailed and long error message describing what went wrong"
        requiresVercelChoice={false}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html.toLowerCase()).toContain("retry");
    // The error message text itself must still be present (regression: button replacing message)
    expect(html.toLowerCase()).toContain("could not load vercel projects");
  });

  test("REGRESSION-002: Retry button text is present in expanded error branch (requiresVercelChoice forces expand)", () => {
    // If the retry button were dropped from the expanded panel, this fails.
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="Timeout"
        requiresVercelChoice={true}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html.toLowerCase()).toContain("retry");
    // Error text from prop must also appear (regression: prop ignored)
    expect(html.toLowerCase()).toContain("timeout");
  });

  test("REGRESSION-003: no Retry button appears when there is no error (healthy state)", () => {
    // Retry must not appear when projects loaded successfully.
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={{ projects: [], selectedProjectId: null }}
        repoProjectsError={null}
        requiresVercelChoice={false}
        vercelProjectChoice={null}
        onVercelProjectChoiceChange={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html.toLowerCase()).not.toContain("retry");
  });
});
