/**
 * Tests for resolveAgentForRole — BT-001 through BT-006
 *
 * All tests are PURE (no I/O): the DB access and userPreferences modules are
 * injected via mocks so the resolver logic is tested in isolation.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { AgentRole, AgentScope } from "./resolve-agent";

// ─── module mocks ─────────────────────────────────────────────────────────────
// We mock the two I/O modules before importing the resolver so the resolver
// picks up the mocked versions at import time.

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
  githubToolsEnabled: boolean;
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

// ─── import after mocking ────────────────────────────────────────────────────
const { resolveAgentForRole, pickMostSpecificAgent } =
  await import("./resolve-agent");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Test Agent",
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
    githubToolsEnabled: false,
    ...overrides,
  };
}

// ─── BT-001: pure pickMostSpecificAgent — session > repo > user_default ──────

describe("pickMostSpecificAgent (pure helper)", () => {
  it("BT-001: prefers session scope over repo scope over user_default", () => {
    const userDefaultRow = makeAgent({ id: "ud", scope: "user_default" });
    const repoRow = makeAgent({
      id: "repo",
      scope: "repo",
      repoOwner: "acme",
      repoName: "api",
    });
    const sessionRow = makeAgent({
      id: "sess",
      scope: "session",
      sessionId: "session-x",
    });

    const result = pickMostSpecificAgent(
      [userDefaultRow, repoRow, sessionRow],
      {
        sessionId: "session-x",
        repoOwner: "acme",
        repoName: "api",
      },
    );

    expect(result?.id).toBe("sess");
  });

  it("BT-001b: prefers repo scope when no session row exists", () => {
    const userDefaultRow = makeAgent({ id: "ud", scope: "user_default" });
    const repoRow = makeAgent({
      id: "repo",
      scope: "repo",
      repoOwner: "acme",
      repoName: "api",
    });

    const result = pickMostSpecificAgent([userDefaultRow, repoRow], {
      sessionId: undefined,
      repoOwner: "acme",
      repoName: "api",
    });

    expect(result?.id).toBe("repo");
  });

  it("BT-001c: falls back to user_default when no session/repo rows exist", () => {
    const userDefaultRow = makeAgent({ id: "ud", scope: "user_default" });

    const result = pickMostSpecificAgent([userDefaultRow], {
      sessionId: undefined,
      repoOwner: undefined,
      repoName: undefined,
    });

    expect(result?.id).toBe("ud");
  });

  it("BT-001d: returns undefined when rows array is empty", () => {
    const result = pickMostSpecificAgent([], {
      sessionId: undefined,
      repoOwner: undefined,
      repoName: undefined,
    });

    expect(result).toBeUndefined();
  });

  it("BT-001e: repo row only matches when repoOwner+repoName match the lookup keys", () => {
    const repoRow = makeAgent({
      id: "repo-other",
      scope: "repo",
      repoOwner: "other-org",
      repoName: "other-repo",
    });

    // lookup is for a different repo — should NOT return the repo row
    const result = pickMostSpecificAgent([repoRow], {
      sessionId: undefined,
      repoOwner: "acme",
      repoName: "api",
    });

    expect(result).toBeUndefined();
  });

  it("BT-001f: session row only matches when sessionId matches", () => {
    const sessionRow = makeAgent({
      id: "sess-other",
      scope: "session",
      sessionId: "session-other",
    });

    // lookup is for a different session — should NOT return the session row
    const result = pickMostSpecificAgent([sessionRow], {
      sessionId: "session-x",
      repoOwner: undefined,
      repoName: undefined,
    });

    expect(result).toBeUndefined();
  });
});

// ─── BT-002: resolveAgentForRole — synthetic fallback when zero rows ──────────

describe("resolveAgentForRole — synthetic fallback (no DB rows)", () => {
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

  it("BT-002: main role synthetic fallback uses defaultModelId from prefs", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.modelId).toBe("anthropic/claude-opus-4");
  });

  it("BT-002b: sub-role (explorer) fallback uses defaultSubagentModelId when set", async () => {
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "anthropic/claude-opus-4",
      defaultSubagentModelId: "anthropic/claude-haiku-4.5",
      defaultInferenceProfileId: null,
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      composioAgentDefaults: {
        main: { defaultProfileId: null },
        explorer: { defaultProfileId: null },
        executor: { defaultProfileId: null },
        design: { defaultProfileId: null },
      },
    });

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
    });

    expect(resolved.modelId).toBe("anthropic/claude-haiku-4.5");
  });

  it("BT-002c: sub-role falls back to main defaultModelId when defaultSubagentModelId is null", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "executor",
    });

    // No subagent model set, so inherits main model
    expect(resolved.modelId).toBe("anthropic/claude-opus-4");
  });

  it("BT-002d: synthetic fallback managedRuntimeProfileId comes from prefs", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.managedRuntimeProfileId).toBe("web-bun-agent-browser");
  });

  it("BT-002e: synthetic fallback has empty composioToolkitSlugs", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.composioToolkitSlugs).toEqual([]);
  });

  it("BT-002f: synthetic fallback has null instructions (role default)", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.instructions).toBeNull();
  });

  it("BT-002g: synthetic fallback has null builtinToolNames (role default policy)", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.builtinToolNames).toBeNull();
  });

  it("BT-002h: synthetic fallback has toolAuthoringEnabled=false", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.toolAuthoringEnabled).toBe(false);
  });

  it("BT-002i: synthetic fallback preserves the role in the returned value", async () => {
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "design",
    });

    expect(resolved.role).toBe("design");
  });
});

// ─── BT-003: resolveAgentForRole — DB row wins over synthetic fallback ────────

describe("resolveAgentForRole — DB row overrides synthetic fallback", () => {
  beforeEach(() => {
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

  it("BT-003: user_default DB row overrides the synthetic fallback model", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "custom-main",
        role: "main",
        scope: "user_default",
        modelId: "openai/gpt-5.4",
        instructions: "Be concise.",
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    expect(resolved.modelId).toBe("openai/gpt-5.4");
    expect(resolved.instructions).toBe("Be concise.");
  });

  it("BT-003b: session-scoped row beats user_default row", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "session-row",
        role: "main",
        scope: "session",
        sessionId: "session-abc",
        modelId: "openai/gpt-4o",
        instructions: "Session-specific instructions.",
      }),
      makeAgent({
        id: "user-default-row",
        role: "main",
        scope: "user_default",
        modelId: "anthropic/claude-opus-4",
        instructions: "Default instructions.",
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
      sessionId: "session-abc",
    });

    expect(resolved.modelId).toBe("openai/gpt-4o");
    expect(resolved.instructions).toBe("Session-specific instructions.");
  });

  it("BT-003c: repo-scoped row beats user_default row", async () => {
    mockListAgentsForUser.mockReset();
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "repo-row",
        role: "main",
        scope: "repo",
        repoOwner: "acme",
        repoName: "api",
        modelId: "openai/gpt-5.4",
        composioToolkitSlugs: ["github", "linear"],
      }),
      makeAgent({
        id: "user-default-row",
        role: "main",
        scope: "user_default",
        modelId: "anthropic/claude-opus-4",
        composioToolkitSlugs: [],
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
      repoOwner: "acme",
      repoName: "api",
    });

    expect(resolved.modelId).toBe("openai/gpt-5.4");
    expect(resolved.composioToolkitSlugs).toEqual(["github", "linear"]);
  });
});

// ─── BT-004: resolveAgentForRole — full cascade session > repo > user_default > fallback

describe("resolveAgentForRole — full 4-level cascade", () => {
  it("BT-004: session > repo > user_default > synthetic, returns most specific match", async () => {
    mockListAgentsForUser.mockReset();
    // Only repo and user_default rows — no session row matching "session-abc"
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "repo-row",
        role: "main",
        scope: "repo",
        repoOwner: "acme",
        repoName: "api",
        modelId: "repo-model",
      }),
      makeAgent({
        id: "user-default-row",
        role: "main",
        scope: "user_default",
        modelId: "default-model",
      }),
    ]);
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "fallback-model",
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

    // sessionId provided but no matching session row → falls to repo
    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
      sessionId: "session-abc",
      repoOwner: "acme",
      repoName: "api",
    });

    expect(resolved.modelId).toBe("repo-model");
  });
});

// ─── BT-005: ResolvedAgent shape ──────────────────────────────────────────────

describe("resolveAgentForRole — ResolvedAgent shape", () => {
  it("BT-005: ResolvedAgent always has all required fields", async () => {
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

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "main",
    });

    // Check all required fields exist in the resolved shape
    expect(typeof resolved.role).toBe("string");
    expect(typeof resolved.toolAuthoringEnabled).toBe("boolean");
    expect(Array.isArray(resolved.composioToolkitSlugs)).toBe(true);
    expect(Array.isArray(resolved.skillRefs)).toBe(true);
    // nullable fields are explicitly present (not undefined)
    expect("modelId" in resolved).toBe(true);
    expect("inferenceProfileId" in resolved).toBe(true);
    expect("instructions" in resolved).toBe(true);
    expect("builtinToolNames" in resolved).toBe(true);
    expect("composioProfileId" in resolved).toBe(true);
    expect("managedRuntimeProfileId" in resolved).toBe(true);
  });
});

// ─── BT-008: rowToResolvedAgent preserves the profile embedded in a composite modelId

describe("resolveAgentForRole — DB row composite modelId preserves the profile", () => {
  // #1155 finding 2 (P1): the Settings -> Agents picker persists a
  // "User model" selection as `user-profile:<profileId>:<modelId>` into
  // agents.model_id, and the PATCH path does NOT populate the row's separate
  // inferenceProfileId column. The composite is the ONLY carrier of the
  // profile reference for a DB-row agent. rowToResolvedAgent already stripped
  // the composite down to the bare modelId (mirroring the synthetic-fallback
  // branch's parseModelOptionSelection call) but discarded the profile half —
  // so a bare modelId that happens to collide with a real gateway catalog id
  // (e.g. an Anthropic model) would silently route through the Vercel gateway
  // instead of the user's own profile and key.
  beforeEach(() => {
    mockListAgentsForUser.mockReset();
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

  it("BT-008a: a composite row.modelId yields BOTH the bare model id and the profile id", async () => {
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "row-composite",
        role: "explorer",
        scope: "user_default",
        modelId: "user-profile:profile-xyz:claude-opus-4",
        inferenceProfileId: null,
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
    });

    expect(resolved.modelId).toBe("claude-opus-4");
    expect(resolved.inferenceProfileId).toBe("profile-xyz");
  });

  it("BT-008b: a plain gateway row.modelId is unchanged and does not invent a profile", async () => {
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "row-plain",
        role: "executor",
        scope: "user_default",
        modelId: "openai/gpt-5.4",
        inferenceProfileId: null,
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "executor",
    });

    expect(resolved.modelId).toBe("openai/gpt-5.4");
    expect(resolved.inferenceProfileId).toBeNull();
  });

  it("BT-008c: an explicit row.inferenceProfileId wins over a composite-embedded one", async () => {
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "row-explicit",
        role: "design",
        scope: "user_default",
        modelId: "user-profile:profile-embedded:claude-opus-4",
        inferenceProfileId: "profile-explicit",
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "design",
    });

    expect(resolved.modelId).toBe("claude-opus-4");
    expect(resolved.inferenceProfileId).toBe("profile-explicit");
  });
});

// ─── BT-006: listAgentsForUser is called with correct userId ──────────────────

describe("resolveAgentForRole — data-access contract", () => {
  it("BT-006: passes userId to listAgentsForUser", async () => {
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

    await resolveAgentForRole({ userId: "user-42", role: "main" });

    // The first call's first argument should include the userId
    const firstCallArg = mockListAgentsForUser.mock.calls[0]?.[0] as {
      userId: string;
    };
    expect(firstCallArg?.userId).toBe("user-42");
  });
});

// ─── BT-007: fromDbRow discriminator on ResolvedAgent ────────────────────────
// These tests verify the PARAMOUNT INVARIANT FIX: ResolvedAgent now carries a
// fromDbRow boolean so chat.ts can skip modelId in roster entries that come
// from the synthetic prefs fallback (no real agents rows).

describe("resolveAgentForRole — fromDbRow discriminator", () => {
  beforeEach(() => {
    mockListAgentsForUser.mockReset();
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "anthropic/claude-opus-4",
      defaultSubagentModelId: "anthropic/claude-haiku-4.5",
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

  it("BT-007a: synthetic fallback (no rows) sets fromDbRow=false", async () => {
    // When no DB rows exist, the result must mark fromDbRow as false so
    // chat.ts knows NOT to include modelId in the roster entry.
    mockListAgentsForUser.mockResolvedValue([]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
    });

    // fromDbRow must exist and be false for the synthetic path
    expect((resolved as { fromDbRow?: boolean }).fromDbRow).toBe(false);
  });

  it("BT-007b: DB row resolution sets fromDbRow=true", async () => {
    // When a real DB row is matched, fromDbRow must be true so that
    // chat.ts includes modelId in the roster entry (only for explicit rows).
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "real-row",
        role: "explorer",
        scope: "user_default",
        modelId: "openai/gpt-5.4",
        instructions: null,
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
    });

    expect((resolved as { fromDbRow?: boolean }).fromDbRow).toBe(true);
  });

  it("BT-007c: synthetic fallback with non-null subagent model still has fromDbRow=false", async () => {
    // Even when defaultSubagentModelId is set in prefs, the resolution is
    // still synthetic — fromDbRow must be false, NOT true.
    mockListAgentsForUser.mockResolvedValue([]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "executor",
    });

    // modelId comes from prefs defaultSubagentModelId
    expect(resolved.modelId).toBe("anthropic/claude-haiku-4.5");
    // but it must NOT claim it came from a DB row
    expect((resolved as { fromDbRow?: boolean }).fromDbRow).toBe(false);
  });
});

// ─── REGRESSION: fromDbRow must survive all resolution paths ─────────────────
// If a future refactor accidentally removes fromDbRow or changes its value,
// the PARAMOUNT INVARIANT in chat.ts breaks silently: the roster would carry a
// modelId that lacks providerOptionsOverrides, dropping model-variant config.

describe("resolveAgentForRole — regression: fromDbRow invariant across paths", () => {
  beforeEach(() => {
    mockListAgentsForUser.mockReset();
    mockGetUserPreferences.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      defaultModelId: "anthropic/claude-opus-4",
      defaultSubagentModelId: "anthropic/claude-haiku-4.5",
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

  it("regression: session-scoped DB row has fromDbRow=true (coverage of all scope paths)", async () => {
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "sess-row",
        role: "explorer",
        scope: "session",
        sessionId: "session-abc",
        modelId: "openai/gpt-4o",
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
      sessionId: "session-abc",
    });

    expect(resolved.modelId).toBe("openai/gpt-4o");
    expect((resolved as { fromDbRow?: boolean }).fromDbRow).toBe(true);
  });

  it("regression: repo-scoped DB row has fromDbRow=true", async () => {
    mockListAgentsForUser.mockResolvedValue([
      makeAgent({
        id: "repo-row",
        role: "executor",
        scope: "repo",
        repoOwner: "acme",
        repoName: "api",
        modelId: "openai/gpt-5.4",
      }),
    ]);

    const resolved = await resolveAgentForRole({
      userId: "user-1",
      role: "executor",
      repoOwner: "acme",
      repoName: "api",
    });

    expect(resolved.modelId).toBe("openai/gpt-5.4");
    expect((resolved as { fromDbRow?: boolean }).fromDbRow).toBe(true);
  });

  it("regression: synthetic fallback fromDbRow=false even when all prefs model fields are set", async () => {
    // Maximum-prefs scenario: both defaultModelId and defaultSubagentModelId are
    // set (the exact case mentioned in the finding). The fallback must still be
    // fromDbRow=false so the roster is not threaded.
    mockListAgentsForUser.mockResolvedValue([]);

    const resolvedExplorer = await resolveAgentForRole({
      userId: "user-1",
      role: "explorer",
    });
    const resolvedExecutor = await resolveAgentForRole({
      userId: "user-1",
      role: "executor",
    });
    const resolvedDesign = await resolveAgentForRole({
      userId: "user-1",
      role: "design",
    });

    // All sub-roles get the subagent model from prefs — but fromDbRow stays false
    expect(resolvedExplorer.modelId).toBe("anthropic/claude-haiku-4.5");
    expect(resolvedExecutor.modelId).toBe("anthropic/claude-haiku-4.5");
    expect(resolvedDesign.modelId).toBe("anthropic/claude-haiku-4.5");

    expect((resolvedExplorer as { fromDbRow?: boolean }).fromDbRow).toBe(false);
    expect((resolvedExecutor as { fromDbRow?: boolean }).fromDbRow).toBe(false);
    expect((resolvedDesign as { fromDbRow?: boolean }).fromDbRow).toBe(false);
  });
});
