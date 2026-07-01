/**
 * Behavior tests for AgentSpecEditor component.
 * Uses renderToStaticMarkup (react-dom/server) idiom — no JSDOM needed.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the console component to avoid its SWR dependency in this test scope
mock.module("./run-test-console", () => ({
  RunTestConsole: ({ runId }: { runId: string }) => (
    <div data-testid="run-test-console">console:{runId}</div>
  ),
}));

// Mock ComposioOtherToolsSection to avoid SWR dependencies in tests
mock.module("./composio-other-tools-section", () => ({
  ComposioOtherToolsSection: ({
    selectedSlugs,
    repoOwner,
    repoName,
  }: {
    selectedSlugs: string[];
    repoOwner: string;
    repoName: string;
  }) => (
    <div
      data-testid="composio-other-tools-section"
      data-repo={`${repoOwner}/${repoName}`}
      data-slugs={selectedSlugs.join(",")}
    >
      Other tools
    </div>
  ),
}));

const modulePromise = import("./agent-spec-editor");

const defaultEditorProps = {
  repoOwner: "acme",
  repoName: "widgets",
  initialName: "Test Agent",
  initialGoal: "Test goal",
  initialTriggerKind: "github.pull_request" as const,
  initialInstructions: "Do something.",
  initialOutputMode: "none" as const,
  initialCheckCommand: "",
  initialEnabled: false,
  createdAgentId: null,
  testRunId: null,
  onSave: () => {},
  onRunTest: () => {},
};

describe("AgentSpecEditor", () => {
  test("(C1) action bar (Save + Run a test) appears before the first section heading 'Name' in the markup", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    const runTestIdx = html.indexOf("Run a test");
    const nameIdx = html.indexOf("Name");
    expect(runTestIdx).toBeGreaterThanOrEqual(0);
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(runTestIdx).toBeLessThan(nameIdx);
  });

  // Extract just the opening tag of the <button> that wraps the "Run a test"
  // label so we can assert its disabled binding without matching the Save button.
  function runTestButtonTag(html: string): string {
    const labelIdx = html.indexOf("Run a test");
    const openIdx = html.lastIndexOf("<button", labelIdx);
    return html.slice(openIdx, labelIdx);
  }

  test("(C1) with createdAgentId=null the Run a test button is disabled and helper text is present", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} createdAgentId={null} />,
    );

    // The helper text explaining why Run a test is disabled
    expect(html.toLowerCase()).toContain("save first to run a test");
    // The button itself must carry the disabled attribute (mutation guard for
    // decision C: Run a test stays disabled until the agent is saved). Match the
    // rendered attribute `disabled=""`, not the Tailwind `disabled:` class names.
    expect(runTestButtonTag(html)).toContain('disabled=""');
  });

  test("(C1) with createdAgentId set the Run a test button is enabled", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} createdAgentId="agent-123" />,
    );

    expect(runTestButtonTag(html)).not.toContain('disabled=""');
  });

  test("(C5) with testRunId set the RunTestConsole mounts (renders console marker)", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        createdAgentId="agent-123"
        testRunId="run-abc"
      />,
    );

    // Our mock renders data-testid and the runId
    expect(html).toContain("run-test-console");
    expect(html).toContain("console:run-abc");
  });

  test("(C5) without testRunId the RunTestConsole does NOT mount", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        createdAgentId="agent-123"
        testRunId={null}
      />,
    );

    expect(html).not.toContain("run-test-console");
  });

  test("(E4) Tools section renders the Composio 'Other tools' sub-section and no standalone GitHub access card", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    // The Tools section heading is present
    expect(html).toContain("Tools");

    // Composio sub-section mock renders
    expect(html).toContain("composio-other-tools-section");
    expect(html).toContain("Other tools");

    // The standalone GitHub Access-level card (segmented Read-only / Open
    // pull requests control + "Required" badge) is gone — Result is the
    // single source of truth for GitHub write access now.
    expect(html).not.toContain("Read-only");
    expect(html).not.toContain("GitHub access level");
  });

  test("(E4c) both Result options are always selectable regardless of legacy saved GitHub permissions", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialPermissionContents="read"
        initialPermissionPullRequests="read"
        initialOutputMode="none"
      />,
    );

    // Neither Result radio is disabled — there is no permission gate left.
    // Anchor on the stable value="ready_pr" attribute, since "Open a pull
    // request" also appears earlier in that input's aria-label.
    const valueIdx = html.indexOf('value="ready_pr"');
    expect(valueIdx).toBeGreaterThanOrEqual(0);
    const radioOpenIdx = html.lastIndexOf("<input", valueIdx);
    const radioCloseIdx = html.indexOf("/>", valueIdx);
    const radioSnippet = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioSnippet).not.toContain('disabled=""');

    // The old gating helper text is gone.
    expect(html).not.toContain("Give the GitHub tool pull-request access");
  });

  test("(E4d) Result section never renders the old permission-gating helper text, even for a ready_pr agent with legacy read permissions", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialOutputMode="ready_pr"
        initialPermissionContents="read"
        initialPermissionPullRequests="read"
      />,
    );

    expect(html).toContain("Open a pull request");
    expect(html).not.toContain("Give the GitHub tool pull-request access");
  });

  test("(F1) Standard toolpack section renders inside Tools, above Other tools", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    const toolsIdx = html.indexOf("Tools");
    const toolpackIdx = html.indexOf("Standard toolpack");
    const composioIdx = html.indexOf("composio-other-tools-section");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(toolpackIdx).toBeGreaterThan(toolsIdx);
    expect(composioIdx).toBeGreaterThan(toolpackIdx);
    expect(html).toContain("GitHub (scoped to this repo)");
  });

  test("(F2) with no initialBuiltinToolNames, built-ins default on except web_fetch which defaults off", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    const bashIdx = html.indexOf("Run shell commands");
    const bashSwitchIdx = html.indexOf('role="switch"', bashIdx);
    expect(html.slice(bashIdx, bashSwitchIdx + 100)).toContain(
      'data-state="checked"',
    );

    const webFetchIdx = html.indexOf("Fetch external URLs");
    const webFetchSwitchIdx = html.indexOf('role="switch"', webFetchIdx);
    expect(html.slice(webFetchIdx, webFetchSwitchIdx + 100)).toContain(
      'data-state="unchecked"',
    );
  });

  test("(F3) initialBuiltinToolNames threads through as the enabled set", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialBuiltinToolNames={["bash"]}
      />,
    );

    const bashIdx = html.indexOf("Run shell commands");
    const bashSwitchIdx = html.indexOf('role="switch"', bashIdx);
    expect(html.slice(bashIdx, bashSwitchIdx + 100)).toContain(
      'data-state="checked"',
    );

    const readIdx = html.indexOf("Read files");
    const readSwitchIdx = html.indexOf('role="switch"', readIdx);
    expect(html.slice(readIdx, readSwitchIdx + 100)).toContain(
      'data-state="unchecked"',
    );
  });

  // --- Regression coverage -------------------------------------------------

  test("REG: an explicit empty builtinToolNames array (agent with everything disabled) is NOT treated as 'use the default preset'", async () => {
    const { AgentSpecEditor } = await modulePromise;

    // Guards against a plausible regression where someone "helpfully"
    // rewrites `initialBuiltinToolNames ?? [...DEFAULT_ON_TOOL_NAMES]` as an
    // emptiness check (e.g. `names && names.length > 0 ? names : DEFAULT`),
    // which would silently re-enable every built-in — including web_fetch —
    // for an agent whose owner explicitly disabled all of them.
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} initialBuiltinToolNames={[]} />,
    );

    const bashIdx = html.indexOf("Run shell commands");
    const bashSwitchIdx = html.indexOf('role="switch"', bashIdx);
    expect(html.slice(bashIdx, bashSwitchIdx + 100)).toContain(
      'data-state="unchecked"',
    );
  });

  test("REG: the Standard toolpack section renders exactly one switch per built-in and none for the GitHub row, even embedded inside the full editor", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    const switchMatches = html.match(/role="switch"/g) ?? [];
    // 11 built-ins from STANDARD_TOOLPACK_ITEMS; the fixed GitHub row and
    // the mocked ComposioOtherToolsSection contribute none. This would fail
    // if a future edit accidentally made the GitHub row toggleable or
    // duplicated the toolpack section.
    expect(switchMatches.length).toBe(11);
  });

  // --- (A5) Write-scope selector --------------------------------------------

  test("(A5) the write-scope selector does NOT render when outputMode is not ready_pr", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} initialOutputMode="none" />,
    );

    expect(html).not.toContain("Write scope");
  });

  test("(A5) the write-scope selector renders inside Tools when outputMode is ready_pr", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} initialOutputMode="ready_pr" />,
    );

    expect(html).toContain("Write scope");
    expect(html).toContain("This repo");
    expect(html).toContain("Specific repos");
  });

  test("(A5) a ready_pr agent's persisted writeScopeMode/writeScopeRepos round-trip into the rendered selector", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialOutputMode="ready_pr"
        installationId={123}
        repositorySelection="all"
        initialWriteScopeMode="repo_list"
        initialWriteScopeRepos={["acme/other-repo"]}
      />,
    );

    // The persisted "Specific repos" mode is reflected in the checked radio.
    const idx = html.indexOf('value="repo_list"');
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    expect(html.slice(radioOpenIdx, radioCloseIdx)).toContain('checked=""');

    // The persisted repo list round-trips as a selected chip.
    expect(html).toContain("acme/other-repo");
  });

  test("(A5) 'All repos' is disabled with a caption when repositorySelection is 'selected'", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialOutputMode="ready_pr"
        installationId={123}
        repositorySelection="selected"
      />,
    );

    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    expect(html.slice(radioOpenIdx, radioCloseIdx)).toContain('disabled=""');
    expect(html.slice(idx, idx + 300)).toContain(
      "Only available because your installation is set to all repos.",
    );
  });

  // --- Regression coverage ---------------------------------------------------

  test("REG: without installationId/repositorySelection props (legacy callers), the write-scope selector still renders for ready_pr with 'All repos' disabled by default", async () => {
    // Guards against a regression where an existing caller of AgentSpecEditor
    // that hasn't been updated to pass the new optional installationId /
    // repositorySelection props (e.g. NewAgentBuilder, AgentEditForm at the
    // time this step landed) would crash, or would default to an unsafe
    // "All repos enabled" state instead of failing closed.
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} initialOutputMode="ready_pr" />,
    );

    expect(html).toContain("Write scope");
    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    expect(html.slice(radioOpenIdx, radioCloseIdx)).toContain('disabled=""');
  });

  test("REG: a persisted 'all_repos' writeScopeMode round-trips as checked AND enabled when repositorySelection is 'all'", async () => {
    // Distinct from the repo_list round-trip test above: guards specifically
    // against a regression where the "all_repos" radio's checked state and
    // its repositorySelection-driven disabled state fight each other (e.g. a
    // future edit that disables every radio whenever writeScopeMode isn't
    // "this_repo", which would make a legitimately saved all_repos agent look
    // broken in its own editor).
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialOutputMode="ready_pr"
        installationId={123}
        repositorySelection="all"
        initialWriteScopeMode="all_repos"
      />,
    );

    const idx = html.indexOf('value="all_repos"');
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    const radioTag = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioTag).toContain('checked=""');
    expect(radioTag).not.toContain('disabled=""');
  });
});
