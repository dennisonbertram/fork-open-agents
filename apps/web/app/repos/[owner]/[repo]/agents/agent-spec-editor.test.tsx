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

  test("(E4c) Result 'Open a pull request' is disabled when GitHub access is Read-only", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialPermissionContents="read"
        initialPermissionPullRequests="read"
        initialOutputMode="none"
      />,
    );

    // The ready_pr radio must be disabled
    const prLabelIdx = html.indexOf("Open a pull request");
    expect(prLabelIdx).toBeGreaterThanOrEqual(0);
    // Find the radio input before the label text
    const radioIdx = html.lastIndexOf("<input", prLabelIdx);
    const radioSnippet = html.slice(radioIdx, prLabelIdx);
    expect(radioSnippet).toContain('disabled=""');

    // The gating helper text is shown
    expect(html).toContain("Give the GitHub tool pull-request access");
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
        initialOutputMode="none"
      />,
    );

    expect(html).toContain("This agent can look but not touch");
    expect(html).not.toContain(
      "This agent can propose changes as pull requests",
    );
  });

  // ---------------------------------------------------------------------------
  // Phase 2C — Save → Test → Enable progression steps
  // ---------------------------------------------------------------------------

  test("(P2C) action bar shows 3-step progression labels: Save, Run a test, Enable", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} createdAgentId={null} />,
    );
    // All three step labels must be present
    expect(html).toContain("Save");
    expect(html).toContain("Run a test");
    expect(html).toContain("Enable");
    // Step numbers or visual markers should appear
    expect(html).toMatch(/[①1]|step.?1/i);
  });

  test("(P2C) when createdAgentId is set, step 1 (Save) shows a ✓ checkmark character", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} createdAgentId="agent-123" />,
    );
    // A literal checkmark character must appear (✓ U+2713 or ✔ U+2714)
    expect(html).toMatch(/✓|✔/);
  });

  test("(P2C) when testRunId is set, step 2 (Run a test) shows a done/checkmark indicator", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        createdAgentId="agent-123"
        testRunId="run-abc"
      />,
    );
    // Two done indicators: one for step 1, one for step 2
    const checkMatches = html.match(/✓|✔/g) ?? [];
    expect(checkMatches.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // Phase 2A — "It will…" / "It will NOT…" output summary in Result section
  // ---------------------------------------------------------------------------

  test("(P2A) Result section renders 'It will' and 'It will NOT' lines for report-only mode", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} initialOutputMode="none" />,
    );
    expect(html).toContain("It will");
    expect(html).toContain("It will NOT");
  });

  test("(P2A) Result section 'It will NOT' for ready_pr mentions merge/push restriction", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialOutputMode="ready_pr"
        initialPermissionContents="write"
        initialPermissionPullRequests="write"
      />,
    );
    expect(html).toContain("It will NOT");
    expect(html.toLowerCase()).toMatch(/merge|push/);
  });

  // ---------------------------------------------------------------------------
  // Phase 1 — multi-trigger + sentence ordering
  // ---------------------------------------------------------------------------

  test("(P1) editor renders 'Add a trigger' affordance", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );
    expect(html.toLowerCase()).toContain("add a trigger");
  });

  test("(P1) with initialTriggers containing 2 entries, 2 trigger blocks are rendered", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const { createTriggerDraft } =
      await import("@/lib/background-agents/agent-spec");
    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...defaultEditorProps}
        initialTriggers={[
          createTriggerDraft("t-1", "github.pull_request"),
          createTriggerDraft("t-2", "github.issue"),
        ]}
      />,
    );
    // Each trigger block renders a select with a unique id (spec-trigger-0, spec-trigger-1)
    expect(html).toContain("spec-trigger-0");
    expect(html).toContain("spec-trigger-1");
    // "Refine when it runs" button appears once per trigger block
    const refineCount = (html.match(/Refine when it runs/g) ?? []).length;
    expect(refineCount).toBeGreaterThanOrEqual(2);
  });

  test("(P1) sentence ordering: 'What should this agent do?' appears before 'When should it run?'", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );
    const instructionsIdx = html.indexOf("What should this agent do?");
    const triggerIdx = html.indexOf("When should it run?");
    expect(instructionsIdx).toBeGreaterThanOrEqual(0);
    expect(triggerIdx).toBeGreaterThanOrEqual(0);
    expect(instructionsIdx).toBeLessThan(triggerIdx);
  });

  test("(P1) sentence ordering: 'When should it run?' appears before 'Tools'", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );
    const triggerIdx = html.indexOf("When should it run?");
    const toolsIdx = html.indexOf("Tools");
    expect(triggerIdx).toBeGreaterThanOrEqual(0);
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(triggerIdx).toBeLessThan(toolsIdx);
  });

  test("(P1) sentence ordering: 'Tools' appears before 'Result'", async () => {
    const { AgentSpecEditor } = await modulePromise;
    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );
    const toolsIdx = html.indexOf("Tools");
    const resultIdx = html.indexOf("Result");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThanOrEqual(0);
    expect(toolsIdx).toBeLessThan(resultIdx);
  });
});
