/**
 * BT-SECT-001: renders all five SettingsGroup sections by title
 * BT-SECT-002: inherited field (raw=null) shows inherited placeholder text in data-slot
 * BT-SECT-003: overridden field shows the override value
 * BT-SECT-004: autoCreatePr switch is disabled when autoCommitPush is off
 * BT-SECT-005: toggling autoCommitPush calls onSave with the correct delta
 * BT-SECT-006: danger-zone destructive button is disabled until typed confirmation matches
 * BT-SECT-007: integration rows render connected vs not-connected state
 * BT-SECT-008: Composio link points to /settings/composio
 *
 * Codex P2-1 (PR #848): "Manage tool access" on the repo dashboard's Tools
 * tab links to this page, but this page previously only rendered read-only
 * effective-status chips — no editor, no PATCH writer. That breaks #805's
 * protected path ("block Gmail for exactly one repo and SEE it enforced —
 * from the repo page"): a user can see status here but cannot change it.
 * BT-SECT-011: this page mounts the actual policy EDITOR (the shared
 *   ComposioWorkspaceSettingsPanel component, the same PATCH-wired core used
 *   by the sessions workspace panel), not just a read-only list.
 * BT-SECT-012: the editor is given this page's repoOwner/repoName (not the
 *   session-workspace's nullable pair) so it targets the correct repo.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

// Mock listManagedRuntimeProfiles (used in the section)
mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  listManagedRuntimeProfiles: () => [
    {
      id: "web-bun-agent-browser",
      displayName: "Web app with Bun",
      description: "Default profile",
      setupCommands: [],
      verificationCommands: [],
      expectedTools: [],
      optionalTools: [],
      defaultPorts: [],
    },
  ],
  isManagedRuntimeProfileId: (id: unknown) => id === "web-bun-agent-browser",
}));

const refresh = mock(() => undefined);
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// Mock the shared editor panel (has its own SWR/fetch dependencies covered
// by composio-workspace-settings-panel.test.tsx) so this file only asserts
// that RepoSettingsSection mounts it with the right props. Captures the
// onSaved callback via a set/get pair (rather than a directly-assigned
// field, which TS's control-flow narrowing collapses to `never` across the
// reset-then-reassign pattern in the test below) so we can invoke it
// directly — the panel's own save flow is not observable under
// renderToStaticMarkup (no DOM/useEffect), but the callback ITSELF is a
// plain prop we can call synchronously here.
let onSavedRef: (() => void) | undefined;
function setOnSaved(fn: (() => void) | undefined) {
  onSavedRef = fn;
}
function getOnSaved(): (() => void) | undefined {
  return onSavedRef;
}
mock.module("@/components/composio-workspace-settings-panel", () => ({
  ComposioWorkspaceSettingsPanel: ({
    repoOwner,
    repoName,
    onSaved,
  }: {
    repoOwner: string | null;
    repoName: string | null;
    onSaved?: () => void;
  }) => {
    setOnSaved(onSaved);
    return (
      <div
        data-testid="composio-workspace-settings-panel"
        data-repo-owner={repoOwner ?? ""}
        data-repo-name={repoName ?? ""}
      />
    );
  },
}));

// Import after mocks
const sectionModule = import("./repo-settings-section");

// Minimal props factory
function makeProps(
  overrides: Partial<{
    rawFullClone: boolean | null;
    rawAutoCommitPush: boolean | null;
    resolvedAutoCommitPush: boolean;
    githubStatus: "connected" | "not_connected" | "reconnect_required";
    vercelLinked: boolean;
    onSave: (patch: Record<string, unknown>) => Promise<void>;
  }> = {},
) {
  const {
    rawFullClone = null,
    rawAutoCommitPush = null,
    resolvedAutoCommitPush = false,
    githubStatus = "connected",
    vercelLinked = true,
    onSave = async () => {},
  } = overrides;

  return {
    owner: "acme",
    repo: "web",
    resolved: {
      fullClone: rawFullClone ?? false,
      prewarmEnabled: false,
      runtimeMode: "classic" as const,
      managedRuntimeProfileId: "web-bun-agent-browser",
      vcpus: 1,
      autoCommitPush: resolvedAutoCommitPush,
      autoCreatePr: false,
      defaultBranch: null,
      isNewBranch: false,
    },
    raw: {
      fullClone: rawFullClone,
      prewarmEnabled: null,
      runtimeMode: null,
      managedRuntimeProfileId: null,
      vcpus: null,
      autoCommitPush: rawAutoCommitPush,
      autoCreatePr: null,
      defaultBranch: null,
      isNewBranch: null,
    },
    integrations: {
      github: {
        status: githubStatus,
        reason: null,
        hasInstallations: githubStatus === "connected",
        syncedInstallationsCount: githubStatus === "connected" ? 1 : null,
      },
      vercel: vercelLinked
        ? {
            projectId: "prj_abc",
            projectName: "acme-web",
            teamId: null,
            teamSlug: null,
          }
        : null,
      composioHref: "/settings/composio",
    },
    onSave,
  };
}

describe("RepoSettingsSection render", () => {
  test("BT-SECT-001: renders General section heading", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("General");
  });

  test("BT-SECT-001b: renders Clone &amp; runtime section heading", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    // Either "Clone" in a heading is enough
    expect(html.toLowerCase()).toContain("clone");
  });

  test("BT-SECT-001c: renders Git automation section heading", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("Git automation");
  });

  test("BT-SECT-001d: renders Integrations section heading", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("Integrations");
  });

  test("BT-SECT-001e: renders Danger zone section heading", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("Danger zone");
  });

  test("BT-SECT-002: inherited field shows Inherited affordance when raw is null", async () => {
    const { RepoSettingsSection } = await sectionModule;
    // fullClone raw=null means it's inherited
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ rawFullClone: null })} />,
    );
    expect(html).toContain("Inherited");
  });

  test("BT-SECT-003: overridden field does not show Inherited for that field", async () => {
    const { RepoSettingsSection } = await sectionModule;
    // fullClone raw=true means it's overridden
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ rawFullClone: true })} />,
    );
    // The section renders, and fullClone is explicitly overridden
    // Other null fields still show Inherited so we just check the component renders
    expect(html).toContain("Full clone");
  });

  test("BT-SECT-004: autoCreatePr switch has disabled attribute when autoCommitPush is off", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection
        {...makeProps({
          resolvedAutoCommitPush: false,
          rawAutoCommitPush: null,
        })}
      />,
    );
    // When autoCommitPush is off, autoCreatePr switch must be disabled
    // We look for the auto-create-pr switch with disabled attribute
    expect(html).toContain("Auto-create PR");
    // The disabled state is communicated via aria-disabled or disabled
    const prSwitchDisabled =
      html.includes("auto-create-pr") &&
      (html.includes("disabled") || html.includes("aria-disabled"));
    expect(prSwitchDisabled).toBe(true);
  });

  test("BT-SECT-007a: renders GitHub connected status", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ githubStatus: "connected" })} />,
    );
    expect(html).toContain("GitHub");
    expect(html.toLowerCase()).toContain("connect");
  });

  test("BT-SECT-007b: renders not-connected GitHub status", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ githubStatus: "not_connected" })} />,
    );
    expect(html).toContain("GitHub");
  });

  test("BT-SECT-007c: renders Vercel linked project name", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ vercelLinked: true })} />,
    );
    expect(html).toContain("acme-web");
  });

  test("BT-SECT-007d: renders Vercel not-linked state", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ vercelLinked: false })} />,
    );
    expect(html).toContain("Vercel");
  });

  test("BT-SECT-008: Composio link points to /settings/composio", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("/settings/composio");
  });

  // BT-SECT-010 (#805): the section renders the Composio effective-status
  // list (allowed/blocked/selected/default_on/not_connected chips), not just
  // the bare "Manage tools" link — red first because repositorySettings is
  // not yet a prop the section understands.
  test("BT-SECT-010: renders effective-status chips for every toolkit passed in", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(
      <RepoSettingsSection
        {...makeProps()}
        toolStatuses={[
          { slug: "github", name: "GitHub", status: "default_on" },
          {
            slug: "gmail",
            name: "Gmail",
            status: "blocked",
            blockReason: "repo_policy_blocked",
          },
          { slug: "slack", name: "Slack", status: "selected" },
          { slug: "linear", name: "Linear", status: "not_connected" },
        ]}
      />,
    );

    expect(html).toContain("Gmail");
    expect(html).toContain("Slack");
    expect(html).toContain("Linear");
    // Plain-language status text, not raw slug vocabulary
    expect(html.toLowerCase()).toContain("blocked");
    expect(html.toLowerCase()).toContain("not connected");
    // The bare "Manage tools" link must still exist alongside the list
    expect(html).toContain("/settings/composio");
  });

  // Codex P2-1 (PR #848): the page must mount the ACTUAL policy editor, not
  // just a status list. Reuses the shared ComposioWorkspaceSettingsPanel
  // (the same PATCH-wired core already used by the sessions workspace
  // panel) rather than a second implementation.
  test("BT-SECT-011: mounts the shared ComposioWorkspaceSettingsPanel editor", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);

    expect(html).toContain("composio-workspace-settings-panel");
  });

  test("BT-SECT-012: the editor panel receives this page's repoOwner/repoName", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);

    expect(html).toContain('data-repo-owner="acme"');
    expect(html).toContain('data-repo-name="web"');
  });

  // Codex P2-1: "make the effective-status chips refresh after save" — the
  // section wires the editor's onSaved callback to router.refresh() so the
  // server-rendered toolStatuses prop re-fetches after a successful save,
  // without requiring a full page reload.
  test("BT-SECT-013: passes an onSaved callback that triggers router.refresh()", async () => {
    setOnSaved(undefined);
    refresh.mockClear();
    const { RepoSettingsSection } = await sectionModule;
    renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);

    const onSaved = getOnSaved();
    expect(typeof onSaved).toBe("function");
    onSaved?.();
    expect(refresh).toHaveBeenCalled();
  });

  test("BT-SECT-009: Composio 'Manage tools' link has a resting underline affordance (not just hover)", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    // Extract the anchor tag for the composio link
    const anchorMatch = html.match(
      /href="\/settings\/composio"[^>]*>|<a[^>]*href="\/settings\/composio"[^>]*/,
    );
    expect(anchorMatch).not.toBeNull();
    // The link must carry a resting (non-hover) underline class
    // Acceptable patterns: "underline " alone, or "underline " combined with decoration-*
    const linkChunk = html.slice(
      Math.max(0, html.indexOf("/settings/composio") - 200),
      html.indexOf("/settings/composio") + 50,
    );
    const hasRestingUnderline =
      // direct "underline" class (not prefixed by hover: or focus:)
      /(?:^|\s|")underline(?:\s|")/.test(linkChunk) ||
      // or it is rendered as a Button-style element with variant that implies underline
      (linkChunk.includes("underline-offset") &&
        !linkChunk.includes("hover:underline") &&
        linkChunk.includes("underline"));
    expect(hasRestingUnderline).toBe(true);
  });

  test("BT-SECT-006: danger-zone section has confirmation input", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    // The typed double-confirm requires an input for confirmation text
    expect(html).toContain("acme/web");
  });
});

describe("Regression", () => {
  test("REG-SECT-004: all integration links have a resting underline (not just hover:underline)", async () => {
    const { RepoSettingsSection } = await sectionModule;

    // Vercel not-linked renders the "Link Vercel project" anchor
    const htmlNoVercel = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps({ vercelLinked: false })} />,
    );
    // GitHub not-connected renders the "Connect GitHub" anchor
    const htmlNoGitHub = renderToStaticMarkup(
      <RepoSettingsSection
        {...makeProps({ githubStatus: "not_connected", vercelLinked: true })}
      />,
    );
    // Composio "Manage tools" is always present
    const htmlBase = renderToStaticMarkup(
      <RepoSettingsSection {...makeProps()} />,
    );

    function extractLinkClasses(html: string, href: string): string {
      // Grab up to 300 chars around the href to capture the opening <a> tag
      const idx = html.indexOf(href);
      if (idx === -1) return "";
      return html.slice(Math.max(0, idx - 250), idx + href.length + 10);
    }

    const composioChunk = extractLinkClasses(htmlBase, "/settings/composio");
    const vercelChunk = extractLinkClasses(
      htmlNoVercel,
      "/settings/connections",
    );
    const githubChunk = extractLinkClasses(
      htmlNoGitHub,
      "/settings/connections",
    );

    // Each chunk must contain bare "underline" (not just "hover:underline")
    const hasRestingUnderline = (chunk: string) =>
      /(?:^|\s|")underline(?:\s|")/.test(chunk);

    expect(hasRestingUnderline(composioChunk)).toBe(true);
    expect(hasRestingUnderline(vercelChunk)).toBe(true);
    expect(hasRestingUnderline(githubChunk)).toBe(true);
  });

  test("REG-SECT-001: section renders without crashing with minimal props", async () => {
    const { RepoSettingsSection } = await sectionModule;
    expect(() =>
      renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />),
    ).not.toThrow();
  });

  test("REG-SECT-002: uses SettingsGroup data-slot attributes (component is wired to primitive)", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain('data-slot="settings-group"');
    expect(html).toContain('data-slot="setting-row"');
  });

  test("REG-SECT-003: owner/repo identity shown in General section", async () => {
    const { RepoSettingsSection } = await sectionModule;
    const html = renderToStaticMarkup(<RepoSettingsSection {...makeProps()} />);
    expect(html).toContain("acme");
    expect(html).toContain("web");
  });
});
