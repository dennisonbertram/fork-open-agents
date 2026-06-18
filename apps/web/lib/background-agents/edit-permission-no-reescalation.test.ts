/**
 * Regression tests for the edit-mode GitHub-permission invariant.
 *
 * The coherent rule across buildFormFromAgent (form display) and
 * buildAgentPayload (save payload):
 *   - Ready PR  ⟹ write (it can't push a branch / open a PR without it), floored
 *     for every calling surface — including the settings form, which has no
 *     permission controls.
 *   - Report-only ⟹ the user's saved access, preserved (least-privilege), so
 *     editing an unrelated field never silently re-escalates a read-only agent.
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

  test("report-only agent with saved write access is preserved", () => {
    const agent = makeSavedAgent({
      outputMode: "none",
      permissions: {
        github: { contents: "write", pullRequests: "write" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("write");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("write");
  });

  test("ready_pr always resolves to write — even if a stale row saved read (settings-form regression)", () => {
    // A ready_pr agent is non-functional without write. Whatever is stored
    // (including a legacy read/read row from the controls-less settings form),
    // both the form and the payload must present write.
    const agent = makeSavedAgent({
      outputMode: "ready_pr",
      permissions: {
        github: { contents: "read", pullRequests: "read" },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.permissionContents).toBe("write");
    expect(form.permissionPullRequests).toBe("write");

    const payload = buildAgentPayload(form);
    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("ready_pr payload is write even when the form somehow carries read", () => {
    // Guards the buildAgentPayload floor independently of buildFormFromAgent:
    // the settings form sends defaultForm read/read for a ready_pr agent.
    const form = buildFormFromAgent(makeSavedAgent({ outputMode: "none" }));
    const payload = buildAgentPayload({ ...form, outputMode: "ready_pr" });
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
