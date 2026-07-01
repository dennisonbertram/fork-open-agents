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
    const prLabelIdx = html.indexOf("Open a pull request");
    expect(prLabelIdx).toBeGreaterThanOrEqual(0);
    const radioIdx = html.lastIndexOf("<input", prLabelIdx);
    const radioSnippet = html.slice(radioIdx, prLabelIdx);
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
});
