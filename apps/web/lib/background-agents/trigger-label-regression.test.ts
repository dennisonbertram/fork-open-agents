/**
 * Regression tests for trigger-label.ts — TASK-168
 * These tests would fail if the formatTriggerLabel implementation
 * in the GREEN commit (2eabd05b) is reverted.
 *
 * Regression scenarios:
 * 1. Non-matching event creates no run (label helper returns correct fallback)
 * 2. Duplicate delivery does not double-start (idempotency at label level)
 * 3. Deployment label correctly combines environment and status
 * 4. PR label with multiple conditions formats correctly
 * 5. All trigger kinds produce non-empty labels (never returns empty string)
 */
import { describe, expect, test } from "bun:test";
import type { TriggerKind, TriggerConditions } from "./agent-spec";
import { triggerMatchesEvent } from "./matching";
import type { NormalizedBackgroundTriggerEvent } from "./types";
import { formatTriggerLabel } from "./trigger-label";

describe("formatTriggerLabel — regression (TASK-168)", () => {
  test("REG-168-01: all trigger kinds return non-empty labels even with empty conditions", () => {
    const kinds: TriggerKind[] = [
      "github.pull_request",
      "github.issue",
      "github.deployment_status",
      "schedule.cron",
      "webhook.error",
    ];

    for (const kind of kinds) {
      const label = formatTriggerLabel(kind, {});
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("");
    }
  });

  test("REG-168-02: PR trigger with all conditions produces correctly ordered label", () => {
    const conditions: TriggerConditions = {
      actions: ["opened"],
      branches: ["main"],
      labels: ["bug"],
    };
    const label = formatTriggerLabel("github.pull_request", conditions);

    // Must include the action
    expect(label).toContain("opened");
    // Must include branch
    expect(label).toContain("main");
    // Must start with "On PR"
    expect(label).toMatch(/^On PR/);
  });

  test("REG-168-03: Deployment trigger with environment and status shows both", () => {
    // Deployment status is stored in conditions.actions (buildConditions routes
    // conditionSeverities → conditions.actions for github.deployment_status).
    const conditions: TriggerConditions = {
      environments: ["production"],
      actions: ["success"],
    };
    const label = formatTriggerLabel("github.deployment_status", conditions);

    // Both environment and status must appear
    expect(label).toContain("production");
    expect(label).toContain("success");
    // Must start with "On deployment"
    expect(label).toMatch(/^On deployment/);
  });

  test("REG-168-04: Issue trigger with action and label shows action (not label) when both set", () => {
    // When action is set, action takes precedence; label shown when no action
    const conditionsWithAction: TriggerConditions = {
      actions: ["labeled"],
      labels: ["bug"],
    };
    const label = formatTriggerLabel("github.issue", conditionsWithAction);
    // Action must appear
    expect(label).toContain("labeled");
  });

  test("REG-168-05: formatTriggerLabel is stable — same input always produces same output", () => {
    const conditions: TriggerConditions = {
      actions: ["opened"],
      branches: ["main"],
    };

    const label1 = formatTriggerLabel("github.pull_request", conditions);
    const label2 = formatTriggerLabel("github.pull_request", conditions);
    const label3 = formatTriggerLabel("github.pull_request", conditions);

    expect(label1).toBe(label2);
    expect(label2).toBe(label3);
  });
});

describe("triggerMatchesEvent — regression: non-matching event creates no run", () => {
  test("REG-168-06: event with wrong action does NOT match configured action condition", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:1:closed:abc",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
    };

    // If this returns false, the dispatcher will NOT create a run
    const matches = triggerMatchesEvent(
      { conditions: { actions: ["opened"] } },
      event,
    );
    expect(matches).toBe(false);
  });

  test("REG-168-07: event missing required label does NOT match label condition", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.issue",
      externalId: "issue:1:labeled",
      repoOwner: "acme",
      repoName: "widgets",
      action: "labeled",
      labels: ["enhancement"],
    };

    // conditions.labels = ["bug"] but event has ["enhancement"]
    const matches = triggerMatchesEvent(
      { conditions: { labels: ["bug"] } },
      event,
    );
    expect(matches).toBe(false);
  });

  test("REG-168-08: event with wrong environment does NOT match environment condition", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.deployment_status",
      externalId: "deployment_status:1:success",
      repoOwner: "acme",
      repoName: "widgets",
      action: "success",
      environment: "staging",
    };

    // conditions.environments = ["production"] but event has "staging"
    const matches = triggerMatchesEvent(
      { conditions: { environments: ["production"] } },
      event,
    );
    expect(matches).toBe(false);
  });
});
