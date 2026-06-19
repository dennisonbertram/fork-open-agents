/**
 * Regression tests for the two blocking fixes:
 *
 * 1. agents_user_role_scope_idx must remain uniqueIndex (not plain index).
 *    If reverted to index(), ON CONFLICT in upsertUserDefaultAgent throws in
 *    production and every PATCH /api/settings/agents returns 500.
 *
 * 2. AgentRosterRow must carry raw composioToolkitSlugs and buildAgentRoster
 *    must thread them through unchanged. If reverted to a string-derived state,
 *    AgentEditor initializes to [] and silently wipes saved tools on Save.
 *
 * These tests catch future breakage without depending on implementation details.
 */

import { describe, expect, test } from "bun:test";
import { buildAgentRoster } from "./agents-roster";
import type { AgentRosterRow } from "./agents-roster";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const basePrefs = {
  defaultModelId: "anthropic/claude-opus-4-5",
  defaultSubagentModelId: null as string | null,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

const noComposioDefaults: ComposioAgentDefaults = {
  main: { defaultProfileId: null, allowChatOverride: true },
  explorer: { defaultProfileId: null, allowChatOverride: false },
  executor: { defaultProfileId: null, allowChatOverride: false },
  design: { defaultProfileId: null, allowChatOverride: false },
};

const noRuntimeProfiles: ManagedRuntimeProfile[] = [];

// ── Regression: user_default uniqueIndex declaration ─────────────────────────

describe("Regression: agents_user_default_role_scope_idx uniqueIndex", () => {
  /**
   * REG-FIX1-001: The user_default partial index must stay unique.
   * If someone changes uniqueIndex back to index in schema.ts this test catches
   * it before a migration is generated and deployed.
   */
  test("REG-FIX1-001: agents_user_default_role_scope_idx unique flag must be true", async () => {
    const { agents } = await import("@/lib/db/schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(agents);

    const idx = config.indexes.find(
      (i) => i.config.name === "agents_user_default_role_scope_idx",
    );
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
  });

  /**
   * REG-FIX1-002: The unique index must span exactly userId and role for only
   * scope=user_default rows. Repo and session rows get their own scoped indexes.
   */
  test("REG-FIX1-002: unique index covers userId and role columns exactly", async () => {
    const { agents } = await import("@/lib/db/schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(agents);

    const idx = config.indexes.find(
      (i) => i.config.name === "agents_user_default_role_scope_idx",
    );
    const colNames = (idx?.config.columns ?? []).map(
      (c: unknown) => (c as { name?: string }).name,
    );
    expect(colNames).toEqual(["user_id", "role"]);
    expect(idx?.config.where).toBeDefined();
  });
});

// ── Regression: raw slugs threaded through roster ────────────────────────────

describe("Regression: composioToolkitSlugs preserved through buildAgentRoster", () => {
  /**
   * REG-FIX2-001: Saving a set of slugs and then re-opening the editor must
   * return exactly those slugs — not an empty array. If buildAgentRoster
   * stops threading the field, the editor pre-populates with [] and the
   * next Save wipes the user's tools.
   */
  test("REG-FIX2-001: three-slug set round-trips unchanged through roster builder", () => {
    const savedSlugs = ["github", "linear", "slack"];
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles: noRuntimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: savedSlugs,
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    const main = rows.find((r) => r.key === "main");
    expect(main?.composioToolkitSlugs).toEqual(savedSlugs);
  });

  /**
   * REG-FIX2-002: Each role must carry its own slug array independently.
   * If the implementation shares a reference across roles, mutations in the
   * editor would corrupt other roles.
   */
  test("REG-FIX2-002: each role carries its own independent slug array", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles: noRuntimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: ["github"],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
        {
          role: "explorer",
          modelId: null,
          composioToolkitSlugs: ["linear"],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    const main = rows.find((r) => r.key === "main");
    const explorer = rows.find((r) => r.key === "explorer");
    const executor = rows.find((r) => r.key === "executor");

    expect(main?.composioToolkitSlugs).toEqual(["github"]);
    expect(explorer?.composioToolkitSlugs).toEqual(["linear"]);
    // Role with no row gets an empty array, not the other role's slugs
    expect(executor?.composioToolkitSlugs).toEqual([]);
  });

  /**
   * REG-FIX2-003: The no-row-behavior-identical invariant.
   * When no user_default rows are provided, all roles must return the same
   * composioToolkitSlugs ([]) as if passed an empty array.
   * Ensures the omitted-vs-empty-array edge case doesn't break.
   */
  test("REG-FIX2-003: omitting userDefaultAgentRows yields same result as passing []", () => {
    const withEmpty = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles: noRuntimeProfiles,
      userDefaultAgentRows: [],
    });

    const withOmitted = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles: noRuntimeProfiles,
    });

    for (const key of ["main", "explorer", "executor", "design"] as const) {
      const rowWithEmpty = withEmpty.find(
        (r) => r.key === key,
      ) as AgentRosterRow & { composioToolkitSlugs: string[] };
      const rowWithOmitted = withOmitted.find(
        (r) => r.key === key,
      ) as AgentRosterRow & { composioToolkitSlugs: string[] };
      expect(rowWithEmpty.composioToolkitSlugs).toEqual([]);
      expect(rowWithOmitted.composioToolkitSlugs).toEqual([]);
    }
  });
});
