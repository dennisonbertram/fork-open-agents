/**
 * Tests for trigger-label.ts — pure helper that turns a trigger kind + conditions
 * into a human-readable label for the product UI.
 *
 * TASK-168 behavioral tests:
 * BT-168-LABEL-001: PR trigger with no conditions → "On pull request"
 * BT-168-LABEL-002: PR trigger with actions → "On PR opened"
 * BT-168-LABEL-003: PR trigger with multiple actions → "On PR opened, synchronize"
 * BT-168-LABEL-004: PR trigger with branch condition → "On PR opened to main"
 * BT-168-LABEL-005: PR trigger with label condition → "On PR labeled bug"
 * BT-168-LABEL-006: Issue trigger with no conditions → "On issue"
 * BT-168-LABEL-007: Issue trigger with action → "On issue opened"
 * BT-168-LABEL-008: Issue trigger with label → "On issue labeled bug"
 * BT-168-LABEL-009: Deployment trigger with no conditions → "On deployment"
 * BT-168-LABEL-010: Deployment trigger with environment → "On deployment to production"
 * BT-168-LABEL-011: Deployment trigger with status condition → "On deployment success"
 * BT-168-LABEL-012: Deployment trigger with env + status → "On deployment success to production"
 * BT-168-LABEL-013: Schedule trigger → "Scheduled"
 * BT-168-LABEL-014: Webhook.error trigger → "On error webhook"
 */
import { describe, expect, test } from "bun:test";
import { formatTriggerLabel } from "./trigger-label";
import type { TriggerConditions } from "./agent-spec";

describe("formatTriggerLabel", () => {
  // BT-168-LABEL-001
  test("BT-168-LABEL-001: PR trigger with no conditions returns readable default", () => {
    const label = formatTriggerLabel("github.pull_request", {});
    expect(label).toBe("On pull request");
  });

  // BT-168-LABEL-002
  test("BT-168-LABEL-002: PR trigger with single action returns readable label", () => {
    const conditions: TriggerConditions = { actions: ["opened"] };
    const label = formatTriggerLabel("github.pull_request", conditions);
    expect(label).toBe("On PR opened");
  });

  // BT-168-LABEL-003
  test("BT-168-LABEL-003: PR trigger with multiple actions lists them", () => {
    const conditions: TriggerConditions = {
      actions: ["opened", "synchronize"],
    };
    const label = formatTriggerLabel("github.pull_request", conditions);
    expect(label).toBe("On PR opened, synchronize");
  });

  // BT-168-LABEL-004
  test("BT-168-LABEL-004: PR trigger with branch condition includes branch", () => {
    const conditions: TriggerConditions = {
      actions: ["opened"],
      branches: ["main"],
    };
    const label = formatTriggerLabel("github.pull_request", conditions);
    expect(label).toBe("On PR opened to main");
  });

  // BT-168-LABEL-005
  test("BT-168-LABEL-005: PR trigger with label condition shows label", () => {
    const conditions: TriggerConditions = {
      labels: ["bug"],
    };
    const label = formatTriggerLabel("github.pull_request", conditions);
    expect(label).toBe("On PR labeled bug");
  });

  // BT-168-LABEL-006
  test("BT-168-LABEL-006: Issue trigger with no conditions returns readable default", () => {
    const label = formatTriggerLabel("github.issue", {});
    expect(label).toBe("On issue");
  });

  // BT-168-LABEL-007
  test("BT-168-LABEL-007: Issue trigger with action includes action", () => {
    const conditions: TriggerConditions = { actions: ["opened"] };
    const label = formatTriggerLabel("github.issue", conditions);
    expect(label).toBe("On issue opened");
  });

  // BT-168-LABEL-008
  test("BT-168-LABEL-008: Issue trigger with label shows label", () => {
    const conditions: TriggerConditions = { labels: ["bug"] };
    const label = formatTriggerLabel("github.issue", conditions);
    expect(label).toBe("On issue labeled bug");
  });

  // BT-168-LABEL-009
  test("BT-168-LABEL-009: Deployment trigger with no conditions returns readable default", () => {
    const label = formatTriggerLabel("github.deployment_status", {});
    expect(label).toBe("On deployment");
  });

  // BT-168-LABEL-010
  test("BT-168-LABEL-010: Deployment trigger with environment includes environment", () => {
    const conditions: TriggerConditions = { environments: ["production"] };
    const label = formatTriggerLabel("github.deployment_status", conditions);
    expect(label).toBe("On deployment to production");
  });

  // BT-168-LABEL-011
  // Deployment status is stored in conditions.actions (normalizer sets event.action =
  // deployment state; buildConditions routes conditionSeverities → conditions.actions
  // for github.deployment_status so the matcher's conditions.actions check fires).
  test("BT-168-LABEL-011: Deployment trigger with status condition includes status", () => {
    const conditions: TriggerConditions = { actions: ["success"] };
    const label = formatTriggerLabel("github.deployment_status", conditions);
    expect(label).toBe("On deployment success");
  });

  // BT-168-LABEL-012
  test("BT-168-LABEL-012: Deployment trigger with env + status combines both", () => {
    const conditions: TriggerConditions = {
      environments: ["production"],
      actions: ["success"],
    };
    const label = formatTriggerLabel("github.deployment_status", conditions);
    expect(label).toBe("On deployment success to production");
  });

  // BT-168-LABEL-013
  test("BT-168-LABEL-013: Schedule trigger returns Scheduled", () => {
    const label = formatTriggerLabel("schedule.cron", {});
    expect(label).toBe("Scheduled");
  });

  // BT-168-LABEL-014
  test("BT-168-LABEL-014: Webhook error trigger returns readable label", () => {
    const label = formatTriggerLabel("webhook.error", {});
    expect(label).toBe("On error webhook");
  });
});
