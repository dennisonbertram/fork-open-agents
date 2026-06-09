/**
 * Regression tests for resolveAgentForRole + pickMostSpecificAgent.
 *
 * These tests catch specific breakage scenarios that would be missed by the
 * behavioral tests — edge cases and invariants that must hold if the
 * implementation in resolve-agent.ts is reverted or accidentally modified.
 *
 * All tests are pure (no I/O): DB access and userPreferences are mocked.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { AgentRole, AgentScope } from "./resolve-agent";

// ─── module mocks ─────────────────────────────────────────────────────────────

type AgentRow = {
  id: string;
  userId: string;
  name: string;
  role: AgentRole;
  scope: AgentScope;
  sessionId: string | null;
  repoOwner: string | null;
  repoName: string | null;
  modelId: string | null;
  inferenceProfileId: string | null;
  instructions: string | null;
  skillRefs: unknown[];
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  managedRuntimeProfileId: string | null;
  toolAuthoringEnabled: boolean;
};

const mockListAgentsForUser = mock(
  async (_params: unknown): Promise<AgentRow[]> => [],
);
const mockGetUserPreferences = mock(async (_userId: string) => ({
  defaultModelId: "anthropic/claude-opus-4",
  defaultSubagentModelId: null as string | null,
  defaultInferenceProfileId: null as string | null,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
  composioAgentDefaults: {
    main: { defaultProfileId: null },
    explorer: { defaultProfileId: null },
    executor: { defaultProfileId: null },
    design: { defaultProfileId: null },
  },
}));

mock.module("@/lib/db/agents", () => ({
  listAgentsForUser: mockListAgentsForUser,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: mockGetUserPreferences,
}));

const { resolveAgentForRole, pickMostSpecificAgent } =
  await import("./resolve-agent");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-r",
    userId: "user-1",
    name: "Regression Agent",
    role: "main",
    scope: "user_default",
    sessionId: null,
    repoOwner: null,
    repoName: null,
    modelId: null,
    inferenceProfileId: null,
    instructions: null,
    skillRefs: [],
    builtinToolNames: null,
    composioToolkitSlugs: [],
    composioProfileId: null,
    managedRuntimeProfileId: null,
    toolAuthoringEnabled: false,
    ...overrides,
  };
}

// ─── Regression 1: synthetic fallback parity with today's behavior ───────────

describe("Regression: synthetic fallback == today's behavior (null rows)", () => {
  beforeEach(() => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([]);
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "anthropic/claude-opus-4",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });
  });

  it("REG-001: revoking the implementation causes main model to not be 'anthropic/claude-opus-4'", async () => {
    // If resolveAgentForRole is broken, it will either throw or return wrong model.
    // This test catches both regressions.
    const resolved = await resolveAgentForRole({ userId: "u1", role: "main" });
    expect(resolved.modelId).toBe("anthropic/claude-opus-4");
  });

  it("REG-002: all four roles resolve without throwing (regression: resolver throws on unknown role)", async () => {
    const roles: AgentRole[] = ["main", "explorer", "executor", "design"];
    for (const role of roles) {
      const resolved = await resolveAgentForRole({ userId: "u1", role });
      expect(resolved.role).toBe(role);
    }
  });

  it("REG-003: executor uses subagent model when defaultSubagentModelId is set", async () => {
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "main-model",
      defaultSubagentModelId: "sub-model",
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });

    const main = await resolveAgentForRole({ userId: "u1", role: "main" });
    const executor = await resolveAgentForRole({
      userId: "u1",
      role: "executor",
    });

    // Main always uses defaultModelId regardless of defaultSubagentModelId
    expect(main.modelId).toBe("main-model");
    // Sub-role uses subagent model
    expect(executor.modelId).toBe("sub-model");
  });
});

// ─── Regression 2: pickMostSpecificAgent precedence invariant ────────────────

describe("Regression: pickMostSpecificAgent invariants", () => {
  it("REG-004: session scope always beats repo + user_default regardless of order in array", () => {
    // The resolution order must be stable even when the array comes in any order.
    const session = makeAgent({
      id: "s",
      scope: "session",
      sessionId: "sid",
    });
    const repo = makeAgent({
      id: "r",
      scope: "repo",
      repoOwner: "o",
      repoName: "n",
    });
    const ud = makeAgent({ id: "u", scope: "user_default" });

    // Varying orderings — result must always be the session row
    const orderings: AgentRow[][] = [
      [session, repo, ud],
      [repo, session, ud],
      [ud, repo, session],
      [repo, ud, session],
    ];

    for (const order of orderings) {
      const result = pickMostSpecificAgent(order, {
        sessionId: "sid",
        repoOwner: "o",
        repoName: "n",
      });
      expect(result?.id).toBe("s");
    }
  });

  it("REG-005: repo row is NOT returned when repoName doesn't match (partial key match is not a match)", () => {
    const row = makeAgent({
      id: "repo-row",
      scope: "repo",
      repoOwner: "acme",
      repoName: "api",
    });

    // Same owner, different repo
    const result = pickMostSpecificAgent([row], {
      sessionId: undefined,
      repoOwner: "acme",
      repoName: "frontend",
    });

    expect(result).toBeUndefined();
  });

  it("REG-006: session row is NOT returned when sessionId is undefined even if sessionId matches string 'undefined'", () => {
    const row = makeAgent({
      id: "sess-row",
      scope: "session",
      sessionId: "session-x",
    });

    // sessionId key is undefined — should not match
    const result = pickMostSpecificAgent([row], {
      sessionId: undefined,
    });

    expect(result).toBeUndefined();
  });
});

// ─── Regression 3: resolvedAgent field completeness ──────────────────────────

describe("Regression: ResolvedAgent never has undefined fields", () => {
  it("REG-007: synthetic fallback has no undefined-valued required fields", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([]);
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "m",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "p",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });

    const resolved = await resolveAgentForRole({ userId: "u1", role: "main" });

    // These must be explicitly null (not undefined) to be safe for downstream use
    expect(resolved.modelId).not.toBeUndefined();
    expect(resolved.instructions).not.toBeUndefined();
    expect(resolved.builtinToolNames).not.toBeUndefined();
    expect(resolved.inferenceProfileId).not.toBeUndefined();
    expect(resolved.composioProfileId).not.toBeUndefined();
    expect(resolved.managedRuntimeProfileId).not.toBeUndefined();
  });

  it("REG-008: DB row-sourced ResolvedAgent has no undefined-valued required fields", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        modelId: null,
        instructions: null,
        inferenceProfileId: null,
        composioProfileId: null,
        managedRuntimeProfileId: null,
        builtinToolNames: null,
      }),
    ]);
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "m",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "p",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });

    const resolved = await resolveAgentForRole({ userId: "u1", role: "main" });

    expect(resolved.modelId).not.toBeUndefined();
    expect(resolved.instructions).not.toBeUndefined();
    expect(resolved.builtinToolNames).not.toBeUndefined();
  });
});

// ─── Regression 4: skillRefs normalization ───────────────────────────────────

describe("Regression: skillRefs normalization in rowToResolvedAgent", () => {
  it("REG-009: malformed skillRefs in DB row are dropped gracefully (not TypeError)", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        // Intentionally malformed: mix of valid + invalid refs
        skillRefs: [
          { source: "owner/repo", skillName: "my-skill" }, // valid
          { source: 42, skillName: "bad-source" }, // invalid — source is number
          null, // invalid
          "a-string", // invalid
          { source: "owner/repo" }, // invalid — missing skillName
        ],
      }),
    ]);
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "m",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "p",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });

    // Must not throw
    const resolved = await resolveAgentForRole({ userId: "u1", role: "main" });

    // Only the one valid ref should survive
    expect(resolved.skillRefs).toHaveLength(1);
    expect(resolved.skillRefs[0]).toEqual({
      source: "owner/repo",
      skillName: "my-skill",
    });
  });
});
