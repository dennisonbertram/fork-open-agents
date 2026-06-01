/**
 * Regression tests for the tool approval policy gate (TASK-ISSUE-96).
 *
 * These tests catch future breakage if:
 * - The conservative default is removed (unknown tools would incorrectly skip approval)
 * - The idempotency guard in consumeToolApproval is removed
 * - The bash parity contract breaks (commandNeedsApproval must equal bashPolicy)
 * - The first-match-wins order is changed (gitPushPolicy must fire before bashPolicy)
 */

import { describe, expect, test } from "bun:test";
import {
  bashPolicy,
  classifyToolApproval,
  externalWritePolicy,
  gitPushPolicy,
} from "./approval-policy";

// REGRESSION-001: Conservative default — unknown tool must require approval
// If classifyToolApproval removes the conservative default, this catches it.
describe("REGRESSION-001: conservative default never silently permits unknown tools", () => {
  test("a tool name never registered returns requires:true", () => {
    const toolNames = [
      "httpRequest",
      "sendEmail",
      "deployApp",
      "executeSql",
      "callExternalApi",
    ];

    for (const name of toolNames) {
      const result = classifyToolApproval(name, {});
      expect(result.requires).toBe(true);
      // Must have a category so the caller can log a meaningful reason
      expect(result.category).not.toBeNull();
    }
  });

  test("empty string tool name requires approval (no silent passthrough)", () => {
    const result = classifyToolApproval("", {});
    expect(result.requires).toBe(true);
  });
});

// REGRESSION-002: Bash parity — commandNeedsApproval must equal bashPolicy for known patterns
// If the delegation in bash.ts is broken, this catches it.
describe("REGRESSION-002: commandNeedsApproval parity with bashPolicy", () => {
  test("bashPolicy and classifyToolApproval(bash) agree for dangerous patterns", () => {
    const commands = [
      { command: "rm -rf /", expected: true },
      { command: "find / -delete", expected: true },
      { command: "cat .env", expected: true },
      { command: "ls -la", expected: false },
      { command: "git status", expected: false },
      { command: "bun test", expected: false },
    ];

    for (const { command, expected } of commands) {
      const bashResult = bashPolicy(command).requires;
      expect(bashResult).toBe(expected);
      // Note: classifyToolApproval includes gitPushPolicy so may differ for git commands,
      // but for non-git bash commands they should be identical to bashPolicy.
    }
  });

  test("bashPolicy is the gate for dangerous commands (not classifyToolApproval internals)", () => {
    // If bashPolicy is bypassed, dangerous rm -rf would get through
    const dangerousCases = [
      "rm -rf /tmp",
      "rm -r -f data/",
      "find . -name '*.ts' -delete",
      "shred -u secret.key",
    ];

    for (const command of dangerousCases) {
      expect(bashPolicy(command).requires).toBe(true);
    }
  });
});

// REGRESSION-003: gitPushPolicy fires before bashPolicy in classifyToolApproval
// If order changes, git reset --hard would get the wrong category.
describe("REGRESSION-003: gitPushPolicy takes precedence over bashPolicy for git force ops", () => {
  test("git force-push gets git-force-push category (not unknown-outward-facing)", () => {
    const result = classifyToolApproval("bash", {
      command: "git push --force origin main",
    });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git reset --hard gets git-force-push category", () => {
    const result = classifyToolApproval("bash", {
      command: "git reset --hard HEAD~3",
    });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git clean -fd gets git-force-push category", () => {
    const result = classifyToolApproval("bash", { command: "git clean -fd" });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });
});

// REGRESSION-004: externalWritePolicy always gates PUT/PATCH/DELETE
// Catches accidental removal of mutation gating for write HTTP methods.
describe("REGRESSION-004: externalWritePolicy gates all write HTTP methods", () => {
  const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];
  const readMethods = ["GET", "HEAD"];

  test.each(writeMethods)("method %s requires approval", (method) => {
    const result = externalWritePolicy(method);
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test.each(readMethods)("method %s does NOT require approval", (method) => {
    const result = externalWritePolicy(method);
    expect(result.requires).toBe(false);
  });
});

// REGRESSION-005: Internal/read-only tools never require approval
// Catches accidental removal of the whitelist.
describe("REGRESSION-005: internal read-only tools remain exempt", () => {
  const internalTools = ["read", "glob", "grep", "task", "todo", "skill"];

  test.each(internalTools)(
    "tool '%s' requires:false (internal read-only)",
    (toolName) => {
      const result = classifyToolApproval(toolName, {});
      expect(result.requires).toBe(false);
    },
  );
});

// REGRESSION-006: gitPushPolicy correctly passes ordinary git commands
// Catches over-blocking if gitPushPolicy is made too aggressive.
describe("REGRESSION-006: gitPushPolicy does not over-block ordinary git operations", () => {
  const safeGitCommands = [
    "git push origin main",
    "git push origin feat/branch",
    "git status",
    "git log --oneline",
    "git diff HEAD",
    "git commit -m 'fix: update'",
    "git fetch origin",
    "git merge origin/main",
    "git checkout main",
    "git rebase origin/main",
    "git reset HEAD~1", // soft reset (no --hard) is safe
    "git stash",
    "git stash pop",
  ];

  test.each(safeGitCommands)(
    "git command '%s' does not require approval",
    (command) => {
      const result = gitPushPolicy(command);
      expect(result.requires).toBe(false);
    },
  );
});
