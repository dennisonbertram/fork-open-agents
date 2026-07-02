/**
 * Regression tests for the edit-mode GitHub-permission invariant.
 *
 * The coherent rule across buildFormFromAgent (form display) and
 * buildAgentPayload (save payload):
 *   - Edit display ⟹ the user's saved access, preserved (least-privilege), so
 *     editing an unrelated field never silently re-escalates a read-only agent.
 *   - Save payload ⟹ write is floored whenever an enabled githubActions
 *     toggle requires it (push/merge/delete_branch/open_pr/approve/request_changes),
 *     mirroring the executor's own derivation (#745/#756). This replaces the
 *     old outputMode==="ready_pr" flooring (#747).
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
    outputMode: "none",
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

describe("edit-mode GitHub permission invariant", () => {
  test("report-only agent with saved read access is preserved (no re-escalation)", () => {
    // The genuine least-privilege case: a report-only agent the user keeps at
    // read must NOT be silently bumped to write when re-editing.
    const agent = makeSavedAgent({
      githubActions: { comment_on_pr_or_issue: true },
      permissions: {
        github: { contents: "read", pullRequests: "read" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
  });

  test("report-only agent with saved write access is preserved", () => {
    const agent = makeSavedAgent({
      githubActions: { comment_on_pr_or_issue: true },
      permissions: {
        github: { contents: "write", pullRequests: "write" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("write");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("write");
  });

  test("open_pull_request edit display preserves saved read access instead of re-escalating", () => {
    // Edit mode reflects persisted GitHub access rather than re-deriving from
    // enabled write actions. This keeps a downgraded or legacy row honest
    // when reopened.
    const agent = makeSavedAgent({
      githubActions: { open_pull_request: true },
      permissions: {
        github: { contents: "read", pullRequests: "read" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("open_pull_request payload is write even when the form somehow carries read", () => {
    // Guards the buildAgentPayload floor independently of buildFormFromAgent:
    // the settings form sends defaultForm read/read for an agent with
    // open_pull_request enabled.
    const form = buildFormFromAgent(
      makeSavedAgent({ githubActions: { comment_on_pr_or_issue: true } }),
    );
    const payload = buildAgentPayload({
      ...form,
      githubActions: { open_pull_request: true },
    });
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("agent with no saved permissions + report-only falls back to read", () => {
    const agent = makeSavedAgent({
      githubActions: { comment_on_pr_or_issue: true },
    });
    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");
  });

  test("composioToolkitSlugs round-trips through form + payload unchanged", () => {
    const agent = makeSavedAgent({ composioToolkitSlugs: ["gmail", "slack"] });
    const form = buildFormFromAgent(agent);
    expect(form.composioToolkitSlugs).toEqual(["gmail", "slack"]);

    const payload = buildAgentPayload(form);
    expect(payload.composioToolkitSlugs).toEqual(["gmail", "slack"]);
  });

  test("missing composioToolkitSlugs defaults to empty array", () => {
    const agent = makeSavedAgent();
    const form = buildFormFromAgent(agent);
    expect(form.composioToolkitSlugs).toEqual([]);

    const payload = buildAgentPayload(form);
    expect(payload.composioToolkitSlugs).toEqual([]);
  });
});
