/**
 * Tests for Fix 1 (schema uniqueIndex) and Fix 2 (editor pre-population).
 *
 * Fix 1 (BT-FIX1-001): agents_user_default_role_scope_idx must be uniqueIndex in schema
 *   so that ON CONFLICT in upsertUserDefaultAgent resolves to the correct row
 *   rather than throwing "no unique or exclusion constraint".
 *
 * Fix 2 (BT-FIX2-001, BT-FIX2-002): AgentRosterRow must carry raw
 *   composioToolkitSlugs so the editor can pre-populate without data loss
 *   on Save. The buildAgentRoster function must thread those raw slugs
 *   through to the returned row.
 */

import { describe, expect, test } from "bun:test";
import { buildAgentRoster } from "./agents-roster";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

const runtimeProfiles: ManagedRuntimeProfile[] = [];

// ── Fix 1: schema uniqueIndex ─────────────────────────────────────────────────

describe("Fix 1: agents_user_default_role_scope_idx must be uniqueIndex", () => {
  /**
   * BT-FIX1-001: The Drizzle schema must declare agents_user_default_role_scope_idx
   * using uniqueIndex() so that ON CONFLICT in
   * upsertUserDefaultAgent has a matching unique constraint.
   */
  test("BT-FIX1-001: agents table user-default index is a uniqueIndex", async () => {
    const { agents } = await import("@/lib/db/schema");

    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(agents);

    const userDefaultIdx = config.indexes.find(
      (idx) => idx.config.name === "agents_user_default_role_scope_idx",
    );
    const lookupIdx = config.indexes.find(
      (idx) => idx.config.name === "agents_user_role_scope_idx",
    );

    expect(userDefaultIdx).toBeDefined();
    expect(userDefaultIdx?.config.unique).toBe(true);
    expect(userDefaultIdx?.config.where).toBeDefined();
    expect(lookupIdx).toBeDefined();
    expect(lookupIdx?.config.unique).toBe(false);
  });
});

// ── Fix 2: AgentRosterRow carries raw composioToolkitSlugs ───────────────────

describe("Fix 2: AgentRosterRow carries raw composioToolkitSlugs for editor pre-population", () => {
  /**
   * BT-FIX2-001: When a user_default agent row has composioToolkitSlugs,
   * the built AgentRosterRow must expose those raw slugs as composioToolkitSlugs
   * so the AgentEditor can initialize its state from them, not from [].
   */
  test("BT-FIX2-001: user_default row composioToolkitSlugs are threaded to the roster row", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: ["github", "linear"],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    const main = rows.find((r) => r.key === "main");
    // This assertion fails until AgentRosterRow gains a composioToolkitSlugs field
    // and buildAgentRoster threads the raw slugs through.
    expect(main).toHaveProperty("composioToolkitSlugs");
    expect(
      (main as AgentRosterRow & { composioToolkitSlugs: string[] })
        .composioToolkitSlugs,
    ).toEqual(["github", "linear"]);
  });

  /**
   * BT-FIX2-002: When there is no user_default row (or the row has an empty
   * slug array), composioToolkitSlugs on the roster row must be [] — not
   * undefined — so the editor always initializes to a defined array.
   */
  test("BT-FIX2-002: composioToolkitSlugs is [] when no user_default row exists", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [],
    });

    for (const row of rows) {
      // This assertion fails until the field is added to the row shape
      expect(row).toHaveProperty("composioToolkitSlugs");
      expect(
        (row as AgentRosterRow & { composioToolkitSlugs: string[] })
          .composioToolkitSlugs,
      ).toEqual([]);
    }
  });

  /**
   * BT-FIX2-003: When a user_default row has a non-null modelId that is NOT
   * in the hardcoded list (e.g. "anthropic/claude-opus-4-8"), the roster row
   * must carry that modelId so the editor can initialize correctly.
   * (The model field already exists; this tests that an out-of-list model
   * is preserved in buildAgentRoster output.)
   */
  test("BT-FIX2-003: roster row model reflects any saved modelId, including out-of-list values", () => {
    const outOfListModel = "anthropic/claude-opus-4-8";
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: outOfListModel,
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    const main = rows.find((r) => r.key === "main");
    // This already passes per existing buildAgentRoster logic — it must not regress
    expect(main?.model).toBe(outOfListModel);
    expect(main?.modelCustom).toBe(true);
  });
});

// Type alias for clarity in tests — import from the module
type AgentRosterRow = import("./agents-roster").AgentRosterRow;
