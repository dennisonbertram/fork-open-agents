/**
 * Behavior tests for StandardToolpackSection and its pure toggle helper.
 * Uses renderToStaticMarkup (react-dom/server) — no JSDOM needed, matching
 * the established pattern in this directory (see agent-spec-editor.test.tsx,
 * and the deleted github-tool-card.test.tsx).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_ON_TOOL_NAMES,
  STANDARD_TOOLPACK_ITEMS,
} from "@/lib/background-agents/builtin-toolpack";
import {
  DEFAULT_ENABLED_ACTIONS,
  GITHUB_TOOL_ACTIONS,
  type GitHubToolAction,
} from "@/lib/background-agents/github-actions";
import {
  StandardToolpackSection,
  toggleBuiltinToolName,
} from "./standard-toolpack-section";

const noop = () => {};
const noopBool = () => {};

const defaultGithubActionsProps = {
  enabledActions: [...DEFAULT_ENABLED_ACTIONS] as GitHubToolAction[],
  onEnabledActionsChange: noop,
  requireCiGreenToMerge: true,
  onRequireCiGreenToMergeChange: noopBool,
};

describe("toggleBuiltinToolName (pure helper)", () => {
  test("removes a name that is present", () => {
    expect(toggleBuiltinToolName(["bash", "read"], "bash")).toEqual(["read"]);
  });

  test("adds a name that is absent", () => {
    expect(toggleBuiltinToolName(["read"], "bash")).toEqual(["read", "bash"]);
  });

  test("does not mutate the input array", () => {
    const input = ["bash", "read"];
    toggleBuiltinToolName(input, "bash");
    expect(input).toEqual(["bash", "read"]);
  });
});

describe("StandardToolpackSection", () => {
  test("the old fixed 'GitHub (scoped to this repo)' row and its 'Always on' badge are gone", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    expect(html).not.toContain("GitHub (scoped to this repo)");
    expect(html).not.toContain("Always on");
  });

  test("renders the GitHubActionsSection disclosure with a switch for every GitHub action plus one per built-in tool", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    expect(html).toContain("GitHub actions");
    const switchMatches = html.match(/role="switch"/g) ?? [];
    // 11 built-ins + 7 GitHub actions; no merge sub-toggle since
    // merge_pull_request isn't in the default enabled set.
    expect(switchMatches.length).toBe(
      STANDARD_TOOLPACK_ITEMS.length + GITHUB_TOOL_ACTIONS.length,
    );
  });

  test("destructive GitHub actions render 'Irreversible' captions in context (push, delete_branch, merge with gate off)", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        enabledActions={["push", "delete_branch", "merge_pull_request"]}
        onEnabledActionsChange={noop}
        requireCiGreenToMerge={false}
        onRequireCiGreenToMergeChange={noopBool}
      />,
    );
    const pushIdx = html.indexOf("Push commits");
    const deleteIdx = html.indexOf("Delete a branch");
    const mergeIdx = html.indexOf("Merge a pull request");
    expect(html.slice(pushIdx, pushIdx + 400)).toContain("Irreversible");
    expect(html.slice(deleteIdx, deleteIdx + 400)).toContain("Irreversible");
    expect(html.slice(mergeIdx, mergeIdx + 400)).toContain("Irreversible");
  });

  test("renders a toggle for each STANDARD_TOOLPACK_ITEMS name", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    for (const label of [
      "Todo tracking",
      "Read files",
      "Write files",
      "Edit files",
      "Search file contents (grep)",
      "Find files (glob)",
      "Run shell commands",
      "Delegate to subagents",
      "Ask a clarifying question",
      "Load skills",
      "Fetch external URLs",
    ]) {
      expect(html).toContain(label);
    }
  });

  test("write/edit/bash captions clarify sandbox-only scope, distinct from real repo writes", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    expect(html).toContain("Only affects this run&#x27;s temporary sandbox");
    const writeIdx = html.indexOf("Write files");
    const editIdx = html.indexOf("Edit files");
    const bashIdx = html.indexOf("Run shell commands");
    const captionCount =
      html.split("Only affects this run&#x27;s temporary sandbox").length - 1;
    expect(captionCount).toBe(3);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeGreaterThan(-1);
    expect(bashIdx).toBeGreaterThan(-1);
  });

  test("web_fetch toggle is unchecked when enabledToolNames omits it", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    const idx = html.indexOf("Fetch external URLs");
    const switchOpenIdx = html.indexOf('role="switch"', idx);
    const snippet = html.slice(idx, switchOpenIdx + 100);
    expect(snippet).toContain('data-state="unchecked"');
  });

  test("bash toggle is checked when enabledToolNames includes it", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    const idx = html.indexOf("Run shell commands");
    const switchOpenIdx = html.indexOf('role="switch"', idx);
    const snippet = html.slice(idx, switchOpenIdx + 100);
    expect(snippet).toContain('data-state="checked"');
  });

  test("disabled prop renders switch buttons with the disabled attribute", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
        disabled
      />,
    );
    // Extract just the opening <button role="switch" ...> tag for the bash
    // row and confirm it carries the disabled attribute.
    const idx = html.indexOf("Run shell commands");
    const buttonOpenIdx = html.indexOf("<button", idx);
    const buttonCloseIdx = html.indexOf(">", buttonOpenIdx);
    const tag = html.slice(buttonOpenIdx, buttonCloseIdx);
    expect(tag).toContain('role="switch"');
    expect(tag).toContain('disabled=""');
  });

  test("without the disabled prop, switch buttons are not disabled", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    const idx = html.indexOf("Run shell commands");
    const buttonOpenIdx = html.indexOf("<button", idx);
    const buttonCloseIdx = html.indexOf(">", buttonOpenIdx);
    const tag = html.slice(buttonOpenIdx, buttonCloseIdx);
    expect(tag).toContain('role="switch"');
    expect(tag).not.toContain('disabled=""');
  });

  // --- Regression coverage -------------------------------------------------

  test("REG: built-in switch states are independent of enabledActions — only the GitHub actions list changes", () => {
    const enabledToolNames = ["bash"];
    const noneHtml = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={enabledToolNames}
        onChange={noop}
        enabledActions={[]}
        onEnabledActionsChange={noop}
        requireCiGreenToMerge={true}
        onRequireCiGreenToMergeChange={noopBool}
      />,
    );
    const readyPrHtml = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={enabledToolNames}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );

    // This would fail if a future change accidentally re-coupled
    // enabledActions to the built-in toggle states (the exact two-control
    // coupling bug this issue's step-2 already fixed for GitHub write
    // permission — a regression here would silently reintroduce a similar
    // coupling for the toolpack).
    for (const label of [
      "Run shell commands",
      "Read files",
      "Fetch external URLs",
    ]) {
      const noneIdx = noneHtml.indexOf(label);
      const noneButtonIdx = noneHtml.indexOf("<button", noneIdx);
      const noneTag = noneHtml.slice(
        noneButtonIdx,
        noneHtml.indexOf(">", noneButtonIdx),
      );

      const prIdx = readyPrHtml.indexOf(label);
      const prButtonIdx = readyPrHtml.indexOf("<button", prIdx);
      const prTag = readyPrHtml.slice(
        prButtonIdx,
        readyPrHtml.indexOf(">", prButtonIdx),
      );

      const noneChecked = noneTag.includes('data-state="checked"');
      const prChecked = prTag.includes('data-state="checked"');
      expect(prChecked).toBe(noneChecked);
    }

    // Sanity: the GitHub actions list DID change (proves the two renders
    // aren't identical for an unrelated reason, e.g. a broken enabledActions
    // prop wire-up).
    const noneCheckedCount = (noneHtml.match(/data-state="checked"/g) ?? [])
      .length;
    const prCheckedCount = (readyPrHtml.match(/data-state="checked"/g) ?? [])
      .length;
    expect(prCheckedCount).toBeGreaterThan(noneCheckedCount);
  });

  test("REG: STANDARD_TOOLPACK_ITEMS has no github-like name — the GitHub action list is a fixed, separate set from the built-in toolpack", () => {
    // Guards against a future edit that accidentally adds a "github" (or
    // similarly named) entry to STANDARD_TOOLPACK_ITEMS, which would double
    // up with the dedicated GitHubActionsSection list.
    for (const item of STANDARD_TOOLPACK_ITEMS) {
      expect(item.name.toLowerCase()).not.toContain("github");
    }

    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        {...defaultGithubActionsProps}
      />,
    );
    const switchMatches = html.match(/role="switch"/g) ?? [];
    expect(switchMatches.length).toBe(
      STANDARD_TOOLPACK_ITEMS.length + GITHUB_TOOL_ACTIONS.length,
    );
  });
});
