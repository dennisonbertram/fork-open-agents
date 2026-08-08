/**
 * Tests for Phase 4: subagents honor per-role config from agents rows.
 *
 * BT-P4-001: No roster / no rows => subagents spawn with today's defaults.
 * BT-P4-002: Explorer row with modelId => explorer subagent uses that model.
 * BT-P4-003: A role row with instructions => subagent system prompt includes them.
 * BT-P4-004: A role row with composioToolkitSlugs => subagent gets those tools.
 * BT-P4-005: Executor unaffected when only explorer row is configured.
 */

import { describe, expect, test } from "bun:test";

import {
  type SubagentRosterEntry,
  type SubagentRoster,
  applyRosterOverrides,
} from "./roster";
import { toProviderModelId } from "../provider-model-id";
import { getSubagentRoster } from "../tools/utils";

// ── BT-P4-001: No roster in context ─────────────────────────────────────────

describe("BT-P4-001: No roster / no rows => default behavior unchanged", () => {
  test("getSubagentRoster returns null when context has no subagentRoster", () => {
    const ctx = { sandbox: { state: {}, workingDirectory: "/" }, model: {} };
    const result = getSubagentRoster(ctx);
    expect(result).toBeNull();
  });

  test("getSubagentRoster returns null for non-object context", () => {
    expect(getSubagentRoster(null)).toBeNull();
    expect(getSubagentRoster(undefined)).toBeNull();
    expect(getSubagentRoster("string")).toBeNull();
  });

  test("applyRosterOverrides returns base options unchanged when roster is null", () => {
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base",
    };
    const result = applyRosterOverrides({
      role: "explorer",
      roster: null,
      base,
    });
    expect(result.model).toBe(base.model);
    expect(result.instructions).toBe("base");
    expect(result.composioToolkitSlugs).toBeUndefined();
  });

  test("applyRosterOverrides returns base options unchanged when roster has no entry for role", () => {
    const roster: SubagentRoster = {
      executor: { modelId: toProviderModelId("openai/gpt-4.5") },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base",
    };
    const result = applyRosterOverrides({ role: "explorer", roster, base });
    expect(result.model).toBe(base.model);
    expect(result.instructions).toBe("base");
  });
});

// ── BT-P4-002: Explorer row with modelId ─────────────────────────────────────

describe("BT-P4-002: Explorer row with modelId => explorer uses that model", () => {
  test("applyRosterOverrides overrides model when entry has modelId", () => {
    const roster: SubagentRoster = {
      explorer: { modelId: toProviderModelId("openai/gpt-4o") },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base",
    };
    const result = applyRosterOverrides({ role: "explorer", roster, base });
    // The model must reflect the configured modelId
    expect(result.model).not.toBe(base.model);
    expect((result.model as { modelId: string }).modelId).toBe("openai/gpt-4o");
  });

  test("applyRosterOverrides uses base model when entry has null modelId", () => {
    const roster: SubagentRoster = {
      explorer: { modelId: null },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base",
    };
    const result = applyRosterOverrides({ role: "explorer", roster, base });
    expect(result.model).toBe(base.model);
  });
});

// ── BT-P4-003: Role row with instructions ─────────────────────────────────────

describe("BT-P4-003: Role row with instructions => system prompt includes them", () => {
  test("applyRosterOverrides appends role instructions to base instructions", () => {
    const roster: SubagentRoster = {
      executor: { instructions: "Always write tests first." },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base prompt",
    };
    const result = applyRosterOverrides({ role: "executor", roster, base });
    expect(result.instructions).toContain("base prompt");
    expect(result.instructions).toContain("Always write tests first.");
  });

  test("applyRosterOverrides keeps base instructions when entry has null instructions", () => {
    const roster: SubagentRoster = {
      executor: { instructions: null },
    };
    const base = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "base prompt",
    };
    const result = applyRosterOverrides({ role: "executor", roster, base });
    expect(result.instructions).toBe("base prompt");
  });
});

// ── BT-P4-004: Role row with composioToolkitSlugs ─────────────────────────────

describe("BT-P4-004: Role row with composioToolkitSlugs => subagent gets those tools", () => {
  test("applyRosterOverrides sets extraTools when entry has composioToolkitSlugs", () => {
    const roster: SubagentRoster = {
      design: { composioToolkitSlugs: ["github", "linear"] },
    };
    const base = {
      model: { modelId: "anthropic/claude-opus-4.6" },
      instructions: "design prompt",
    };
    const result = applyRosterOverrides({ role: "design", roster, base });
    expect(result.composioToolkitSlugs).toEqual(["github", "linear"]);
  });

  test("applyRosterOverrides does not set extraTools when entry has empty slugs", () => {
    const roster: SubagentRoster = {
      design: { composioToolkitSlugs: [] },
    };
    const base = {
      model: { modelId: "anthropic/claude-opus-4.6" },
      instructions: "design prompt",
    };
    const result = applyRosterOverrides({ role: "design", roster, base });
    expect(result.composioToolkitSlugs).toBeUndefined();
  });
});

// ── BT-P4-005: Executor unaffected when only explorer row is configured ────────

describe("BT-P4-005: Executor unaffected when only explorer row is configured", () => {
  test("applyRosterOverrides does not touch executor when only explorer entry exists", () => {
    const roster: SubagentRoster = {
      explorer: {
        modelId: toProviderModelId("openai/gpt-4o"),
        instructions: "Only explore.",
      },
    };
    const baseExecutor = {
      model: { modelId: "anthropic/claude-haiku-4.5" },
      instructions: "executor base",
    };
    const result = applyRosterOverrides({
      role: "executor",
      roster,
      base: baseExecutor,
    });
    expect(result.model).toBe(baseExecutor.model);
    expect(result.instructions).toBe("executor base");
    expect(result.composioToolkitSlugs).toBeUndefined();
  });
});

// ── SubagentRosterEntry type shape ─────────────────────────────────────────────

describe("SubagentRosterEntry shape validation", () => {
  test("SubagentRosterEntry accepts all-null/undefined optional fields (synthetic fallback)", () => {
    const entry: SubagentRosterEntry = {
      modelId: null,
      instructions: null,
      composioToolkitSlugs: [],
    };
    expect(entry.modelId).toBeNull();
    expect(entry.instructions).toBeNull();
    expect(entry.composioToolkitSlugs).toEqual([]);
  });

  test("SubagentRosterEntry accepts partial fields (only modelId set)", () => {
    const entry: SubagentRosterEntry = {
      modelId: toProviderModelId("openai/gpt-4o"),
    };
    expect(entry.modelId).toBe(toProviderModelId("openai/gpt-4o"));
  });
});

// ── REGRESSION: getSubagentRoster from context ────────────────────────────────

describe("REGRESSION: getSubagentRoster extracts roster from experimental_context", () => {
  test("getSubagentRoster returns the roster when present in context", () => {
    const roster: SubagentRoster = {
      explorer: { modelId: toProviderModelId("openai/gpt-4o") },
    };
    const ctx = {
      sandbox: { state: {}, workingDirectory: "/" },
      model: {},
      subagentRoster: roster,
    };
    const result = getSubagentRoster(ctx);
    expect(result).toBe(roster);
  });

  test("getSubagentRoster returns null when subagentRoster is not an object", () => {
    const ctx = {
      sandbox: { state: {}, workingDirectory: "/" },
      model: {},
      subagentRoster: "invalid",
    };
    expect(getSubagentRoster(ctx)).toBeNull();
  });
});
