import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalAllowedRepos = process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
const originalMaxTurns = process.env.BACKGROUND_AGENT_MAX_TURNS;
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
});
