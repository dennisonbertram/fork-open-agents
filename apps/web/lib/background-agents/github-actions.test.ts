import { describe, expect, test } from "bun:test";
import type { BackgroundAgentPermissions } from "@/lib/db/schema";
import {
  DEFAULT_ENABLED_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  GITHUB_TOOL_ACTIONS,
  resolveGitHubToolConfig,
  WRITE_ACTIONS,
} from "./github-actions";

describe("github-actions canonical action set", () => {
  test("GITHUB_TOOL_ACTIONS has exactly the 7 expected members in order", () => {
    expect(GITHUB_TOOL_ACTIONS).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
      "approve_pull_request",
      "request_changes",
      "merge_pull_request",
      "push",
      "delete_branch",
    ]);
  });

  test("DEFAULT_ENABLED_ACTIONS is exactly open_pull_request + comment_on_pr_or_issue", () => {
    expect(DEFAULT_ENABLED_ACTIONS).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
  });

  test("WRITE_ACTIONS contains every mutating action, excluding read-only comment/approve/request_changes semantics is not asserted here", () => {
    // WRITE_ACTIONS is used for permission escalation — it must include
    // every action that mutates repo state via a write-scoped token.
    for (const action of [
      "open_pull_request",
      "merge_pull_request",
      "push",
      "delete_branch",
    ] as const) {
      expect(WRITE_ACTIONS.has(action)).toBe(true);
    }
  });

  test("DESTRUCTIVE_ACTIONS is exactly merge_pull_request, push, delete_branch", () => {
    expect(DESTRUCTIVE_ACTIONS.has("merge_pull_request")).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has("push")).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has("delete_branch")).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has("comment_on_pr_or_issue")).toBe(false);
    expect(DESTRUCTIVE_ACTIONS.has("open_pull_request")).toBe(false);
    expect(DESTRUCTIVE_ACTIONS.has("approve_pull_request")).toBe(false);
    expect(DESTRUCTIVE_ACTIONS.has("request_changes")).toBe(false);
    expect(DESTRUCTIVE_ACTIONS.size).toBe(3);
  });

  test("github-actions module does not import 'server-only' (must be client-safe)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(import.meta.dir, "github-actions.ts"),
      "utf8",
    );
    expect(source.includes('import "server-only"')).toBe(false);
  });
});

describe("resolveGitHubToolConfig", () => {
  test("legacy outputMode:'ready_pr' with no enabledActions migrates to open_pull_request + comment_on_pr_or_issue", () => {
    const result = resolveGitHubToolConfig({ outputMode: "ready_pr" });
    expect(result.enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(result.requireCiGreenToMerge).toBe(true);
  });

  test("legacy outputMode:'none' with no enabledActions migrates to zero actions", () => {
    const result = resolveGitHubToolConfig({ outputMode: "none" });
    expect(result.enabledActions).toEqual([]);
    expect(result.requireCiGreenToMerge).toBe(true);
  });

  test("absent outputMode with no enabledActions migrates to zero actions", () => {
    const result = resolveGitHubToolConfig({});
    expect(result.enabledActions).toEqual([]);
    expect(result.requireCiGreenToMerge).toBe(true);
  });

  test("other legacy report-only outputModes (comment/issue/notification) migrate to zero actions", () => {
    for (const outputMode of ["comment", "issue", "notification"]) {
      const result = resolveGitHubToolConfig({ outputMode });
      expect(result.enabledActions).toEqual([]);
      expect(result.requireCiGreenToMerge).toBe(true);
    }
  });

  test("explicit enabledActions is returned verbatim, ignoring outputMode, with explicit requireCiGreenToMerge preserved", () => {
    const result = resolveGitHubToolConfig({
      outputMode: "none",
      permissions: {
        github: {
          enabledActions: ["merge_pull_request"],
          requireCiGreenToMerge: false,
        },
      },
    });
    expect(result.enabledActions).toEqual(["merge_pull_request"]);
    expect(result.requireCiGreenToMerge).toBe(false);
  });

  test("explicit enabledActions present but requireCiGreenToMerge absent defaults to true", () => {
    const result = resolveGitHubToolConfig({
      permissions: {
        github: {
          enabledActions: ["push"],
        },
      },
    });
    expect(result.enabledActions).toEqual(["push"]);
    expect(result.requireCiGreenToMerge).toBe(true);
  });

  test("explicit enabledActions of [] is treated as new-model with zero actions, distinct from absent/legacy", () => {
    const result = resolveGitHubToolConfig({
      outputMode: "ready_pr",
      permissions: {
        github: {
          enabledActions: [],
        },
      },
    });
    // Must NOT fall back to the ready_pr legacy mapping — [] is an explicit
    // new-model choice, keyed on Array.isArray, not truthiness.
    expect(result.enabledActions).toEqual([]);
    expect(result.requireCiGreenToMerge).toBe(true);
  });
});

describe("resolveGitHubToolConfig regression coverage", () => {
  test("regression: mutating a ready_pr-derived enabledActions array does not corrupt DEFAULT_ENABLED_ACTIONS for later resolutions", () => {
    // If resolveGitHubToolConfig ever returned DEFAULT_ENABLED_ACTIONS
    // directly (instead of a fresh copy) for the legacy ready_pr migration,
    // a caller mutating the returned array would silently corrupt the
    // shared default for every subsequent legacy agent resolved in the same
    // process — a byte-identical-behavior regression that would only show
    // up in production under specific call ordering, never in a single
    // isolated assertion.
    const first = resolveGitHubToolConfig({ outputMode: "ready_pr" });
    first.enabledActions.push("delete_branch");

    expect(DEFAULT_ENABLED_ACTIONS).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);

    const second = resolveGitHubToolConfig({ outputMode: "ready_pr" });
    expect(second.enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
  });

  test("regression: accepts the real persisted BackgroundAgentPermissions shape (with sibling fields) unchanged, proving structural compatibility with schema.ts", () => {
    // Mirrors a realistic pre-#740 ready_pr agent's persisted permissions
    // JSONB blob: write access + write scope are set, but enabledActions
    // was never written (it didn't exist yet). If this test compiled
    // against a narrower/incompatible structural type than the real
    // BackgroundAgentPermissions, it would fail to typecheck (bun --bun run
    // ci), catching a drift between the resolver's accepted shape and the
    // actual schema.
    const legacyReadyPrPermissions: BackgroundAgentPermissions = {
      github: {
        contents: "write",
        pullRequests: "write",
        issues: "write",
        writeScopeMode: "this_repo",
      },
    };

    const result = resolveGitHubToolConfig({
      outputMode: "ready_pr",
      permissions: legacyReadyPrPermissions,
    });

    expect(result.enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(result.requireCiGreenToMerge).toBe(true);

    // A new-model agent's real persisted permissions blob (enabledActions
    // present alongside the same sibling fields) must pass through
    // verbatim, proving the resolver keys strictly on enabledActions and
    // ignores the legacy fields once the new field is present.
    const newModelPermissions: BackgroundAgentPermissions = {
      github: {
        contents: "write",
        pullRequests: "write",
        writeScopeMode: "all_repos",
        enabledActions: ["merge_pull_request", "push"],
        requireCiGreenToMerge: false,
      },
    };

    const newModelResult = resolveGitHubToolConfig({
      outputMode: "none",
      permissions: newModelPermissions,
    });

    expect(newModelResult.enabledActions).toEqual([
      "merge_pull_request",
      "push",
    ]);
    expect(newModelResult.requireCiGreenToMerge).toBe(false);
  });
});
