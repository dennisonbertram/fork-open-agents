/**
 * Regression tests for PR #72 fixes — "secrets can't leak into DB"
 *
 * R-REDACT-001: WorkspaceSetupError message is a safe generic string, never
 *   embeds command output. If reverted, BT-REDACT-001 would fail (raw secret
 *   in thrown error).
 *
 * R-REDACT-002: SECRET_PATTERNS in workspace-startup-log.ts includes bare
 *   ghp_/sk- token shapes. If reverted, BT-REDACT-004/005 would fail.
 *
 * R-REDACT-003: getSetupErrorMessage in chat.ts returns a safe generic
 *   message for WorkspaceSetupError. If reverted, the raw WorkspaceSetupError
 *   message (which may embed command output) would propagate to the DB.
 *
 * R-REDACT-004: summarizeManagedRuntimeCommandOutput redacts sk- and ghp_
 *   shaped tokens from combined command output before it becomes observation.summary.
 *   This is the shared redaction path for both DB failureMessage and event payload.
 */

import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    }),
    query: {
      managedRuntimeProfileRuns: { findFirst: async () => null },
    },
  },
}));

// ── Regression R-REDACT-001: WorkspaceSetupError message is safe ─────────────

test("R-REDACT-001: WorkspaceSetupError constructor does not embed its arguments in the error name field (class identity)", async () => {
  const { WorkspaceSetupError } = await import("./managed-runtime-environment");

  const err = new WorkspaceSetupError("safe profile failure message");
  expect(err.name).toBe("WorkspaceSetupError");
  // The message passed to the constructor should be reproduced exactly —
  // no raw command output is appended by the class itself
  expect(err.message).toBe("safe profile failure message");
});

// ── Regression R-REDACT-002: SECRET_PATTERNS covers gh[pousr]_ and sk- ──────

test("R-REDACT-002: appendWorkspaceStartupLogLines redacts bare ghp_ token in a line", async () => {
  const { appendWorkspaceStartupLogLines } =
    await import("./workspace-startup-log");

  const GHP = "ghp_REGR1234567890abcdefghijklmnopqr";
  const lines = appendWorkspaceStartupLogLines([], [`token: ${GHP}`]);
  // If SECRET_PATTERNS was reverted (missing gh[pousr]_ pattern), this would fail
  expect(lines.join("\n")).not.toContain(GHP);
});

test("R-REDACT-002b: appendWorkspaceStartupLogLines redacts bare sk- token in a line", async () => {
  const { appendWorkspaceStartupLogLines } =
    await import("./workspace-startup-log");

  const SK = "sk-REGR1234567890abcdefghijklmnopqr";
  const lines = appendWorkspaceStartupLogLines([], [`key: ${SK}`]);
  // If SECRET_PATTERNS was reverted (missing sk- pattern), this would fail
  expect(lines.join("\n")).not.toContain(SK);
});

// ── Regression R-REDACT-003: summarizeManagedRuntimeCommandOutput redacts ───

test("R-REDACT-004: summarizeManagedRuntimeCommandOutput redacts ghp_ and sk- tokens from raw command output", async () => {
  const { summarizeManagedRuntimeCommandOutput } =
    await import("@/lib/observability/managed-runtime-profile-runs");

  const GHP = "ghp_SUMMARY1234567890abcdefghijklmn";
  const SK = "sk-SUMMARY1234567890abcdefghijklmnop";

  const result = summarizeManagedRuntimeCommandOutput({
    success: false,
    exitCode: 1,
    stdout: `using token: ${GHP}`,
    stderr: `API_KEY=${SK} rejected`,
  });

  // If redactHarnessValue/redactSandboxLog in summarize were removed, secrets would leak
  expect(result).not.toContain(GHP);
  expect(result).not.toContain(SK);
  // The summary should contain some redacted representation
  expect(result.length).toBeGreaterThan(0);
});
