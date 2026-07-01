import { describe, expect, test } from "bun:test";
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
