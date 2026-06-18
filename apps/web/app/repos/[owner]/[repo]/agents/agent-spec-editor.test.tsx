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
  test("(C1) action bar (Save + Run test) appears before the Purpose heading in the markup", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    const runTestIdx = html.indexOf("Run test");
    const purposeIdx = html.indexOf("Purpose");
    expect(runTestIdx).toBeGreaterThanOrEqual(0);
    expect(purposeIdx).toBeGreaterThanOrEqual(0);
    expect(runTestIdx).toBeLessThan(purposeIdx);
  });

  // Extract just the opening tag of the <button> that wraps the "Run test"
  // label so we can assert its disabled binding without matching the Save button.
  function runTestButtonTag(html: string): string {
    const labelIdx = html.indexOf("Run test");
    const openIdx = html.lastIndexOf("<button", labelIdx);
    return html.slice(openIdx, labelIdx);
  }

  test("(C1) with createdAgentId=null the Run test button is disabled and helper text is present", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} createdAgentId={null} />,
    );

    // The helper text explaining why Run test is disabled
    expect(html.toLowerCase()).toContain(
      "save the agent before running a test",
    );
    // The button itself must carry the disabled attribute (mutation guard for
    // decision C: Run test stays disabled until the agent is saved). Match the
    // rendered attribute `disabled=""`, not the Tailwind `disabled:` class names.
    expect(runTestButtonTag(html)).toContain('disabled=""');
  });

  test("(C1) with createdAgentId set the Run test button is enabled", async () => {
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

  test("(E4) Permissions section renders Select controls for contents and pull_requests", async () => {
    const { AgentSpecEditor } = await modulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...defaultEditorProps} />,
    );

    // The permissions labels should be present
    expect(html).toContain("contents");
    expect(html).toContain("pull_requests");
    // Radix Select renders combobox role buttons for the interactive selects
    // (SelectItem options render in a portal and are not in SSR static markup)
    const comboboxCount = (html.match(/role="combobox"/g) ?? []).length;
    // There should be at least 2 comboboxes for the permission selects
    // (plus the trigger/output selects — at minimum contents + pull_requests)
    expect(comboboxCount).toBeGreaterThanOrEqual(2);
    // Static read labels for non-interactive permissions
    expect(html).toContain("issues");
    expect(html).toContain("deployments");
    expect(html).toContain("checks");
  });
});
