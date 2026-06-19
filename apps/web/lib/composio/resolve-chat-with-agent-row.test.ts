/**
 * Part C regression tests: chat MAIN run sources defaults from resolveAgentForRole
 * while preserving byte-for-byte behavior when no agents row exists.
 *
 * Tests the pure helper resolveComposioSlugsForChatMain that wraps the
 * precedence logic:
 *   1. explicit per-chat directToolkitSlugs  → wins over agent row
 *   2. explicit per-chat mainProfileId       → wins over agent row
 *   3. agent row composioToolkitSlugs        → used as default when no explicit selection
 *   4. no agents row + no explicit selection → exactly original behavior (empty)
 *
 * No I/O. The helper is a pure function extracted for testability.
 */

import { describe, expect, it } from "bun:test";
import {
  resolveComposioSlugsForChatMain,
  type ChatMainComposioInput,
} from "./resolve-chat-with-agent-row";

// ── BT-C-001: No agent row, no explicit selection → empty (today's behavior) ──

describe("resolveComposioSlugsForChatMain — no-row parity", () => {
  it("BT-C-001: with no agent row AND no explicit chat selection, returns null profile + empty slugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toBeNull();
    expect(result.profileId).toBeNull();
  });

  it("BT-C-001b: empty agent row slugs + no explicit selection → same as no row", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: [],
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toBeNull();
    expect(result.profileId).toBeNull();
  });
});

// ── Repo/workspace-level selection — lowest-precedence fallback ────────────────

describe("resolveComposioSlugsForChatMain — repo-level fallback", () => {
  it("applies repoSelectedSlugs when nothing else is selected", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
      repoSelectedSlugs: ["github"],
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["github"]);
    expect(result.profileId).toBeNull();
  });

  it("explicit per-chat selection still wins over repo slugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: ["linear"],
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
      repoSelectedSlugs: ["github"],
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["linear"]);
  });

  it("agent row still wins over repo slugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["slack"],
      agentRowComposioProfileId: null,
      repoSelectedSlugs: ["github"],
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["slack"]);
  });

  it("empty repo slugs → no tools (today's behavior)", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: null,
      repoSelectedSlugs: [],
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toBeNull();
    expect(result.profileId).toBeNull();
  });
});

// ── BT-C-002: Explicit per-chat directSlugs WINS over agent row ───────────────

describe("resolveComposioSlugsForChatMain — explicit chat selection wins", () => {
  it("BT-C-002: chat directToolkitSlugs wins over agent row composioToolkitSlugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: ["slack"],
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github", "linear"],
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["slack"]);
    expect(result.profileId).toBeNull();
  });

  it("BT-C-002b: chat mainProfileId wins over agent row composioToolkitSlugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: "profile-xyz",
      agentRowComposioSlugs: ["github", "linear"],
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.profileId).toBe("profile-xyz");
    expect(result.directSlugs).toBeNull();
  });

  it("BT-C-002c: both explicit chat selection and agent row — chat wins", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: ["notion"],
      chatMainProfileId: "chat-profile",
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile",
    };
    const result = resolveComposioSlugsForChatMain(input);
    // directSlugs wins over profileId (one-wins rule), and chat wins over agent
    expect(result.directSlugs).toEqual(["notion"]);
  });
});

// ── BT-C-003: Agent row used as default when chat has no explicit selection ───

describe("resolveComposioSlugsForChatMain — agent row as default", () => {
  it("BT-C-003: agent row composioToolkitSlugs used when chat has no explicit selection", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github", "linear"],
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["github", "linear"]);
    expect(result.profileId).toBeNull();
  });

  it("BT-C-003b: agent row composioProfileId used when chat has no explicit selection and no slugs", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: null,
      agentRowComposioProfileId: "agent-profile-id",
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.profileId).toBe("agent-profile-id");
    expect(result.directSlugs).toBeNull();
  });

  it("BT-C-003c: agent row slugs win over agent row profileId (slugs take precedence)", () => {
    const input: ChatMainComposioInput = {
      chatDirectSlugs: null,
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: "agent-profile-id",
    };
    const result = resolveComposioSlugsForChatMain(input);
    expect(result.directSlugs).toEqual(["github"]);
    // profileId should not be set when directSlugs takes precedence
    expect(result.profileId).toBeNull();
  });
});

// ── BT-C-004: Regression — explicit empty array is NOT treated as "no selection"

describe("resolveComposioSlugsForChatMain — empty array edge case", () => {
  it("BT-C-004: explicit empty chatDirectSlugs array is treated as null (no selection)", () => {
    // The chat composio selection doesn't store empty arrays as meaningful —
    // null and [] are both treated as "no selection" at the chat level.
    // This is the existing behavior that must not change.
    const input: ChatMainComposioInput = {
      chatDirectSlugs: [], // empty array = same as null
      chatMainProfileId: null,
      agentRowComposioSlugs: ["github"],
      agentRowComposioProfileId: null,
    };
    const result = resolveComposioSlugsForChatMain(input);
    // Empty chat slugs should not block agent row from being used
    expect(result.directSlugs).toEqual(["github"]);
  });
});
