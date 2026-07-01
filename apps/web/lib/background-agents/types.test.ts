import { describe, expect, test } from "bun:test";
import {
  backgroundAgentErrorKinds,
  buildBackgroundRunIdempotencyKey,
  createBackgroundAgentSchema,
  permissionsSchema,
  updateBackgroundAgentSchema,
} from "./types";

describe("background agent contract types", () => {
  test("creates stable idempotency keys from agent, trigger, and external event identity", () => {
    const key = buildBackgroundRunIdempotencyKey({
      agentId: "agent_1",
      triggerId: "trigger_1",
      event: {
        source: "github",
        kind: "github.pull_request",
        externalId: "pull_request:123:opened:abc",
        repoOwner: "dennisonbertram",
        repoName: "fork-open-agents",
      },
    });

    expect(key).toBe(
      "agent_1:trigger_1:github:github.pull_request:pull_request:123:opened:abc",
    );
  });

  test("accepts v1 GitHub permissions while leaving external tool providers out of execution config", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      permissions: {
        github: {
          contents: "read",
          pullRequests: "write",
          issues: "read",
          checks: "read",
        },
      },
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.status).toBe("disabled");
    expect(parsed.permissions.github?.pullRequests).toBe("write");
    expect(parsed.triggers[0]?.status).toBe("enabled");
  });

  test("createBackgroundAgentSchema accepts builtinToolNames", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      builtinToolNames: ["read", "bash"],
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toEqual(["read", "bash"]);
  });

  test("createBackgroundAgentSchema accepts a null builtinToolNames (falls back to the default toolpack)", () => {
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      builtinToolNames: null,
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toBeNull();
  });

  test("REGRESSION: omitting builtinToolNames entirely still validates (backward-compatible with pre-toolpack API clients)", () => {
    // If builtinToolNames were ever changed from nullish() to a required
    // field, every existing agent-create/update client that doesn't send
    // this new key would start getting 400s. This guards that the field
    // stays optional.
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "comment",
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.builtinToolNames).toBeUndefined();
  });

  test("REGRESSION: updateBackgroundAgentSchema (PATCH) accepts builtinToolNames via its createBackgroundAgentSchema.partial() inheritance", () => {
    // updateBackgroundAgentSchema is derived from createBackgroundAgentSchema
    // via .omit({triggers:true}).partial().extend(...). This test guards
    // that derivation actually carries builtinToolNames through — a
    // .strict() PATCH route would 400 on it otherwise, exactly like the
    // .strict() bug this step fixes for POST.
    const parsed = updateBackgroundAgentSchema.parse({
      builtinToolNames: ["bash", "web_fetch"],
    });

    expect(parsed.builtinToolNames).toEqual(["bash", "web_fetch"]);
  });

  test("BT-A3-01: permissionsSchema accepts writeScopeMode and writeScopeRepos on github", () => {
    const parsed = permissionsSchema.parse({
      github: {
        contents: "write",
        writeScopeMode: "repo_list",
        writeScopeRepos: ["acme/a", "acme/b"],
      },
    });

    expect(parsed.github?.writeScopeMode).toBe("repo_list");
    expect(parsed.github?.writeScopeRepos).toEqual(["acme/a", "acme/b"]);
  });

  test("BT-A3-02: permissionsSchema rejects an invalid writeScopeMode value", () => {
    expect(() =>
      permissionsSchema.parse({
        github: {
          contents: "write",
          writeScopeMode: "every_repo_ever",
        },
      }),
    ).toThrow();
  });

  test("BT-A3-03: permissionsSchema.github writeScopeMode/writeScopeRepos are both optional (backward compatible)", () => {
    const parsed = permissionsSchema.parse({
      github: { contents: "write" },
    });

    expect(parsed.github?.writeScopeMode).toBeUndefined();
    expect(parsed.github?.writeScopeRepos).toBeUndefined();
  });

  test("BT-A3-04: backgroundAgentErrorKinds includes write_scope_denied", () => {
    expect(backgroundAgentErrorKinds).toContain("write_scope_denied");
  });

  test("REGRESSION: createBackgroundAgentSchema round-trips writeScopeMode/writeScopeRepos through its permissions field", () => {
    // If permissionsSchema's .strict() object were ever left without these
    // fields declared, an agent-create payload carrying a repo_list write
    // scope would 400 outright instead of persisting the scope.
    const parsed = createBackgroundAgentSchema.parse({
      name: "PR reviewer",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      instructions: "Review new pull requests.",
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          writeScopeMode: "all_repos",
        },
      },
      triggers: [
        {
          name: "Pull request",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });

    expect(parsed.permissions.github?.writeScopeMode).toBe("all_repos");
  });

  test("REGRESSION: permissionsSchema rejects a writeScopeRepos array over 100 entries (bounded repo-list invariant)", () => {
    // The write-scope resolver (A4) must always mint a token against an
    // explicit, bounded repo-ID list. If the max(100) cap on writeScopeRepos
    // were ever dropped here, an unbounded repo_list could be persisted and
    // later resolved into an unbounded token mint.
    const tooMany = Array.from({ length: 101 }, (_, i) => `acme/repo-${i}`);

    expect(() =>
      permissionsSchema.parse({
        github: { contents: "write", writeScopeRepos: tooMany },
      }),
    ).toThrow();

    const exactlyMax = tooMany.slice(0, 100);
    expect(() =>
      permissionsSchema.parse({
        github: { contents: "write", writeScopeRepos: exactlyMax },
      }),
    ).not.toThrow();
  });
});
