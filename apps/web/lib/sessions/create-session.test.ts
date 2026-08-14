/**
 * Unit tests for resolveSessionBranches (#1251).
 *
 * Before this fix, createSessionCore's new-branch path called
 * generateBranchName() and never read input.branch at all — a session
 * created with isNewBranch: true and branch: "develop" was cloned from the
 * repository's default branch, not develop.
 *
 * BT-1251-01: isNewBranch true + a caller-supplied branch keeps it as the
 *   base while generating a different working branch name.
 * BT-1251-02: isNewBranch true + no caller branch falls back to the repo's
 *   default branch as the base (today's fallback chain, preserved).
 * BT-1251-03: isNewBranch true + no caller branch + no repo default base
 *   branch is null — no retroactive behavior invented for the fully-unset case.
 * BT-1251-04 (regression): isNewBranch false never sets a base branch,
 *   whatever `branch`/repo default resolve to.
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── createSessionCore's own dependencies, mocked for the end-to-end wiring
// regression below. resolveSessionBranches' own unit tests above don't need
// any of this — createSessionCore does, since it pulls all of these in.
const isComposioProfileAllowedForRepository = mock(async () => ({
  allowed: true,
}));
mock.module("@/lib/db/composio", () => ({
  isComposioProfileAllowedForRepository,
}));

const capturedSessionInserts: Record<string, unknown>[] = [];
const createSessionWithInitialChat = mock(
  async (input: { session: Record<string, unknown> }) => {
    capturedSessionInserts.push(input.session);
    return {
      session: { id: "session-1", ...input.session },
      chat: { id: "chat-1", sessionId: "session-1" },
    };
  },
);
const getUsedSessionTitles = mock(async () => new Set<string>());
mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat,
  getUsedSessionTitles,
}));

const getUserPreferences = mock(async () => ({
  autoCommitPush: false,
  autoCreatePr: false,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
  defaultInferenceProfileId: null,
  defaultModelId: "test-model",
  globalSkillRefs: [],
  composioAgentDefaults: { main: { defaultProfileId: null } },
}));
mock.module("@/lib/db/user-preferences", () => ({ getUserPreferences }));

let repoDefaultsResult: { defaultBranch: string | null } | null = null;
const resolveRepoDefaults = mock(async () => repoDefaultsResult);
mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults,
}));

const kickSandboxPrewarmWorkflow = mock(() => undefined);
mock.module("@/lib/sandbox/prewarm-kick", () => ({
  kickSandboxPrewarmWorkflow,
}));

const { resolveSessionBranches, createSessionCore } =
  await import("./create-session");

describe("resolveSessionBranches", () => {
  test("BT-1251-01: keeps the caller's branch as the base while generating a distinct working branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: "develop",
      repoDefaultBranch: "main",
      username: "dennison",
      name: "Dennison",
    });

    expect(result.baseBranch).toBe("develop");
    expect(result.branch).not.toBe("develop");
    expect(result.branch).toBeTruthy();
  });

  test("BT-1251-02: falls back to the repo default branch as the base when the caller names none", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: undefined,
      repoDefaultBranch: "develop",
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBe("develop");
    expect(result.branch).not.toBe("develop");
  });

  test("BT-1251-03: base is null when neither the caller nor the repo settings name a branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: undefined,
      repoDefaultBranch: null,
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBeNull();
  });

  test("BT-1251-04 regression: isNewBranch false never sets a base branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: false,
      inputBranch: "develop",
      repoDefaultBranch: "main",
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBeNull();
    expect(result.branch).toBe("develop");
  });
});

describe("createSessionCore (#1251 end-to-end wiring regression)", () => {
  // resolveSessionBranches' own unit tests above prove the pure resolution
  // logic; this proves it actually reaches the DB insert — a wiring bug
  // (e.g. forgetting to spread `baseBranch` into the session values) would
  // pass every test above and still ship #1246's original defect.
  test("regression: baseBranch reaches the session row createSessionWithInitialChat receives", async () => {
    repoDefaultsResult = { defaultBranch: "main" };
    capturedSessionInserts.length = 0;

    await createSessionCore({
      userId: "user-1",
      username: "dennison",
      repoOwner: "acme",
      repoName: "widgets",
      branch: "develop",
      isNewBranch: true,
    });

    const inserted = capturedSessionInserts[0];
    expect(inserted?.baseBranch).toBe("develop");
    expect(inserted?.branch).not.toBe("develop");
    expect(inserted?.isNewBranch).toBe(true);
  });

  test("regression: isNewBranch false never persists a baseBranch, even with a repo default configured", async () => {
    repoDefaultsResult = { defaultBranch: "main" };
    capturedSessionInserts.length = 0;

    await createSessionCore({
      userId: "user-1",
      username: "dennison",
      repoOwner: "acme",
      repoName: "widgets",
      branch: "develop",
      isNewBranch: false,
    });

    const inserted = capturedSessionInserts[0];
    expect(inserted?.baseBranch).toBeNull();
    expect(inserted?.branch).toBe("develop");
  });
});
