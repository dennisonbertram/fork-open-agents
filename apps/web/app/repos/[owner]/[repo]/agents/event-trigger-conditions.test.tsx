/**
 * Tests for event-specific condition fields in AgentSpecEditor.
 * TASK-168 behavioral tests:
 *
 * BT-168-COND-001: Selecting "Pull request" trigger shows PR condition fields
 *                  (actions, branches, labels) but NOT environments/severities
 * BT-168-COND-002: Selecting "Issue" trigger shows issue condition fields
 *                  (actions, labels) but NOT branches/environments/severities
 * BT-168-COND-003: Selecting "Deployment status" trigger shows deployment fields
 *                  (environments, statuses/severities) but NOT branches/labels
 * BT-168-COND-004: Selecting "Schedule" shows schedule field, NOT condition fields
 * BT-168-COND-005: Condition fields are NOT shown for manual trigger (webhook.error)
 * BT-168-COND-006: PR conditions (actions, branches, labels) appear in built payload
 * BT-168-COND-007: Issue conditions (actions, labels) appear in built payload
 * BT-168-COND-008: Deployment conditions (environments, severities) appear in built payload
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mocks needed for Next.js and schedule component deps
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => undefined) }),
  useParams: () => ({ owner: "acme", repo: "widgets" }),
}));

const componentModulePromise = import("./agent-spec-editor");

const baseProps = {
  repoOwner: "acme",
  repoName: "widgets",
  initialName: "Test Agent",
  initialGoal: "",
  initialInstructions: "Do the thing.",
  initialOutputMode: "none" as const,
  initialCheckCommand: "",
  initialEnabled: false,
  onSave: mock(async () => undefined),
  onRunTest: mock(async () => undefined),
};

describe("AgentSpecEditor — event trigger condition fields", () => {
  // BT-168-COND-001
  test("BT-168-COND-001: PR trigger shows PR condition fields (actions, branches, labels)", async () => {
    const { AgentSpecEditor } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...baseProps}
        initialTriggerKind="github.pull_request"
      />,
    );

    // PR condition fields must be present
    expect(html).toContain("Actions");
    expect(html).toContain("Branches");
    expect(html).toContain("Labels");
    // opened, reopened, synchronize, etc. as hint text or option
    expect(html).toContain("opened");

    // Deployment-specific fields should NOT be present for PR trigger
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Statuses");
  });

  // BT-168-COND-002
  test("BT-168-COND-002: Issue trigger shows issue condition fields (actions, labels) but not branch/env", async () => {
    const { AgentSpecEditor } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...baseProps} initialTriggerKind="github.issue" />,
    );

    // Issue condition fields must be present
    expect(html).toContain("Actions");
    expect(html).toContain("Labels");

    // Branch and environment fields should NOT appear for issue trigger
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Statuses");
  });

  // BT-168-COND-003
  test("BT-168-COND-003: Deployment trigger shows environment and status fields but not branches/labels", async () => {
    const { AgentSpecEditor } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor
        {...baseProps}
        initialTriggerKind="github.deployment_status"
      />,
    );

    // Deployment condition fields must be present
    expect(html).toContain("Environments");
    expect(html).toContain("Statuses");

    // PR-specific fields should NOT appear for deployment trigger
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("Labels");
  });

  // BT-168-COND-004
  test("BT-168-COND-004: Schedule trigger shows schedule field, not GitHub event condition fields", async () => {
    const { AgentSpecEditor } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...baseProps} initialTriggerKind="schedule.cron" />,
    );

    // Schedule input should be present
    expect(html).toContain("Schedule");

    // GitHub event conditions should NOT appear for schedule trigger
    expect(html).not.toContain("Actions");
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("Labels");
    expect(html).not.toContain("Environments");
  });

  // BT-168-COND-005
  test("BT-168-COND-005: Webhook.error trigger shows no event condition fields", async () => {
    const { AgentSpecEditor } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <AgentSpecEditor {...baseProps} initialTriggerKind="webhook.error" />,
    );

    // No GitHub event condition fields for webhook triggers
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Statuses");
  });
});

// BT-168-COND-006/007/008: Payload tests (pure function, no rendering needed)
// These test buildAgentPayload handles conditions correctly for each trigger type
describe("buildAgentPayload — event trigger conditions", () => {
  test("BT-168-COND-006: PR trigger conditions (actions, branches, labels) appear in payload", async () => {
    const { buildAgentPayload } = await import(
      "@/lib/background-agents/agent-spec"
    );

    const payload = buildAgentPayload({
      name: "PR Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "opened, synchronize",
      conditionBranches: "main",
      conditionLabels: "bug",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Review PRs",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
    });

    const trigger = payload.triggers[0];
    expect(trigger?.conditions?.actions).toEqual(["opened", "synchronize"]);
    expect(trigger?.conditions?.branches).toEqual(["main"]);
    expect(trigger?.conditions?.labels).toEqual(["bug"]);
    expect(trigger?.conditions?.environments).toBeUndefined();
    expect(trigger?.conditions?.severities).toBeUndefined();
  });

  test("BT-168-COND-007: Issue trigger conditions (actions, labels) appear in payload", async () => {
    const { buildAgentPayload } = await import(
      "@/lib/background-agents/agent-spec"
    );

    const payload = buildAgentPayload({
      name: "Issue Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.issue",
      schedule: "",
      conditionActions: "labeled",
      conditionBranches: "",
      conditionLabels: "bug",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Triage issues",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
    });

    const trigger = payload.triggers[0];
    expect(trigger?.conditions?.actions).toEqual(["labeled"]);
    expect(trigger?.conditions?.labels).toEqual(["bug"]);
    expect(trigger?.conditions?.branches).toBeUndefined();
    expect(trigger?.conditions?.environments).toBeUndefined();
    expect(trigger?.conditions?.severities).toBeUndefined();
  });

  test("BT-168-COND-008: Deployment trigger conditions (environments, severities) appear in payload", async () => {
    const { buildAgentPayload } = await import(
      "@/lib/background-agents/agent-spec"
    );

    const payload = buildAgentPayload({
      name: "Deploy Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.deployment_status",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "production",
      conditionSeverities: "success",
      instructions: "Monitor deployments",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
    });

    const trigger = payload.triggers[0];
    expect(trigger?.conditions?.environments).toEqual(["production"]);
    expect(trigger?.conditions?.severities).toEqual(["success"]);
    expect(trigger?.conditions?.actions).toBeUndefined();
    expect(trigger?.conditions?.branches).toBeUndefined();
    expect(trigger?.conditions?.labels).toBeUndefined();
  });
});
