/**
 * Regression tests for Part C — edit-mode permission re-escalation fix.
 *
 * These tests go RED today because:
 * 1. BackgroundAgent type has no `permissions` or `composioToolkitSlugs` fields
 * 2. buildFormFromAgent re-derives access from outputMode, ignoring saved permissions
 *
 * After the fix (C1–C4), all three cases go GREEN:
 * - Case 1: saved ready_pr with contents/pullRequests=read does NOT re-escalate to write
 * - Case 2: agent with no permissions + outputMode ready_pr falls back to write (backward compat)
 * - Case 3: composioToolkitSlugs round-trips through form+payload unchanged
 */
import { describe, expect, test } from "bun:test";
import {
  buildAgentPayload,
  buildFormFromAgent,
  type BackgroundAgent,
} from "./agent-spec";

/**
 * Build a minimal BackgroundAgent with a single trigger.
 * The spread lets callers override any field to simulate saved DB state.
 */
function makeSavedAgent(
  overrides: Partial<BackgroundAgent> = {},
): BackgroundAgent {
  return {
    id: "agent-001",
    name: "PR Reviewer",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review PRs.",
    outputMode: "ready_pr",
    checkCommand: null,
    triggers: [
      {
        id: "trig-001",
        name: "A pull request changes",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {},
        schedule: null,
        webhookPublicId: null,
      },
    ],
    ...overrides,
  };
}

describe("REG: edit-mode permission re-escalation — saved downgrade must not re-escalate", () => {
  test("Case 1: ready_pr agent whose github access was downgraded to read does NOT re-escalate to write after buildFormFromAgent", () => {
    // This is the bug: a ready_pr agent saved with contents=read/pullRequests=read
    // should load as read, not re-derive write from outputMode.
    const agent = makeSavedAgent({
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "read",
          pullRequests: "read",
          issues: "read",
          deployments: "read",
          statuses: "read",
          checks: "read",
        },
      },
    });

    const form = buildFormFromAgent(agent);

    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");
  });

  test("Case 1 round-trip: saved read does NOT become write in the rebuilt payload", () => {
    const agent = makeSavedAgent({
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "read",
          pullRequests: "read",
        },
      },
    });

    const form = buildFormFromAgent(agent);
    const payload = buildAgentPayload(form);

    // The payload permissions must respect the saved (read) values, not the
    // outputMode-derived (write) ones.
    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
  });

  test("Case 2: agent with NO permissions field + outputMode ready_pr falls back to write (backward compat)", () => {
    // Agents created before the permissions threading existed have no saved permissions.
    // They should fall back to the outputMode-derived value as before.
    const agent = makeSavedAgent({
      outputMode: "ready_pr",
      // no permissions field
    });

    const form = buildFormFromAgent(agent);

    expect(form.permissionContents).toBe("write");
    expect(form.permissionPullRequests).toBe("write");
  });

  test("Case 2b: agent with NO permissions + outputMode none falls back to read", () => {
    const agent = makeSavedAgent({
      outputMode: "none",
      // no permissions field
    });

    const form = buildFormFromAgent(agent);

    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");
  });

  test("Case 3: composioToolkitSlugs round-trips through buildFormFromAgent -> buildAgentPayload unchanged", () => {
    const agent = makeSavedAgent({
      composioToolkitSlugs: ["gmail", "slack"],
    });

    const form = buildFormFromAgent(agent);

    // Slugs must be preserved in form state
    expect(form.composioToolkitSlugs).toEqual(["gmail", "slack"]);

    const payload = buildAgentPayload(form);

    // Slugs must survive the payload round-trip
    expect(payload.composioToolkitSlugs).toEqual(["gmail", "slack"]);
  });

  test("Case 3b: missing composioToolkitSlugs defaults to empty array", () => {
    const agent = makeSavedAgent({
      // composioToolkitSlugs absent (old agent)
    });

    const form = buildFormFromAgent(agent);

    expect(form.composioToolkitSlugs).toEqual([]);

    const payload = buildAgentPayload(form);

    expect(payload.composioToolkitSlugs).toEqual([]);
  });
});
