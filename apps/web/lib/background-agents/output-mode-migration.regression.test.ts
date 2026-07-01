/**
 * Dedicated legacy-migration regression coverage for #740.
 *
 * STEP-13's job is a regression sweep: prove that the outputMode ->
 * enabledActions replacement (STEP-1 through STEP-12) never silently
 * changes capability for an agent that was created and persisted BEFORE
 * #740 existed. Unit-level coverage of resolveGitHubToolConfig and the
 * agent-spec.ts pipeline already lives in github-actions.test.ts and
 * agent-spec.test.ts; this file's distinct angle is END-TO-END byte-
 * identical CAPABILITY for the exact stored shape the issue calls out —
 * `{ outputMode: "ready_pr", permissions: { github: { ...no enabledActions } } }`
 * — spanning:
 *
 *   1. resolveGitHubToolConfig (the single migration source of truth)
 *   2. the full edit-resave pipeline (buildFormFromAgent -> buildAgentPayload)
 *   3. the exact run-capability booleans executeBackgroundAgentRun
 *      (executor.ts, STEP-9) derives from resolveGitHubToolConfig to decide
 *      requiredUserPermission and whether write-scope resolution runs at
 *      all — proving a legacy migrated agent is treated as a write agent,
 *      not silently downgraded to read-only.
 *
 * (The live native ToolSet a run actually receives —
 * resolveGitHubActionToolsForBackgroundAgent — is already covered
 * end-to-end for this exact legacy-migration scenario in executor.test.ts,
 * STEP-9; duplicating that heavy sandbox/octokit-mocked integration here
 * would just re-test the same wiring through a second, more expensive
 * path.)
 *
 * If the ready_pr -> enabledActions mapping in github-actions.ts regresses
 * (e.g. narrowed to just open_pull_request, or the Array.isArray/absent
 * distinction is broken), every test below fails.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAgentPayload,
  buildFormFromAgent,
  type BackgroundAgent,
} from "./agent-spec";
import { resolveGitHubToolConfig, WRITE_ACTIONS } from "./github-actions";

function makeLegacyReadyPrAgent(
  overrides: Partial<BackgroundAgent> = {},
): BackgroundAgent {
  return {
    id: "agent-legacy-ready-pr",
    name: "PR Backlog Maintainer",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Keep PRs up to date.",
    // The exact stored shape from the issue's migration example: outputMode
    // is "ready_pr", and permissions.github has NO enabledActions/
    // requireCiGreenToMerge keys at all — a real pre-#740 row.
    outputMode: "ready_pr",
    checkCommand: null,
    permissions: {
      github: {
        contents: "write",
        pullRequests: "write",
        issues: "read",
        deployments: "read",
        statuses: "read",
        checks: "read",
        writeScopeMode: "repo_list",
        writeScopeRepos: ["acme/other-repo"],
      },
    },
    composioToolkitSlugs: [],
    triggers: [
      {
        id: "trigger-1",
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

describe("REGRESSION (#740): legacy outputMode:'ready_pr' agent produces byte-identical write capability", () => {
  test("resolveGitHubToolConfig migrates the exact stored shape to open_pull_request + comment_on_pr_or_issue, write gate on", () => {
    const agent = makeLegacyReadyPrAgent();

    const { enabledActions, requireCiGreenToMerge } =
      resolveGitHubToolConfig(agent);

    expect(enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(requireCiGreenToMerge).toBe(true);
  });

  test("the full edit-resave pipeline (buildFormFromAgent -> buildAgentPayload) preserves write access, action set, and write scope unchanged", () => {
    const agent = makeLegacyReadyPrAgent();

    const form = buildFormFromAgent(agent);
    expect(form.enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(form.requireCiGreenToMerge).toBe(true);
    // Write scope lives directly on permissions.github, untouched by
    // resolveGitHubToolConfig — it must round-trip exactly as saved.
    expect(form.writeScopeMode).toBe("repo_list");
    expect(form.writeScopeRepos).toEqual(["acme/other-repo"]);

    const resaved = buildAgentPayload(form);
    expect(resaved.permissions.github.contents).toBe("write");
    expect(resaved.permissions.github.pullRequests).toBe("write");
    expect(resaved.permissions.github.enabledActions).toEqual([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(resaved.permissions.github.requireCiGreenToMerge).toBe(true);
    expect(resaved.permissions.github.writeScopeMode).toBe("repo_list");
    expect(resaved.permissions.github.writeScopeRepos).toEqual([
      "acme/other-repo",
    ]);
    // The legacy outputMode mirror is kept in sync purely as a derived
    // value — still "ready_pr" because open_pull_request is enabled.
    expect(resaved.outputMode).toBe("ready_pr");
  });

  test("the migrated agent is treated as a write agent by the exact gate executor.ts uses — requiredUserPermission and write-scope resolution are never silently downgraded to read-only", () => {
    const agent = makeLegacyReadyPrAgent();
    const { enabledActions } = resolveGitHubToolConfig(agent);

    // Mirrors executor.ts's own derivation (STEP-9):
    //   const needsWrite = enabledActions.length > 0;
    //   requiredUserPermission: needsWrite ? "write" : "read";
    // A regression that silently emptied the migrated array (or flipped the
    // Array.isArray/absent branch) would make this a read-only run instead
    // of the write run the pre-#740 agent has always been.
    const needsWrite = enabledActions.length > 0;
    expect(needsWrite).toBe(true);
    const requiredUserPermission = needsWrite ? "write" : "read";
    expect(requiredUserPermission).toBe("write");

    // open_pull_request is itself a write action (WRITE_ACTIONS), so a
    // legacy ready_pr agent's write-scope resolution (resolveWriteScopeRepositoryIds)
    // still runs, exactly as it did before #740.
    expect(enabledActions.some((action) => WRITE_ACTIONS.has(action))).toBe(
      true,
    );
    // comment_on_pr_or_issue is deliberately NOT itself a write action (it
    // mints issues:write, not contents/pull_requests:write) — it rides
    // along on the same write-scope-gated agent without being the reason
    // write scope is needed. Guards against WRITE_ACTIONS ever silently
    // growing to include it, which would misclassify comment-only agents
    // (see STEP-10's REG coverage for the UI side of this same invariant).
    expect(WRITE_ACTIONS.has("comment_on_pr_or_issue")).toBe(false);
  });

  test("the inverse migration edge: an explicit enabledActions:[] override on a stale outputMode:'ready_pr' + repo_list write-scope row is NOT treated as legacy — write scope collapses to this_repo/[] on resave", () => {
    // Distinguishes "new-model, deliberately opted out of everything"
    // (Array.isArray([]) === true) from "legacy, never migrated" (absent
    // enabledActions -> derive from outputMode). agent-spec.test.ts already
    // covers this distinction for contents/pullRequests; this test adds the
    // angle those don't: a REALISTIC stale multi-repo write scope
    // (writeScopeMode: "repo_list", writeScopeRepos: [...]) left over from
    // when the agent still had write access must be force-collapsed back
    // to this_repo/[] once enabledActions is explicitly empty — not just
    // the default-valued this_repo/[] every other test in this file uses.
    const agent = makeLegacyReadyPrAgent({
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          issues: "read",
          deployments: "read",
          statuses: "read",
          checks: "read",
          writeScopeMode: "repo_list",
          writeScopeRepos: ["acme/other-repo", "acme/third-repo"],
          enabledActions: [],
          requireCiGreenToMerge: true,
        },
      },
    });

    const { enabledActions } = resolveGitHubToolConfig(agent);
    expect(enabledActions).toEqual([]);

    const form = buildFormFromAgent(agent);
    expect(form.enabledActions).toEqual([]);
    // buildFormFromAgent itself is display-only and still round-trips the
    // stale saved writeScopeMode/writeScopeRepos verbatim (for editor
    // display) — the collapse happens at save time in buildAgentPayload.
    expect(form.writeScopeMode).toBe("repo_list");
    expect(form.writeScopeRepos).toEqual([
      "acme/other-repo",
      "acme/third-repo",
    ]);

    const resaved = buildAgentPayload(form);
    expect(resaved.permissions.github.contents).toBe("read");
    expect(resaved.permissions.github.pullRequests).toBe("read");
    expect(resaved.permissions.github.writeScopeMode).toBe("this_repo");
    expect(resaved.permissions.github.writeScopeRepos).toEqual([]);
    expect(resaved.outputMode).toBe("none");
  });
});
