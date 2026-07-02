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

  test("(E4) Tools section renders GitHub tool card with segmented control and Composio sub-section", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    // The Tools section heading is present
    expect(html).toContain("Tools");

    // GitHub card identity (name + icon title attribute from lucide)
    expect(html).toContain("GitHub");

    // Segmented control options
    expect(html).toContain("Read-only");
    expect(html).toContain("Open pull requests");

    // Access level description copy present for default read-only state
    expect(html).toContain("change anything");
    expect(html).toContain("This agent can look but not touch");

    // Static read-only permissions still shown inside the card
    expect(html).toContain("issues");
    expect(html).toContain("deployments");
    expect(html).toContain("checks");

    // Composio sub-section mock renders
    expect(html).toContain("composio-other-tools-section");
    expect(html).toContain("Other tools");
  });

  test("(E4b) GitHub card in PR-access state shows PR-specific copy", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialPermissionContents="write"
        initialPermissionPullRequests="write"
      />,
    );

    expect(html).toContain("Never merges");
    expect(html).toContain("This agent can propose changes as pull requests");
  });

  test("(E4c) GitHub actions panel renders the seven action toggles and risk copy for merge/push/delete_branch", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialPermissionContents="read"
        initialPermissionPullRequests="read"
      />,
    );

    expect(html).toContain("Open pull requests");
    expect(html).toContain("Comment on PRs or issues");
    expect(html).toContain("Approve pull requests");
    expect(html).toContain("Request changes");
    expect(html).toContain("Merge pull requests");
    expect(html).toContain("Push commits");
    expect(html).toContain("Delete branches");

    // Risk copy shown for actions off by default (merge/push/delete_branch)
    expect(html).toContain("Off by default; enable deliberately.");

    // Write scope + model fields present
    expect(html).toContain("Write scope");
    expect(html).toContain("Model");
  });

  test("(E4d) mixed initial permissions normalize to Read-only (no silent write)", async () => {
    const { AgentSpecEditor } = await modulePromise;

    // Legacy/mismatched state: contents=write but pullRequests=read can't open
    // a PR, so the card must present Read-only — not PR access — and must not
    // silently keep the write on save.
    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialPermissionContents="write"
        initialPermissionPullRequests="read"
      />,
    );

    expect(html).toContain("This agent can look but not touch");
    expect(html).not.toContain(
      "This agent can propose changes as pull requests",
    );
  });
});
