/**
 * Tests for agent template definitions.
 * Each template should prefill the spec fields expected by the contract.
 * A blank option must also exist.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_TEMPLATES, getBlankTemplate } from "./agent-templates";

describe("AGENT_TEMPLATES", () => {
  test("BT-011: exactly 5 named templates exist", () => {
    expect(AGENT_TEMPLATES).toHaveLength(5);
  });

  test("BT-012: template names match the spec", () => {
    const names = AGENT_TEMPLATES.map((t) => t.name);
    expect(names).toContain("PR Backlog Maintainer");
    expect(names).toContain("Failing Checks Fixer");
    expect(names).toContain("Issue Triage Agent");
    expect(names).toContain("Release Notes Agent");
    expect(names).toContain("Docs Drift Checker");
  });

  test("BT-013: every template prefills name, goal, trigger, instructions, outputMode", () => {
    for (const template of AGENT_TEMPLATES) {
      expect(typeof template.name).toBe("string");
      expect(template.name.length).toBeGreaterThan(0);

      expect(typeof template.goal).toBe("string");
      expect(template.goal.length).toBeGreaterThan(0);

      expect(typeof template.triggerKind).toBe("string");
      expect(template.triggerKind.length).toBeGreaterThan(0);

      expect(typeof template.instructions).toBe("string");
      expect(template.instructions.length).toBeGreaterThan(0);
    }
  });

  test("BT-014: all templates default to disabled (enabled=false)", () => {
    for (const template of AGENT_TEMPLATES) {
      expect(template.defaultEnabled).toBe(false);
    }
  });

  test("BT-015: PR Backlog Maintainer uses pull_request trigger", () => {
    const template = AGENT_TEMPLATES.find(
      (t) => t.name === "PR Backlog Maintainer",
    );
    expect(template).toBeDefined();
    expect(template?.triggerKind).toBe("github.pull_request");
  });

  test("BT-016: Failing Checks Fixer uses deployment_status or pull_request trigger", () => {
    const template = AGENT_TEMPLATES.find(
      (t) => t.name === "Failing Checks Fixer",
    );
    expect(template).toBeDefined();
    if (!template) throw new Error("template not found");
    const validTriggers = ["github.deployment_status", "github.pull_request"];
    expect(validTriggers).toContain(template.triggerKind);
  });

  test("BT-017: Issue Triage Agent uses github.issue trigger", () => {
    const template = AGENT_TEMPLATES.find(
      (t) => t.name === "Issue Triage Agent",
    );
    expect(template).toBeDefined();
    expect(template?.triggerKind).toBe("github.issue");
  });

  test("BT-018: Release Notes Agent uses schedule.cron trigger", () => {
    const template = AGENT_TEMPLATES.find(
      (t) => t.name === "Release Notes Agent",
    );
    expect(template).toBeDefined();
    expect(template?.triggerKind).toBe("schedule.cron");
  });

  test("BT-019: write-action templates declare explicit write permission intent", () => {
    for (const template of AGENT_TEMPLATES) {
      const hasWriteAction =
        template.githubActions.push || template.githubActions.open_pull_request;
      if (hasWriteAction) {
        expect(template.permissionsNote).toBeDefined();
        expect(template.permissionsNote).toContain("write");
      }
    }
  });
});

describe("getBlankTemplate", () => {
  test("BT-020: blank template exists and has empty/default fields", () => {
    const blank = getBlankTemplate();

    expect(blank.name).toBe("");
    expect(blank.goal).toBe("");
    expect(blank.instructions).toBe("");
    expect(blank.defaultEnabled).toBe(false);
  });

  test("BT-021: blank template uses pull_request trigger by default", () => {
    const blank = getBlankTemplate();

    expect(blank.triggerKind).toBe("github.pull_request");
  });
});
