import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalAllowedRepos = process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
const originalMaxTurns = process.env.BACKGROUND_AGENT_MAX_TURNS;
const originalMaxStaleTurns = process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
const originalRepetitionThreshold =
  process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD;
const originalStallGraceTurns = process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS;
const originalStallFinalizeTurns =
  process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
const originalMaxRunTokens = process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS;
const modulePromise = import("./config");

describe("background agent config", () => {
  afterEach(() => {
    if (originalAllowedRepos === undefined) {
      delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    } else {
      process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = originalAllowedRepos;
    }
    if (originalMaxTurns === undefined) {
      delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    } else {
      process.env.BACKGROUND_AGENT_MAX_TURNS = originalMaxTurns;
    }
    if (originalMaxStaleTurns === undefined) {
      delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    } else {
      process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = originalMaxStaleTurns;
    }
    if (originalRepetitionThreshold === undefined) {
      delete process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD;
    } else {
      process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD =
        originalRepetitionThreshold;
    }
    if (originalStallGraceTurns === undefined) {
      delete process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS;
    } else {
      process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = originalStallGraceTurns;
    }
    if (originalStallFinalizeTurns === undefined) {
      delete process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
    } else {
      process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS =
        originalStallFinalizeTurns;
    }
    if (originalMaxRunTokens === undefined) {
      delete process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS;
    } else {
      process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = originalMaxRunTokens;
    }
  });

  test("allows all repos when no allowlist is configured", async () => {
    const { getBackgroundAgentsAllowedRepos, isBackgroundAgentRepoAllowed } =
      await modulePromise;
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;

    expect(getBackgroundAgentsAllowedRepos()).toBeNull();
    expect(isBackgroundAgentRepoAllowed("Acme", "Widgets")).toBe(true);
  });

  test("allows all repos when wildcard is configured", async () => {
    const { getBackgroundAgentsAllowedRepos, isBackgroundAgentRepoAllowed } =
      await modulePromise;
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";

    expect(getBackgroundAgentsAllowedRepos()).toBeNull();
    expect(isBackgroundAgentRepoAllowed("Acme", "Widgets")).toBe(true);
  });

  test("normalizes and checks comma or whitespace separated repo allowlists", async () => {
    const { getBackgroundAgentsAllowedRepos, isBackgroundAgentRepoAllowed } =
      await modulePromise;
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS =
      "Acme/Widgets, octo/hello-world\nvercel/next.js";

    expect(getBackgroundAgentsAllowedRepos()).toEqual(
      new Set(["acme/widgets", "octo/hello-world", "vercel/next.js"]),
    );
    expect(isBackgroundAgentRepoAllowed("acme", "widgets")).toBe(true);
    expect(isBackgroundAgentRepoAllowed("ACME", "WIDGETS")).toBe(true);
    expect(isBackgroundAgentRepoAllowed("acme", "other")).toBe(false);
  });

  test("getBackgroundAgentMaxTurns defaults to 16 when unset (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns passes through a valid override (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "24";
    expect(getBackgroundAgentMaxTurns()).toBe(24);
  });

  test("getBackgroundAgentMaxTurns clamps an override above the ceiling to 64 (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "500";
    expect(getBackgroundAgentMaxTurns()).toBe(64);
  });

  test("getBackgroundAgentMaxTurns falls back to the default for non-numeric input (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "abc";
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns falls back to the default for zero (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "0";
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns falls back to the default for a negative value (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "-3";
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns falls back to the default for a decimal value instead of truncating (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "2.5";
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns falls back to the default for a numeric prefix with trailing text instead of truncating (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "20turns";
    expect(getBackgroundAgentMaxTurns()).toBe(16);
  });

  test("getBackgroundAgentMaxTurns tolerates surrounding whitespace around an otherwise valid integer (#862)", async () => {
    const { getBackgroundAgentMaxTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = " 12 ";
    expect(getBackgroundAgentMaxTurns()).toBe(12);
  });

  test("getBackgroundAgentHardTurnCap returns null when unset (#914)", async () => {
    const { getBackgroundAgentHardTurnCap } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_MAX_TURNS;
    expect(getBackgroundAgentHardTurnCap()).toBeNull();
  });

  test("getBackgroundAgentHardTurnCap returns the parsed value when set (#914)", async () => {
    const { getBackgroundAgentHardTurnCap } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "3";
    expect(getBackgroundAgentHardTurnCap()).toBe(3);
  });

  test("getBackgroundAgentHardTurnCap clamps an override above the ceiling to 64 (#914)", async () => {
    const { getBackgroundAgentHardTurnCap } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "500";
    expect(getBackgroundAgentHardTurnCap()).toBe(64);
  });

  test("getBackgroundAgentHardTurnCap returns null for invalid input (#914)", async () => {
    const { getBackgroundAgentHardTurnCap } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_TURNS = "abc";
    expect(getBackgroundAgentHardTurnCap()).toBeNull();
  });

  test("getBackgroundAgentMaxStaleTurns defaults to 20 when unset (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_MAX_STALE_TURNS;
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns passes through a valid override (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "10";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(10);
  });

  test("getBackgroundAgentMaxStaleTurns falls back to the default for non-numeric input (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "abc";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns falls back to the default for zero (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "0";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns falls back to the default for a negative value (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "-3";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns falls back to the default for a decimal value (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "2.5";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns falls back to the default for a numeric prefix with trailing text (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = "20turns";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(20);
  });

  test("getBackgroundAgentMaxStaleTurns tolerates surrounding whitespace (#914)", async () => {
    const { getBackgroundAgentMaxStaleTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_STALE_TURNS = " 12 ";
    expect(getBackgroundAgentMaxStaleTurns()).toBe(12);
  });

  test("getBackgroundAgentRepetitionThreshold defaults to 6 when unset (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD;
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentRepetitionThreshold passes through a valid override (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "4";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(4);
  });

  test("getBackgroundAgentRepetitionThreshold falls back to the default for a decimal value (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "2.5";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentRepetitionThreshold falls back to the default for non-numeric input (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "abc";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentRepetitionThreshold falls back to the default for zero (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "0";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentRepetitionThreshold falls back to the default for a negative value (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "-3";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentRepetitionThreshold falls back to the default for empty input (#915)", async () => {
    const { getBackgroundAgentRepetitionThreshold } = await modulePromise;
    process.env.BACKGROUND_AGENT_REPETITION_THRESHOLD = "";
    expect(getBackgroundAgentRepetitionThreshold()).toBe(6);
  });

  test("getBackgroundAgentStallGraceTurns defaults to 5 when unset (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS;
    expect(getBackgroundAgentStallGraceTurns()).toBe(5);
  });

  test("getBackgroundAgentStallGraceTurns passes through a valid override (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "2";
    expect(getBackgroundAgentStallGraceTurns()).toBe(2);
  });

  test("getBackgroundAgentStallGraceTurns falls back to the default for non-numeric input (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "abc";
    expect(getBackgroundAgentStallGraceTurns()).toBe(5);
  });

  test("getBackgroundAgentStallGraceTurns falls back to the default for zero (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "0";
    expect(getBackgroundAgentStallGraceTurns()).toBe(5);
  });

  test("getBackgroundAgentStallGraceTurns falls back to the default for a negative value (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "-3";
    expect(getBackgroundAgentStallGraceTurns()).toBe(5);
  });

  test("getBackgroundAgentStallGraceTurns falls back to the default for a decimal value (#916)", async () => {
    const { getBackgroundAgentStallGraceTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_GRACE_TURNS = "2.5";
    expect(getBackgroundAgentStallGraceTurns()).toBe(5);
  });

  test("getBackgroundAgentStallFinalizeTurns defaults to 3 when unset (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS;
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(3);
  });

  test("getBackgroundAgentStallFinalizeTurns passes through a valid override (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "2";
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(2);
  });

  test("getBackgroundAgentStallFinalizeTurns falls back to the default for non-numeric input (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "abc";
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(3);
  });

  test("getBackgroundAgentStallFinalizeTurns falls back to the default for zero (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "0";
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(3);
  });

  test("getBackgroundAgentStallFinalizeTurns falls back to the default for a negative value (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "-3";
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(3);
  });

  test("getBackgroundAgentStallFinalizeTurns falls back to the default for a decimal value (#916)", async () => {
    const { getBackgroundAgentStallFinalizeTurns } = await modulePromise;
    process.env.BACKGROUND_AGENT_STALL_FINALIZE_TURNS = "2.5";
    expect(getBackgroundAgentStallFinalizeTurns()).toBe(3);
  });

  test("getBackgroundAgentMaxRunTokens defaults to 50_000_000 when unset (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    delete process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS;
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });

  test("getBackgroundAgentMaxRunTokens passes through a valid override (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "250000";
    expect(getBackgroundAgentMaxRunTokens()).toBe(250_000);
  });

  test("getBackgroundAgentMaxRunTokens falls back to the default for a decimal value (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "2.5";
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });

  test("getBackgroundAgentMaxRunTokens falls back to the default for non-numeric input (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "lots";
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });

  test("getBackgroundAgentMaxRunTokens falls back to the default for zero (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "0";
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });

  test("getBackgroundAgentMaxRunTokens falls back to the default for a negative value (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "-5";
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });

  test("getBackgroundAgentMaxRunTokens falls back to the default for empty input (#917)", async () => {
    const { getBackgroundAgentMaxRunTokens } = await modulePromise;
    process.env.BACKGROUND_AGENT_MAX_RUN_TOKENS = "";
    expect(getBackgroundAgentMaxRunTokens()).toBe(50_000_000);
  });
});
