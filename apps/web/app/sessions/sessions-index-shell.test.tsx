import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// sessions-empty-state: covers the `/sessions` zero-session default view
// copy and the conditional GitHub-connect CTA.

let hasGitHubInstallations = true;
let activeSessionCount = 0;

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: null,
    loading: false,
    isAuthenticated: true,
    isAdmin: false,
    hasGitHub: false,
    hasGitHubAccount: false,
    hasGitHubInstallations,
  }),
}));

mock.module("./sessions-shell-context", () => ({
  useSessionsShell: () => ({
    openNewSessionDialog: mock(() => {}),
    activeSessionCount,
  }),
}));

mock.module("@/components/ui/sidebar", () => ({
  SidebarTrigger: (props: { className?: string }) => (
    <button type="button" {...props} />
  ),
}));

const { SessionsIndexShell } = await import("./sessions-index-shell");

describe("SessionsIndexShell", () => {
  test("explains the first session when the user has no active sessions", () => {
    hasGitHubInstallations = true;
    activeSessionCount = 0;
    const html = renderToStaticMarkup(<SessionsIndexShell />);

    expect(html).toContain("Start your first session");
    expect(html).toContain("New Session");
  });

  test("invites an existing user to choose or create a session", () => {
    hasGitHubInstallations = true;
    activeSessionCount = 9;
    const html = renderToStaticMarkup(<SessionsIndexShell />);

    expect(html).toContain("Choose a session or start a new one");
    expect(html).not.toContain("Start your first session");
  });

  test("shows a GitHub-connect CTA when the user has no GitHub installations", () => {
    hasGitHubInstallations = false;
    const html = renderToStaticMarkup(<SessionsIndexShell />);

    expect(html).toContain("/get-started?step=github");
  });

  test("hides the GitHub-connect CTA when the user already has GitHub installations", () => {
    hasGitHubInstallations = true;
    const html = renderToStaticMarkup(<SessionsIndexShell />);

    expect(html).not.toContain("/get-started?step=github");
  });
});
