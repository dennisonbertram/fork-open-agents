import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalAllowedRepos = process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
const modulePromise = import("./config");

describe("background agent config", () => {
  afterEach(() => {
    if (originalAllowedRepos === undefined) {
      delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    } else {
      process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = originalAllowedRepos;
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
});
