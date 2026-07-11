import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalAllowedRepos = process.env.AGENT_LOOPS_ALLOWED_REPOS;
const modulePromise = import("./config");

describe("agent loop config", () => {
  afterEach(() => {
    if (originalAllowedRepos === undefined) {
      delete process.env.AGENT_LOOPS_ALLOWED_REPOS;
    } else {
      process.env.AGENT_LOOPS_ALLOWED_REPOS = originalAllowedRepos;
    }
  });

  test("denies missing and blank allowlists", async () => {
    const {
      getAgentLoopRepoAccess,
      getAgentLoopsAllowedRepos,
      getAgentLoopsRepoPolicy,
      isAgentLoopRepoAllowed,
    } = await modulePromise;

    for (const value of [undefined, "   "]) {
      if (value === undefined) {
        delete process.env.AGENT_LOOPS_ALLOWED_REPOS;
      } else {
        process.env.AGENT_LOOPS_ALLOWED_REPOS = value;
      }
      expect(getAgentLoopsRepoPolicy()).toEqual({
        state: "missing",
        entries: new Set(),
      });
      expect(getAgentLoopsAllowedRepos()).toEqual(new Set());
      expect(isAgentLoopRepoAllowed("Acme", "Widgets")).toBe(false);
      expect(getAgentLoopRepoAccess("Acme", "Widgets")).toEqual({
        allowed: false,
        reason: "repo_allowlist_unconfigured",
      });
    }
  });

  test("allows all repos only for the exact trimmed wildcard", async () => {
    const {
      getAgentLoopsAllowedRepos,
      getAgentLoopsRepoPolicy,
      isAgentLoopRepoAllowed,
    } = await modulePromise;
    process.env.AGENT_LOOPS_ALLOWED_REPOS = "  *  ";

    expect(getAgentLoopsRepoPolicy().state).toBe("wildcard");
    expect(getAgentLoopsAllowedRepos()).toBeNull();
    expect(isAgentLoopRepoAllowed("Acme", "Widgets")).toBe(true);
  });

  test("normalizes valid lists and keeps valid exclusion typed", async () => {
    const { getAgentLoopRepoAccess, getAgentLoopsAllowedRepos } =
      await modulePromise;
    process.env.AGENT_LOOPS_ALLOWED_REPOS =
      "Acme/Widgets, octo/hello-world\nvercel/next.js";

    expect(getAgentLoopsAllowedRepos()).toEqual(
      new Set(["acme/widgets", "octo/hello-world", "vercel/next.js"]),
    );
    expect(getAgentLoopRepoAccess("ACME", "WIDGETS")).toEqual({
      allowed: true,
    });
    expect(getAgentLoopRepoAccess("acme", "other")).toEqual({
      allowed: false,
      reason: "repo_not_allowed",
    });
  });

  test("fails closed for malformed or mixed-wildcard allowlists", async () => {
    const {
      getAgentLoopRepoAccess,
      getAgentLoopsAllowedRepos,
      getAgentLoopsRepoPolicy,
    } = await modulePromise;

    for (const value of ["not-a-repo", "*,acme/widgets"]) {
      process.env.AGENT_LOOPS_ALLOWED_REPOS = value;
      expect(getAgentLoopsRepoPolicy()).toMatchObject({
        state: "invalid",
        entries: new Set(),
      });
      expect(getAgentLoopsAllowedRepos()).toEqual(new Set());
      expect(getAgentLoopRepoAccess("acme", "widgets")).toEqual({
        allowed: false,
        reason: "repo_allowlist_invalid",
      });
    }
  });
});
