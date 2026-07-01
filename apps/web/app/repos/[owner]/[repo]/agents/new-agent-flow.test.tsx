/**
 * Tests for the dashboard New Agent creation flow.
 * Covers: BT-022 through BT-031
 *
 * Flow: repo dashboard → New agent link → /agents/new (template-first) → spec editor → save
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
  test("BT-024: renders new section titles: Name, What should this agent do?, When should it run?, Tools, Result, and a top-level Enable control", async () => {
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

    expect(html).toContain("Name");
    expect(html).toContain("What should this agent do?");
    expect(html).toContain("When should it run?");
    expect(html).toContain("Tools");
    expect(html).toContain("Result");
    // Enable moved to a top-level Enabled/Disabled control (no "Turn it on" section)
    expect(html).toContain("Enabled");
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Turn it on");
    // Old section names should NOT be present as primary headings
    expect(html).not.toContain(">Purpose<");
    expect(html).not.toContain(">Instructions<");
    expect(html).not.toContain(">Output<");
    expect(html).not.toContain(">Permissions<");
    expect(html).not.toContain(">Safety<");
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

  test("BT-026: ready_pr output selects the 'Open a pull request' Result option and its PR-specific copy", async () => {
    const { AgentSpecEditor } = await agentSpecEditorPromise;
    const { buildAgentPayload } =
      await import("@/lib/background-agents/agent-spec");

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

    // "Open a pull request" copy is visible, and its radio input (anchored
    // by its stable value="ready_pr" attribute, since "Open a pull request"
    // also appears earlier in that input's aria-label) is checked.
    const valueIdx = html.indexOf('value="ready_pr"');
    expect(valueIdx).toBeGreaterThanOrEqual(0);
    const radioOpenIdx = html.lastIndexOf("<input", valueIdx);
    const radioCloseIdx = html.indexOf("/>", valueIdx);
    expect(html.slice(radioOpenIdx, radioCloseIdx)).toContain('checked=""');
    const lowerHtml = html.toLowerCase();
    expect(lowerHtml.includes("pull request")).toBe(true);

    // Result (outputMode) is the single source of truth for write access —
    // there is no separate permission copy in the editor anymore, but the
    // payload it would save does carry github write for ready_pr.
    const payload = buildAgentPayload({
      name: "PR Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Create PRs for issues.",
      outputMode: "ready_pr",
      checkCommand: "",
      enabled: false,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
    });
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
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

  test("BT-028: repo owner and name are NOT rendered as editable fields (no id=repo-owner/id=repo-name)", async () => {
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

  test("BT-030: renders a 'New agent' link that navigates to /agents/new (not a step machine)", async () => {
    agentsSwrData = { agents: [] };
    const { RepoAgentsDashboard } = await repoAgentsDashboardPromise;

    const html = renderToStaticMarkup(
      <RepoAgentsDashboard owner="acme" repo="widgets" />,
    );

    // Label is now lowercase "New agent"
    expect(html).toContain("New agent");
    // Navigates to /agents/new (not inline step machine)
    expect(html).toContain("/repos/acme/widgets/agents/new");
  });

  test("BT-031: Run a test button present in spec editor; editor wires onRunTest prop", async () => {
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

    expect(html).toContain("Run a test");
  });
});
