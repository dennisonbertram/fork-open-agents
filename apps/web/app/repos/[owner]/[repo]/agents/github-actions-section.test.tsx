/**
 * Behavior tests for GitHubActionsSection and its pure toggleGitHubAction
 * helper (#740 STEP-10). Uses renderToStaticMarkup (react-dom/server) — no
 * JSDOM needed, matching the established pattern in this directory (see
 * standard-toolpack-section.test.tsx). renderToStaticMarkup cannot simulate
 * clicks, so all state-transition logic is covered directly against the pure
 * helper.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GITHUB_TOOL_ACTIONS,
  type GitHubToolAction,
} from "@/lib/background-agents/github-actions";
import {
  GitHubActionsSection,
  toggleGitHubAction,
} from "./github-actions-section";

const noop = () => {};

describe("toggleGitHubAction (pure helper)", () => {
  test("adds an action that is absent", () => {
    expect(
      toggleGitHubAction(["open_pull_request"], "comment_on_pr_or_issue"),
    ).toEqual(["open_pull_request", "comment_on_pr_or_issue"]);
  });

  test("removes an action that is present", () => {
    expect(
      toggleGitHubAction(
        ["open_pull_request", "comment_on_pr_or_issue"],
        "open_pull_request",
      ),
    ).toEqual(["comment_on_pr_or_issue"]);
  });

  test("does not mutate the input array", () => {
    const input: GitHubToolAction[] = ["open_pull_request"];
    toggleGitHubAction(input, "push");
    expect(input).toEqual(["open_pull_request"]);
  });
});

describe("GitHubActionsSection", () => {
  test("renders exactly one switch per GITHUB_TOOL_ACTIONS entry when merge is not enabled", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["open_pull_request", "comment_on_pr_or_issue"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    const switchMatches = html.match(/role="switch"/g) ?? [];
    expect(switchMatches.length).toBe(GITHUB_TOOL_ACTIONS.length);
  });

  test("open_pull_request and comment_on_pr_or_issue render checked by default", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["open_pull_request", "comment_on_pr_or_issue"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    for (const label of ["Open a pull request", "Comment on a PR or issue"]) {
      const idx = html.indexOf(label);
      expect(idx).toBeGreaterThan(-1);
      const switchIdx = html.indexOf('role="switch"', idx);
      const snippet = html.slice(idx, switchIdx + 100);
      expect(snippet).toContain('data-state="checked"');
    }
  });

  test("the other 5 actions render unchecked when only the defaults are enabled", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["open_pull_request", "comment_on_pr_or_issue"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    for (const label of [
      "Approve a pull request",
      "Request changes on a pull request",
      "Merge a pull request",
      "Push commits (including force-push)",
      "Delete a branch",
    ]) {
      const idx = html.indexOf(label);
      expect(idx).toBeGreaterThan(-1);
      const switchIdx = html.indexOf('role="switch"', idx);
      const snippet = html.slice(idx, switchIdx + 100);
      expect(snippet).toContain('data-state="unchecked"');
    }
  });

  test("the 'Require CI checks to pass before merging' sub-toggle appears only when merge_pull_request is enabled", () => {
    const withoutMerge = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["open_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    expect(withoutMerge).not.toContain(
      "Require CI checks to pass before merging",
    );

    const withMerge = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["merge_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    expect(withMerge).toContain("Require CI checks to pass before merging");
  });

  test("the CI-gate sub-toggle reflects requireCiGreenToMerge exactly (checked=true, unchecked=false)", () => {
    const onHtml = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["merge_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    const onIdx = onHtml.indexOf("Require CI checks to pass before merging");
    const onSwitchIdx = onHtml.indexOf('role="switch"', onIdx);
    expect(onHtml.slice(onIdx, onSwitchIdx + 100)).toContain(
      'data-state="checked"',
    );

    const offHtml = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["merge_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={false}
        onRequireCiGreenChange={noop}
      />,
    );
    const offIdx = offHtml.indexOf("Require CI checks to pass before merging");
    const offSwitchIdx = offHtml.indexOf('role="switch"', offIdx);
    expect(offHtml.slice(offIdx, offSwitchIdx + 100)).toContain(
      'data-state="unchecked"',
    );
  });

  test("push and delete_branch always render an 'Irreversible' caption", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["push", "delete_branch"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    const pushIdx = html.indexOf("Push commits");
    const deleteIdx = html.indexOf("Delete a branch");
    expect(html.slice(pushIdx, pushIdx + 400)).toContain("Irreversible");
    expect(html.slice(deleteIdx, deleteIdx + 400)).toContain("Irreversible");
  });

  test("merge_pull_request shows 'Irreversible' only when the CI gate is off", () => {
    const gateOn = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["merge_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    const gateOnIdx = gateOn.indexOf("Merge a pull request");
    expect(gateOn.slice(gateOnIdx, gateOnIdx + 400)).not.toContain(
      "Irreversible",
    );

    const gateOff = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["merge_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={false}
        onRequireCiGreenChange={noop}
      />,
    );
    const gateOffIdx = gateOff.indexOf("Merge a pull request");
    expect(gateOff.slice(gateOffIdx, gateOffIdx + 400)).toContain(
      "Irreversible",
    );
  });

  test("open_pull_request and comment_on_pr_or_issue never show 'Irreversible', even when every action is enabled", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={[...GITHUB_TOOL_ACTIONS]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    for (const label of ["Open a pull request", "Comment on a PR or issue"]) {
      const idx = html.indexOf(label);
      expect(html.slice(idx, idx + 300)).not.toContain("Irreversible");
    }
  });

  test("disabled prop disables every action switch", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={["open_pull_request"]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
        disabled
      />,
    );
    const idx = html.indexOf("Open a pull request");
    const buttonOpenIdx = html.indexOf("<button", idx);
    const buttonCloseIdx = html.indexOf(">", buttonOpenIdx);
    expect(html.slice(buttonOpenIdx, buttonCloseIdx)).toContain('disabled=""');
  });

  // --- Regression coverage -------------------------------------------------

  test("REG: the CI-gate sub-toggle checked-state always reflects the requireCiGreenToMerge prop directly, never a stale default, for a freshly-toggled-on merge action", () => {
    // Guards against a bug where the sub-toggle's checked state is computed
    // from some derived/local default instead of reading requireCiGreenToMerge
    // straight from props.
    const next = toggleGitHubAction(
      ["open_pull_request"],
      "merge_pull_request",
    );
    expect(next).toEqual(["open_pull_request", "merge_pull_request"]);

    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={next}
        onChange={noop}
        requireCiGreenToMerge={false}
        onRequireCiGreenChange={noop}
      />,
    );
    const idx = html.indexOf("Require CI checks to pass before merging");
    const switchIdx = html.indexOf('role="switch"', idx);
    expect(html.slice(idx, switchIdx + 100)).toContain(
      'data-state="unchecked"',
    );
  });

  test("REG: with zero enabled actions, every switch renders unchecked and no CI-gate sub-toggle renders", () => {
    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={[]}
        onChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenChange={noop}
      />,
    );
    const checkedMatches = html.match(/data-state="checked"/g) ?? [];
    expect(checkedMatches.length).toBe(0);
    expect(html).not.toContain("Require CI checks to pass before merging");
  });

  test("REG: disabling merge_pull_request (toggling it back off) removes both the CI-gate sub-toggle and the Irreversible caption, even with requireCiGreenToMerge=false left over from before", () => {
    // Guards against the sub-toggle/caption leaking from a stale
    // requireCiGreenToMerge value once merge_pull_request itself is turned
    // off — both must be strictly conditioned on
    // enabledActions.includes("merge_pull_request"), not on
    // requireCiGreenToMerge alone.
    const enabledWithMerge = toggleGitHubAction([], "merge_pull_request");
    const disabledAgain = toggleGitHubAction(
      enabledWithMerge,
      "merge_pull_request",
    );
    expect(disabledAgain).toEqual([]);

    const html = renderToStaticMarkup(
      <GitHubActionsSection
        enabledActions={disabledAgain}
        onChange={noop}
        requireCiGreenToMerge={false}
        onRequireCiGreenChange={noop}
      />,
    );
    expect(html).not.toContain("Require CI checks to pass before merging");
    const mergeIdx = html.indexOf("Merge a pull request");
    expect(html.slice(mergeIdx, mergeIdx + 400)).not.toContain("Irreversible");
  });
});
