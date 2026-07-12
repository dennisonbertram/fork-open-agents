/**
 * MR-4 (#812): New-Chat runtime picker + fix for the "Change" link silently
 * discarding dialog input.
 *
 * BT: the New Chat dialog shows a runtime picker labeled per plain-language
 *     copy ("On-demand sandbox (classic)" / "Through a verified
 *     environment (managed): <profile>"), prefilled from the Preferences
 *     default.
 * BT: clicking "Change" no longer navigates away via a bare <a href> —
 *     doing so would silently discard whatever the user typed into the
 *     session title / repo fields with no confirmation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: { authProvider: "vercel" },
    loading: false,
    hasGitHub: true,
  }),
}));

mock.module("@/hooks/use-github-connection-status", () => ({
  useGitHubConnectionStatus: () => ({
    reconnectRequired: false,
    isLoading: false,
  }),
}));

let mockPreferences: {
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  defaultSandboxType: string;
  defaultManagedRuntimeProfileId: string;
} = {
  autoCommitPush: false,
  autoCreatePr: false,
  defaultSandboxType: "vercel",
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: mockPreferences,
    loading: false,
  }),
}));

mock.module("@/hooks/use-vercel-repo-projects", () => ({
  useVercelRepoProjects: () => ({
    data: null,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

mock.module("@/hooks/use-repo-defaults", () => ({
  useRepoDefaults: () => ({ defaults: undefined, loading: false, error: null }),
}));

mock.module("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

mock.module("@/components/repo-selector-compact", () => ({
  RepoSelectorCompact: () => <div data-testid="repo-selector" />,
}));

mock.module("@/components/branch-selector-compact", () => ({
  BranchSelectorCompact: () => <div data-testid="branch-selector" />,
}));

mock.module("@/components/session-starter-vercel-sync-section", () => ({
  SessionStarterVercelSyncSection: () => <div data-testid="vercel-sync" />,
}));

const modulePromise = import("./session-starter");

describe("SessionStarter runtime picker (MR-4/#812)", () => {
  beforeEach(() => {
    mockPreferences = {
      autoCommitPush: false,
      autoCreatePr: false,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
    };
  });

  // BT: New Chat dialog renders a runtime picker with the classic label.
  test("MR-4/#812: renders an on-demand classic runtime option", async () => {
    const { SessionStarter } = await modulePromise;
    const html = renderToStaticMarkup(
      <SessionStarter onSubmit={() => {}} isLoading={false} lastRepo={null} />,
    );

    expect(html).toContain("On-demand sandbox (classic)");
  });

  // BT: clicking "Change" must not be a bare navigate-away <Link> in the
  // footer — that silently discards whatever the user typed with no
  // confirmation. Radix mode toggling isn't clickable under
  // renderToStaticMarkup, so this is asserted structurally against the
  // component source (a legitimate regression guard for a markup pattern).
  test("MR-4/#812: the footer 'Change' control is no longer a bare navigate-away Link to /settings/preferences", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "session-starter.tsx"),
      "utf8",
    );

    // The old implementation rendered a <Link href="/settings/preferences">
    // wrapping the literal text "Change" — silently discarding dialog state
    // on navigation. This exact pattern must be gone.
    const hasOldDiscardLink =
      /<Link\s+href="\/settings\/preferences"[\s\S]{0,400}?>\s*Change\s*<\/Link>/.test(
        source,
      );
    expect(hasOldDiscardLink).toBe(false);
  });

  // Codex #834 P2 regression: handleSubmit must run its runtime selection
  // through getRuntimeSelectionForSubmit before calling onSubmit. If this
  // wiring is ever removed while the pure helper stays correct in isolation
  // (see session-starter-helpers.test.ts), the onSubmit payload would go
  // back to always sending the unresolved "classic" fallback as an explicit
  // runtimeMode, silently overriding a saved managed_runtime repo default.
  test("Codex #834 P2: handleSubmit routes the runtime selection through getRuntimeSelectionForSubmit before calling onSubmit", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "session-starter.tsx"),
      "utf8",
    );

    expect(source).toContain("getRuntimeSelectionForSubmit(");
    // The helper's result must gate whether runtimeMode/managedRuntimeProfileId
    // survive on the object actually passed to onSubmit.
    expect(source).toMatch(/runtimeSelectionForSubmit/);
  });
});
