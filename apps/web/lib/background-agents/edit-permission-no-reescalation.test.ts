/**
 * Regression tests for the edit-mode GitHub-permission invariant.
 *
 * (#740) enabledActions is the single source of truth for GitHub write
 * access, not outputMode:
 *   - Edit display (buildFormFromAgent) still shows the user's saved
 *     permissionContents/permissionPullRequests fields for transparency, but
 *     those fields are no longer read by buildAgentPayload. It also derives
 *     enabledActions via resolveGitHubToolConfig(agent), so a legacy
 *     ready_pr row (no persisted enabledActions) migrates to the agreed
 *     open_pull_request + comment_on_pr_or_issue default.
 *   - Save payload (buildAgentPayload) derives github.contents/pullRequests
 *     purely from form.enabledActions: any non-empty set => write, an empty
 *     set => read. A report-only agent (enabledActions: []) can never
 *     persist write, regardless of what form.outputMode, the form's
 *     permission fields, or a legacy saved row say.
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

describe("edit-mode GitHub permission invariant", () => {
  test("report-only agent with saved read access is preserved (no re-escalation)", () => {
    // The genuine least-privilege case: a report-only agent the user keeps at
    // read must NOT be silently bumped to write when re-editing.
    const agent = makeSavedAgent({
      outputMode: "none",
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

  test("report-only agent with a legacy saved write access is downgraded to read on save", () => {
    // A legacy row could have contents:write from before this was derived
    // from outputMode. The form still displays what was saved (for
    // transparency), but saving a "none" agent now always persists read —
    // outputMode is the single source of truth, not the saved permission.
    const agent = makeSavedAgent({
      outputMode: "none",
      permissions: {
        github: { contents: "write", pullRequests: "write" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("write");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
  });

  test("ready_pr edit display preserves saved read access instead of re-escalating", () => {
    // Edit mode reflects persisted GitHub access rather than re-deriving from
    // outputMode. This keeps a downgraded or legacy row honest when reopened.
    const agent = makeSavedAgent({
      outputMode: "ready_pr",
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

  test("(#740) buildAgentPayload ignores form.outputMode entirely: overriding it to 'ready_pr' does NOT resurrect write for an agent whose enabledActions is empty", () => {
    // Before #740, outputMode alone floored GitHub access to write. Now
    // enabledActions is the only input — setting outputMode:"ready_pr" on a
    // form built from a report-only agent (enabledActions: [] via
    // resolveGitHubToolConfig) must NOT re-escalate access.
    const form = buildFormFromAgent(makeSavedAgent({ outputMode: "none" }));
    expect(form.enabledActions).toEqual([]);

    const payload = buildAgentPayload({ ...form, outputMode: "ready_pr" });
    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
  });

  test("(#740) buildAgentPayload floors GitHub access to write when enabledActions is non-empty, even if form.outputMode says 'none'", () => {
    // The write-side mirror of the test above: enabledActions, not
    // outputMode, is what actually grants write.
    const form = buildFormFromAgent(makeSavedAgent({ outputMode: "none" }));
    const payload = buildAgentPayload({
      ...form,
      outputMode: "none",
      enabledActions: ["open_pull_request"],
    });
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("agent with no saved permissions + report-only falls back to read", () => {
    const agent = makeSavedAgent({ outputMode: "none" });
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
