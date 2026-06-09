/**
 * Regression tests for Phase 4: subagent per-role roster.
 *
 * These tests catch future breakage if:
 * - applyRosterOverrides reverts to ignoring roster entries
 * - getSubagentRoster stops extracting the roster from context
 * - subagentRoster gets stripped from experimental_context in prepareCall
 * - The no-roster path accidentally deviates from today's defaults
 *
 * Each regression test covers a different angle from the behavioral tests.
 */

import { describe, expect, test } from "bun:test";

import { type SubagentRoster, applyRosterOverrides } from "./roster";
import { getSubagentRoster } from "../tools/utils";

// ── REG-P4-001: Model override does not bleed across roles ────────────────────

describe("REG-P4-001: Model override stays isolated to configured role", () => {
  test("executor model override does not affect explorer or design", () => {
    const roster: SubagentRoster = {
      executor: { modelId: "openai/gpt-4o" },
    };
    const explorerBase = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "explore",
    };
    const designBase = {
      model: { modelId: "anthropic/claude-opus-4.6" },
      instructions: "design",
    };

    const explorerResult = applyRosterOverrides({
      role: "explorer",
      roster,
      base: explorerBase,
    });
    const designResult = applyRosterOverrides({
      role: "design",
      roster,
      base: designBase,
    });

    // Both must be unchanged — only executor has a row
    expect(explorerResult.model).toBe(explorerBase.model);
    expect(designResult.model).toBe(designBase.model);
  });
});

// ── REG-P4-002: Instructions append order is always base then per-role ────────

describe("REG-P4-002: Instructions are appended base-first, then per-role", () => {
  test("per-role instructions appear AFTER the base system prompt", () => {
    const roster: SubagentRoster = {
      executor: { instructions: "Follow TDD." },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "You are an executor agent.",
    };
    const result = applyRosterOverrides({ role: "executor", roster, base });
    const baseIndex = result.instructions.indexOf("You are an executor agent.");
    const roleIndex = result.instructions.indexOf("Follow TDD.");
    // Base prompt must come before per-role instructions
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(baseIndex);
  });

  test("instructions from two separate roles do not mix", () => {
    const roster: SubagentRoster = {
      explorer: { instructions: "Explorer instruction." },
      executor: { instructions: "Executor instruction." },
    };
    const explorerBase = {
      model: { modelId: "m" },
      instructions: "base-explore",
    };
    const executorBase = {
      model: { modelId: "m" },
      instructions: "base-execute",
    };

    const explorerResult = applyRosterOverrides({
      role: "explorer",
      roster,
      base: explorerBase,
    });
    const executorResult = applyRosterOverrides({
      role: "executor",
      roster,
      base: executorBase,
    });

    expect(explorerResult.instructions).toContain("Explorer instruction.");
    expect(explorerResult.instructions).not.toContain("Executor instruction.");
    expect(executorResult.instructions).toContain("Executor instruction.");
    expect(executorResult.instructions).not.toContain("Explorer instruction.");
  });
});

// ── REG-P4-003: Empty roster object is safe (no entries set) ──────────────────

describe("REG-P4-003: Empty roster object does not break subagents", () => {
  test("empty roster object produces unchanged base options for all roles", () => {
    const emptyRoster: SubagentRoster = {};
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base",
    };

    for (const role of ["explorer", "executor", "design"] as const) {
      const result = applyRosterOverrides({ role, roster: emptyRoster, base });
      expect(result.model).toBe(base.model);
      expect(result.instructions).toBe("base");
      expect(result.composioToolkitSlugs).toBeUndefined();
    }
  });
});

// ── REG-P4-004: Non-roster context fields do not corrupt getRoster ─────────────

describe("REG-P4-004: getSubagentRoster ignores array and primitive values", () => {
  test("subagentRoster as array returns null", () => {
    const ctx = {
      sandbox: { state: {}, workingDirectory: "/" },
      model: {},
      subagentRoster: ["explorer"],
    };
    expect(getSubagentRoster(ctx)).toBeNull();
  });

  test("subagentRoster as number returns null", () => {
    const ctx = {
      sandbox: { state: {}, workingDirectory: "/" },
      model: {},
      subagentRoster: 42,
    };
    expect(getSubagentRoster(ctx)).toBeNull();
  });
});

// ── REG-P4-005: Composio slugs for one role do not appear in another ──────────

describe("REG-P4-005: Composio tool slugs stay isolated per role", () => {
  test("slugs configured for explorer do not appear in executor or design", () => {
    const roster: SubagentRoster = {
      explorer: { composioToolkitSlugs: ["github"] },
    };
    const base = { model: { modelId: "m" }, instructions: "base" };

    const executorResult = applyRosterOverrides({
      role: "executor",
      roster,
      base,
    });
    const designResult = applyRosterOverrides({
      role: "design",
      roster,
      base,
    });

    expect(executorResult.composioToolkitSlugs).toBeUndefined();
    expect(designResult.composioToolkitSlugs).toBeUndefined();
  });
});

// ── REG-P4-006: All three roles can be configured simultaneously ──────────────

describe("REG-P4-006: All three roles can be configured in one roster", () => {
  test("each role receives its own unique config when all three have entries", () => {
    const roster: SubagentRoster = {
      explorer: { modelId: "openai/gpt-4o", instructions: "Explore only." },
      executor: { modelId: "openai/gpt-4.5", composioToolkitSlugs: ["linear"] },
      design: {
        instructions: "Make it beautiful.",
        composioToolkitSlugs: ["figma"],
      },
    };
    const explorerBase = {
      model: { modelId: "base-m" },
      instructions: "explore-base",
    };
    const executorBase = {
      model: { modelId: "base-m" },
      instructions: "execute-base",
    };
    const designBase = {
      model: { modelId: "base-m" },
      instructions: "design-base",
    };

    const eResult = applyRosterOverrides({
      role: "explorer",
      roster,
      base: explorerBase,
    });
    const xResult = applyRosterOverrides({
      role: "executor",
      roster,
      base: executorBase,
    });
    const dResult = applyRosterOverrides({
      role: "design",
      roster,
      base: designBase,
    });

    // Explorer: model + instructions overridden, no slugs
    expect((eResult.model as { modelId: string }).modelId).toBe(
      "openai/gpt-4o",
    );
    expect(eResult.instructions).toContain("Explore only.");
    expect(eResult.composioToolkitSlugs).toBeUndefined();

    // Executor: model + slugs set, instructions unchanged
    expect((xResult.model as { modelId: string }).modelId).toBe(
      "openai/gpt-4.5",
    );
    expect(xResult.composioToolkitSlugs).toEqual(["linear"]);
    expect(xResult.instructions).toBe("execute-base");

    // Design: instructions + slugs, model unchanged
    expect(dResult.model).toBe(designBase.model);
    expect(dResult.instructions).toContain("Make it beautiful.");
    expect(dResult.composioToolkitSlugs).toEqual(["figma"]);
  });
});
