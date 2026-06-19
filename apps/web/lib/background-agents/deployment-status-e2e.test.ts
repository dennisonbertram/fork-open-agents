/**
 * End-to-end tests for the deployment-status trigger status filter round-trip.
 *
 * BT-168-DS-001: UI-produced payload (conditionSeverities = "success") + normalised
 *   deployment_status event (action="success") → triggerMatchesEvent returns TRUE.
 *   This is the defect: the prior code wrote status to conditions.severities but the
 *   matcher checks conditions.actions against event.action — so the trigger silently
 *   never fired.
 *
 * BT-168-DS-002: UI-produced payload with status filter "success" does NOT match a
 *   deployment event with state "failure".
 *
 * BT-168-DS-003: UI-produced payload with no status filter matches any deployment state.
 *
 * BT-168-DS-004: formatTriggerLabel for deployment with a status reads from the SAME
 *   field that buildAgentPayload writes, producing "On deployment success to production".
 *
 * REG-168-DS-001: conditionSeverities written by buildAgentPayload for deployment_status
 *   must land in conditions.actions (not conditions.severities). If the routing is
 *   reverted, this test fails because triggerMatchesEvent would return false.
 *
 * REG-168-DS-002: buildFormFromAgent round-trips a deployment status correctly —
 *   if a stored agent has conditions.actions = ["success"], restoring to a FormState
 *   via buildFormFromAgent must set conditionSeverities = "success" (not conditionActions).
 *
 * REG-168-DS-003: PR and issue trigger conditions are unaffected — their conditionActions
 *   still maps to conditions.actions and is separate from the deployment path.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAgentPayload,
  buildFormFromAgent,
  type FormState,
  type BackgroundAgent,
} from "./agent-spec";
import { triggerMatchesEvent } from "./matching";
import { formatTriggerLabel } from "./trigger-label";
import type { NormalizedBackgroundTriggerEvent } from "./types";

/** Realistic normalized deployment_status webhook event (action = deployment state) */
const successEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.deployment_status",
  externalId: "deployment_status:77:success",
  repoOwner: "acme",
  repoName: "widgets",
  action: "success",
  environment: "production",
};

const failureEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.deployment_status",
  externalId: "deployment_status:78:failure",
  repoOwner: "acme",
  repoName: "widgets",
  action: "failure",
  environment: "production",
};

function makeDeploymentForm(overrides: Partial<FormState> = {}): FormState {
  return {
    name: "Deploy watcher",
    repoOwner: "acme",
    repoName: "widgets",
    triggerKind: "github.deployment_status",
    schedule: "",
    conditionActions: "",
    conditionBranches: "",
    conditionLabels: "",
    conditionEnvironments: "",
    conditionSeverities: "",
    instructions: "React to deployments.",
    outputMode: "none",
    checkCommand: "",
    enabled: true,
    permissionContents: "read",
    permissionPullRequests: "read",
    composioToolkitSlugs: [],
    ...overrides,
  };
}

describe("deployment-status trigger end-to-end: UI → payload → matcher (TASK-168 bugfix)", () => {
  // BT-168-DS-001: the core defect — status filter must reach the matcher via conditions.actions
  test("BT-168-DS-001: deployment status filter 'success' from editor matches a success deployment event", () => {
    const form = makeDeploymentForm({ conditionSeverities: "success" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    const matches = triggerMatchesEvent(
      { conditions: trigger.conditions },
      successEvent,
    );

    expect(matches).toBe(true);
  });

  // BT-168-DS-002: wrong deployment state must NOT match
  test("BT-168-DS-002: deployment status filter 'success' does NOT match a failure deployment event", () => {
    const form = makeDeploymentForm({ conditionSeverities: "success" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    const matches = triggerMatchesEvent(
      { conditions: trigger.conditions },
      failureEvent,
    );

    expect(matches).toBe(false);
  });

  // BT-168-DS-003: no status filter means any deployment state matches
  test("BT-168-DS-003: no status filter matches any deployment state (success and failure both match)", () => {
    const form = makeDeploymentForm({ conditionSeverities: "" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    expect(
      triggerMatchesEvent({ conditions: trigger.conditions }, successEvent),
    ).toBe(true);
    expect(
      triggerMatchesEvent({ conditions: trigger.conditions }, failureEvent),
    ).toBe(true);
  });

  // BT-168-DS-004: label helper reads from the same field that buildAgentPayload writes
  test("BT-168-DS-004: formatTriggerLabel reflects the same conditions field that buildAgentPayload writes for deployment status", () => {
    const form = makeDeploymentForm({
      conditionSeverities: "success",
      conditionEnvironments: "production",
    });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    // The label must include "success" and "production"
    const label = formatTriggerLabel(
      "github.deployment_status",
      trigger.conditions ?? {},
    );

    expect(label).toContain("success");
    expect(label).toContain("production");
    expect(label).toMatch(/^On deployment/);
  });
});

describe("deployment-status trigger regression (TASK-168 bugfix)", () => {
  // REG-168-DS-001: verifies conditions.actions receives the status — if the routing
  // is reverted to conditions.severities the triggerMatchesEvent call returns false.
  test("REG-168-DS-001: buildAgentPayload writes deployment status to conditions.actions, not conditions.severities", () => {
    const form = makeDeploymentForm({ conditionSeverities: "failure" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    // conditions.actions must contain the status ("failure")
    expect(trigger.conditions?.actions).toEqual(["failure"]);
    // conditions.severities must NOT be set for deployment triggers
    expect(trigger.conditions?.severities).toBeUndefined();

    // And the matcher must fire correctly end-to-end
    const failDeployEvent: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.deployment_status",
      externalId: "deployment_status:99:failure",
      repoOwner: "acme",
      repoName: "widgets",
      action: "failure",
      environment: "staging",
    };
    expect(
      triggerMatchesEvent({ conditions: trigger.conditions }, failDeployEvent),
    ).toBe(true);
  });

  // REG-168-DS-002: round-trip test — a stored agent with conditions.actions=["success"]
  // must be restored to FormState.conditionSeverities = "success" by buildFormFromAgent.
  test("REG-168-DS-002: buildFormFromAgent restores deployment status into conditionSeverities from conditions.actions", () => {
    const storedAgent: BackgroundAgent = {
      id: "agent-1",
      name: "Deploy watcher",
      description: null,
      status: "enabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "React to deployments.",
      outputMode: "none",
      checkCommand: null,
      triggers: [
        {
          id: "trigger-1",
          name: "Deployment status",
          kind: "github.deployment_status",
          status: "enabled",
          conditions: { actions: ["success"], environments: ["production"] },
          schedule: null,
          webhookPublicId: null,
        },
      ],
    };

    const form = buildFormFromAgent(storedAgent);

    // conditionSeverities must hold the status value (from conditions.actions)
    expect(form.conditionSeverities).toBe("success");
    // conditionActions must be empty (deployment statuses come from conditionSeverities)
    expect(form.conditionActions).toBe("");
    // environments round-trip correctly
    expect(form.conditionEnvironments).toBe("production");
  });

  // REG-168-DS-003: PR trigger must not be affected by the deployment routing fix.
  test("REG-168-DS-003: PR trigger conditions.actions still comes from conditionActions (not conditionSeverities)", () => {
    const prForm: FormState = {
      name: "PR watcher",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "opened, synchronize",
      conditionBranches: "main",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Review PRs.",
      outputMode: "none",
      checkCommand: "",
      enabled: true,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
    };
    const payload = buildAgentPayload(prForm);
    const trigger = payload.triggers[0]!;

    expect(trigger.conditions?.actions).toEqual(["opened", "synchronize"]);
    expect(trigger.conditions?.branches).toEqual(["main"]);
    expect(trigger.conditions?.severities).toBeUndefined();
  });
});
