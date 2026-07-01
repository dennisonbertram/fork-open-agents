import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENABLED_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  GITHUB_TOOL_ACTIONS,
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
    expect(source.includes("server-only")).toBe(false);
  });
});
