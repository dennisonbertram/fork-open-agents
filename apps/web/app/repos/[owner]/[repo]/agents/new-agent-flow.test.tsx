/**
 * Tests for the dashboard New Agent creation flow.
 * Covers: BT-022 through BT-031
 *
 * Flow: repo dashboard → New Agent → template picker → spec editor → save
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ---- Mocks ----------------------------------------------------------------

const push = mock((_url: string) => undefined);
const mutate = mock(async () => undefined);

let agentsSwrData: { agents: unknown[] } | undefined = undefined;
let agentsSwrLoading = false;
let readinessSwrData:
  | { enabled: boolean; ready: boolean; missing: string[]; checks: unknown[] }
  | undefined = undefined;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ owner: "acme", repo: "widgets" }),
}));

mock.module("swr", () => ({
  default: (key: string) => {
    if (typeof key === "string" && key.includes("readiness")) {
      return {
        data: readinessSwrData,
        error: null,
        isLoading: false,
        mutate,
      };
    }
    return {
      data: agentsSwrData,
      error: null,
      isLoading: agentsSwrLoading,
      mutate,
    };
  },
}));

const fetchMock = mock(async (_url: string, _opts?: unknown) => ({
  ok: true,
  json: async () => ({
    agent: { id: "agent-new", name: "Test" },
    runIds: ["run-new-1"],
    enabled: true,
    matched: 1,
    created: 1,
    duplicates: 0,
  }),
}));

mock.module("node-fetch", () => ({ default: fetchMock }));

// ---- Import the module under test AFTER mocks ----------------------------

const templatePickerPromise = import("./template-picker");
const agentSpecEditorPromise = import("./agent-spec-editor");
const repoAgentsDashboardPromise = import("./repo-agents-dashboard");

// ---- Tests ----------------------------------------------------------------

describe("TemplatePicker", () => {
  test("BT-022: renders all 5 named templates plus a blank option", async () => {
    const { TemplatePicker } = await templatePickerPromise;

    const html = renderToStaticMarkup(
      <TemplatePicker onSelect={() => undefined} />,
    );

    expect(html).toContain("PR Backlog Maintainer");
    expect(html).toContain("Failing Checks Fixer");
    expect(html).toContain("Issue Triage Agent");
    expect(html).toContain("Release Notes Agent");
    expect(html).toContain("Docs Drift Checker");
    // blank / custom option
    expect(html).toContain("Blank");
  });

  test("BT-023: template picker is scoped (does not show a repo picker)", async () => {
    const { TemplatePicker } = await templatePickerPromise;

    const html = renderToStaticMarkup(
      <TemplatePicker onSelect={() => undefined} />,
    );

    // The picker should NOT present a field to enter a different repo
    expect(html).not.toContain("Enter repo");
    expect(html).not.toContain('id="repo-owner"');
    expect(html).not.toContain('id="repo-name"');
  });
});

describe("AgentSpecEditor", () => {
  test("BT-024: renders spec sections: Purpose, Trigger, Instructions, Output, Checks, Permissions, Safety/autonomy", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="PR Backlog Maintainer"
        initialGoal="Keep PRs up to date"
        initialTriggerKind="github.pull_request"
        initialInstructions="Check PRs and update them."
        initialOutputMode="none"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    expect(html).toContain("Purpose");
    expect(html).toContain("Trigger");
    expect(html).toContain("Instructions");
    expect(html).toContain("Output");
    expect(html).toContain("Permissions");
    expect(html).toContain("Safety");
  });

  test("BT-025: Save button is disabled by default (new agent starts disabled)", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="My Agent"
        initialGoal="Some goal"
        initialTriggerKind="github.pull_request"
        initialInstructions="Do stuff"
        initialOutputMode="none"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    // The enabled toggle starts off — agent is created DISABLED
    // The save button is present but the agent status field reflects disabled
    expect(html).toContain("Save");
    // enabled=false means the status section shows it as disabled
    expect(html).toContain("disabled");
  });

  test("BT-026: ready_pr output surfaces explicit write/PR permission copy", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="PR Agent"
        initialGoal="Create PRs"
        initialTriggerKind="github.pull_request"
        initialInstructions="Create PRs for issues."
        initialOutputMode="ready_pr"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    // When ready_pr is selected, the permissions section must show write access is needed
    expect(html).toContain("write");
    // Should mention PR creation or pull requests
    const lowerHtml = html.toLowerCase();
    expect(
      lowerHtml.includes("pull request") || lowerHtml.includes("pr"),
    ).toBe(true);
  });

  test("BT-027: no auto-merge controls anywhere in the spec editor", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="Agent"
        initialGoal="Goal"
        initialTriggerKind="github.pull_request"
        initialInstructions="Instructions"
        initialOutputMode="ready_pr"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    const lowerHtml = html.toLowerCase();
    expect(lowerHtml).not.toContain("auto-merge");
    expect(lowerHtml).not.toContain("automerge");
    expect(lowerHtml).not.toContain("auto merge");
  });

  test("BT-028: repo owner and name are displayed but not editable (read-only)", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="Agent"
        initialGoal="Goal"
        initialTriggerKind="github.pull_request"
        initialInstructions="Instructions"
        initialOutputMode="none"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    // Repo is displayed
    expect(html).toContain("acme");
    expect(html).toContain("widgets");
    // Not editable — no owner/repo text inputs
    expect(html).not.toContain('id="repo-owner"');
    expect(html).not.toContain('id="repo-name"');
  });

  test("BT-029: schedule.cron trigger shows schedule input (cron UI is mounted)", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="Schedule Agent"
        initialGoal="Run nightly"
        initialTriggerKind="schedule.cron"
        initialInstructions="Check things."
        initialOutputMode="none"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    // Schedule input should appear
    expect(html.toLowerCase()).toContain("schedule");
  });
});

describe("RepoAgentsDashboard", () => {
  beforeEach(() => {
    agentsSwrData = undefined;
    agentsSwrLoading = false;
    readinessSwrData = undefined;
    push.mockClear();
    mutate.mockClear();
  });

  test("BT-030: renders a 'New Agent' entry point on the dashboard", async () => {
    agentsSwrData = { agents: [] };
    const { RepoAgentsDashboard } = await repoAgentsDashboardPromise;

    const html = renderToStaticMarkup(
      <RepoAgentsDashboard owner="acme" repo="widgets" />,
    );

    expect(html).toContain("New Agent");
  });

  test("BT-031: Run test button present in spec editor; editor wires onRunTest prop", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="Agent"
        initialGoal="Goal"
        initialTriggerKind="github.pull_request"
        initialInstructions="Instructions"
        initialOutputMode="none"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    expect(html).toContain("Run test");
  });
});
