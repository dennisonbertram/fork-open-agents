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
 */
import { describe, expect, test } from "bun:test";
import { buildAgentPayload, type FormState } from "./agent-spec";
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
    ...overrides,
  };
}

describe("deployment-status trigger end-to-end: UI → payload → matcher (TASK-168 bugfix)", () => {
  // BT-168-DS-001: the core defect — status filter must reach the matcher via conditions.actions
  test("BT-168-DS-001: deployment status filter 'success' from editor matches a success deployment event", () => {
    const form = makeDeploymentForm({ conditionSeverities: "success" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    const matches = triggerMatchesEvent({ conditions: trigger.conditions }, successEvent);

    expect(matches).toBe(true);
  });

  // BT-168-DS-002: wrong deployment state must NOT match
  test("BT-168-DS-002: deployment status filter 'success' does NOT match a failure deployment event", () => {
    const form = makeDeploymentForm({ conditionSeverities: "success" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    const matches = triggerMatchesEvent({ conditions: trigger.conditions }, failureEvent);

    expect(matches).toBe(false);
  });

  // BT-168-DS-003: no status filter means any deployment state matches
  test("BT-168-DS-003: no status filter matches any deployment state (success and failure both match)", () => {
    const form = makeDeploymentForm({ conditionSeverities: "" });
    const payload = buildAgentPayload(form);
    const trigger = payload.triggers[0]!;

    expect(triggerMatchesEvent({ conditions: trigger.conditions }, successEvent)).toBe(true);
    expect(triggerMatchesEvent({ conditions: trigger.conditions }, failureEvent)).toBe(true);
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
    const label = formatTriggerLabel("github.deployment_status", trigger.conditions ?? {});

    expect(label).toContain("success");
    expect(label).toContain("production");
    expect(label).toMatch(/^On deployment/);
  });
});
