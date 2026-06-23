import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionStarterVercelSyncSection } from "./session-starter-vercel-sync-section";

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

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
    expect(html.toLowerCase()).toContain("retry");
    expect(countOccurrences(html.toLowerCase(), "retry")).toBe(1);
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
        repoName="web"
        repoOwner="acme"
        requiresVercelChoice={true}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={onRetry}
      />,
    );
    expect(html.toLowerCase()).toContain("retry");
    expect(html.toLowerCase()).toContain("connect vercel");
    expect(html.toLowerCase()).toContain("repo settings");
    expect(html).toContain("/settings/repositories/acme/web");
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
  test("REGRESSION-001: compact error branch explains env sync and renders a single retry action", () => {
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
    const normalized = html.toLowerCase();
    expect(normalized).toContain("env sync needs a vercel project check");
    expect(normalized).toContain("retry");
    expect(countOccurrences(normalized, "retry")).toBe(1);
    expect(normalized).not.toContain("could not load vercel projects");
  });

  test("REGRESSION-002: expanded error branch explains how to enable Vercel env sync", () => {
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoProjects={undefined}
        repoProjectsError="Timeout"
        repoName="open-agents"
        repoOwner="dennisonbertram"
        requiresVercelChoice={true}
        vercelProjectChoice={undefined}
        onVercelProjectChoiceChange={() => {}}
        onRetry={() => {}}
      />,
    );
    const normalized = html.toLowerCase();
    expect(normalized).toContain(
      "environment sync copies development env vars",
    );
    expect(normalized).toContain("connect vercel");
    expect(normalized).toContain("repo settings");
    expect(normalized).toContain("details: timeout");
    expect(html).toContain(
      "/settings/repositories/dennisonbertram/open-agents",
    );
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

  test("REGRESSION-004: no-project branch gives a setup path instead of a dead end", () => {
    const html = renderToStaticMarkup(
      <SessionStarterVercelSyncSection
        controlsDisabled={false}
        isVercelLookupPending={false}
        repoName="web"
        repoOwner="acme"
        repoProjects={{ projects: [], selectedProjectId: null }}
        repoProjectsError={null}
        requiresVercelChoice={true}
        vercelProjectChoice={null}
        onVercelProjectChoiceChange={() => {}}
        onRetry={() => {}}
      />,
    );

    const normalized = html.toLowerCase();
    expect(normalized).toContain("no vercel project connected");
    expect(normalized).toContain("environment sync is optional");
    expect(normalized).toContain("connect vercel");
    expect(normalized).toContain("repo settings");
    expect(normalized).not.toContain("retry");
  });
});
