/**
 * Regression tests for resolveComposioSlugsForChatMain and the no-row
 * parity guarantee.
 *
 * These tests catch specific failure modes that would occur if:
 * - The agent row wiring were reverted or the precedence logic changed
 * - The no-row behavior deviated from today's defaults
 * - The explicit chat selection override were lost
 *
 * All tests are pure (no I/O). They must pass and continue to pass
 * as long as the implementation of a15326fc is present.
 */

import { describe, expect, it } from "bun:test";
import { resolveComposioSlugsForChatMain } from "./resolve-chat-with-agent-row";

// ── REG-C-001: No-row parity — the output must be identical to pre-Phase-3 ──

describe("REGRESSION: no-row behavior is byte-for-byte identical to before Phase 3", () => {
  it("REG-C-001: null + null + null + null → {directSlugs: null, profileId: null}", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
    });
    // Before Phase 3: directSlugs was derived from chat.composioSelection.directToolkitSlugs
    // (null when not set), and profileId from chat.composioSelection.mainProfileId (null).
    // After Phase 3 with no agent row: same result.
    expect(result.directSlugs).toBeNull();
    expect(result.profileId).toBeNull();
  });

  it("REG-C-001b: empty agent slugs + no profile → same as null (no tools)", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: [],
      agentRowComposioProfileId: null,
    });
    // Synthetic fallback returns composioToolkitSlugs: [] which is "empty"
    // — must not be treated as a selection
    expect(result.directSlugs).toBeNull();
    expect(result.profileId).toBeNull();
  });

  it("REG-C-001c: function returns exactly {directSlugs, profileId} — no extra fields", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
    });
    // Only these two keys should be present
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["directSlugs", "profileId"]);
  });
});

// ── REG-C-002: Explicit chat selection always wins ────────────────────────────

describe("REGRESSION: explicit per-chat selection overrides agent row", () => {
  it("REG-C-002: chat directSlugs wins even when agent row has different slugs", () => {
    // If this fails, the agent row would silently override explicit user selections
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: ["notion"],
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github", "linear", "slack"],
      agentRowComposioProfileId: null,
    });
    expect(result.directSlugs).toEqual(["notion"]);
    expect(result.profileId).toBeNull();
  });

  it("REG-C-002b: chat mainProfileId wins over agent row slugs", () => {
    // If this fails, the agent row slugs would silently override a saved profile
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: "my-saved-profile",
      agentRowComposioSlugs: ["github", "linear"],
      agentRowComposioProfileId: "agent-profile",
    });
    expect(result.profileId).toBe("my-saved-profile");
    expect(result.directSlugs).toBeNull();
  });

  it("REG-C-002c: single chat direct slug wins over many agent row slugs", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: ["slack"],
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github", "linear", "notion", "jira"],
      agentRowComposioProfileId: null,
    });
    expect(result.directSlugs).toEqual(["slack"]);
  });
});

// ── REG-C-003: Agent row used when chat has no selection ──────────────────────

describe("REGRESSION: agent row fills in when chat has no explicit selection", () => {
  it("REG-C-003: agent row slugs are used as default when chat has null selections", () => {
    // If this fails, users who configured agent row tools would not see them in chat
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github", "linear"],
      agentRowComposioProfileId: null,
    });
    expect(result.directSlugs).toEqual(["github", "linear"]);
  });

  it("REG-C-003b: agent row profile id is used as default when chat has no selection and no slugs", () => {
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: "default-agent-profile",
    });
    expect(result.profileId).toBe("default-agent-profile");
    expect(result.directSlugs).toBeNull();
  });

  it("REG-C-003c: agent row slugs take precedence over agent row profileId", () => {
    // If both are set on the row, slugs win (matching the one-wins rule for chat)
    const result = resolveComposioSlugsForChatMain({
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "some-profile",
    });
    expect(result.directSlugs).toEqual(["github"]);
    // profileId should be null when directSlugs is active
    expect(result.profileId).toBeNull();
  });
});

// ── REG-C-004: agents-roster toolsLabel display ───────────────────────────────

describe("REGRESSION: buildAgentRoster toolsLabel for user_default rows", () => {
  it("REG-C-004: reverted userDefaultAgentRows support causes toolsCustom to always be false", async () => {
    // Import pure builder to test
    const { buildAgentRoster } =
      await import("@/app/settings/agents/agents-roster");

    const rows = buildAgentRoster({
      preferences: {
        defaultModelId: "anthropic/claude-opus-4-5",
        defaultSubagentModelId: null,
        defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      },
      composioDefaults: {
        main: { defaultProfileId: null, allowChatOverride: true },
        explorer: { defaultProfileId: null, allowChatOverride: false },
        executor: { defaultProfileId: null, allowChatOverride: false },
        design: { defaultProfileId: null, allowChatOverride: false },
      },
      runtimeProfiles: [],
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: "openai/gpt-5.4",
          composioToolkitSlugs: ["github", "linear"],
          instructions: "Be efficient.",
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });

    const main = rows.find((r) => r.key === "main");
    // All three custom flags must be true for the main row
    expect(main?.modelCustom).toBe(true);
    expect(main?.toolsCustom).toBe(true);
    expect(main?.instructionsCustom).toBe(true);
    // Other roles must remain not custom
    for (const role of ["explorer", "executor", "design"] as const) {
      const row = rows.find((r) => r.key === role);
      expect(row?.modelCustom).toBe(false);
      expect(row?.toolsCustom).toBe(false);
      expect(row?.instructionsCustom).toBe(false);
    }
  });
});

// ── REG-C-005: API mapper schema must reject missing role ─────────────────────

describe("REGRESSION: agentPatchSchema rejects invalid input", () => {
  it("REG-C-005: agentPatchSchema rejects a body with no role (regression: missing validation)", async () => {
    // If this fails, the schema was removed or weakened, and any body would be accepted
    const { agentPatchSchema } =
      await import("@/app/api/settings/agents/agents-api-mapper");
    const result = agentPatchSchema.safeParse({ modelId: "some-model" });
    expect(result.success).toBe(false);
  });

  it("REG-C-005b: agentPatchSchema rejects invalid role (regression: no enum validation)", async () => {
    const { agentPatchSchema } =
      await import("@/app/api/settings/agents/agents-api-mapper");
    const result = agentPatchSchema.safeParse({ role: "coordinator" });
    expect(result.success).toBe(false);
  });
});
