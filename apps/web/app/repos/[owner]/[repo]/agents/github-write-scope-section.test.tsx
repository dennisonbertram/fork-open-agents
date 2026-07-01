/**
 * Behavior tests for GitHubWriteScopeSection and its pure describeWriteScope
 * helper. Uses renderToStaticMarkup (react-dom/server) — no JSDOM needed,
 * matching the established pattern in this directory (see
 * standard-toolpack-section.test.tsx). renderToStaticMarkup cannot simulate
 * clicks, so behavior assertions are limited to presence/disabled/captions;
 * click-driven state transitions are covered indirectly through
 * agent-spec-editor.test.tsx's initial-value round-trip test.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeWriteScope,
  GitHubWriteScopeSection,
} from "./github-write-scope-section";

const noop = () => {};

const baseProps = {
  hasWriteAction: true,
  repositorySelection: "all" as const,
  installationId: 123,
  repoOwner: "acme",
  repoName: "widgets",
  writeScopeMode: "this_repo" as const,
  writeScopeRepos: [] as string[],
  onChange: noop,
};

describe("describeWriteScope (pure helper)", () => {
  test("this_repo describes a single-repo scope", () => {
    expect(describeWriteScope("this_repo", 1)).toBe("this repo");
  });

  test("all_repos describes the installation-wide scope regardless of count", () => {
    expect(describeWriteScope("all_repos", 0)).toBe(
      "all repos your installation can reach",
    );
  });

  test("repo_list pluralizes correctly for exactly one repo", () => {
    expect(describeWriteScope("repo_list", 1)).toBe("1 repo");
  });

  test("repo_list pluralizes correctly for multiple repos", () => {
    expect(describeWriteScope("repo_list", 3)).toBe("3 repos");
  });
});

describe("GitHubWriteScopeSection", () => {
  test("when hasWriteAction is false the control is absent", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} hasWriteAction={false} />,
    );
    expect(html).not.toContain("Write scope");
    expect(html).not.toContain("All repos");
    expect(html).not.toContain("Specific repos");
  });

  test("when hasWriteAction is true the three-way scope choice renders", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} />,
    );
    expect(html).toContain("Write scope");
    expect(html).toContain("This repo");
    expect(html).toContain("All repos");
    expect(html).toContain("Specific repos");
  });

  test("'All repos' is disabled with an explanatory caption when repositorySelection is 'selected'", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} repositorySelection="selected" />,
    );
    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    const radioTag = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioTag).toContain('disabled=""');
    const snippet = html.slice(idx, idx + 300);
    expect(snippet).toContain(
      "Only available because your installation is set to all repos.",
    );
  });

  test("'All repos' is enabled with no caption when repositorySelection is 'all'", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} repositorySelection="all" />,
    );
    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    const radioTag = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioTag).not.toContain('disabled=""');
    const snippet = html.slice(idx, idx + 300);
    expect(snippet).not.toContain("Only available because");
  });

  test("'All repos' is disabled when repositorySelection is null (installation unknown)", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} repositorySelection={null} />,
    );
    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    const radioTag = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioTag).toContain('disabled=""');
  });

  test("'This repo' is checked by default", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} writeScopeMode="this_repo" />,
    );
    const idx = html.indexOf('value="this_repo"');
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    const radioTag = html.slice(radioOpenIdx, radioCloseIdx);
    expect(radioTag).toContain('checked=""');
  });

  test("selecting 'Specific repos' shows the repo search input", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} writeScopeMode="repo_list" />,
    );
    expect(html).toContain("Search repos");
  });

  test("already-selected repos render as chips when writeScopeMode is 'repo_list'", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection
        {...baseProps}
        writeScopeMode="repo_list"
        writeScopeRepos={["acme/other-repo"]}
      />,
    );
    expect(html).toContain("acme/other-repo");
  });

  test("disabled prop disables every write-scope radio", () => {
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection {...baseProps} disabled />,
    );
    const thisRepoIdx = html.indexOf('value="this_repo"');
    const openIdx = html.lastIndexOf("<input", thisRepoIdx);
    const closeIdx = html.indexOf("/>", thisRepoIdx);
    expect(html.slice(openIdx, closeIdx)).toContain('disabled=""');
  });

  // --- Regression coverage -------------------------------------------------

  test("REG: 'All repos' stays disabled+captioned even when writeScopeMode is already 'all_repos' but repositorySelection has since narrowed to 'selected'", () => {
    // Guards against a UI-only regression where an already-saved all_repos
    // agent would visually imply the choice is still safe even though the
    // installation's repositorySelection narrowed after save (the run-time
    // gate in write-scope.ts denies this at execution; the UI must not look
    // like it's still permitted).
    const html = renderToStaticMarkup(
      <GitHubWriteScopeSection
        {...baseProps}
        writeScopeMode="all_repos"
        repositorySelection="selected"
      />,
    );
    const idx = html.indexOf("All repos");
    const radioOpenIdx = html.lastIndexOf("<input", idx);
    const radioCloseIdx = html.indexOf("/>", idx);
    expect(html.slice(radioOpenIdx, radioCloseIdx)).toContain('disabled=""');
    expect(html.slice(idx, idx + 300)).toContain("Only available because");
  });

  test("REG: describeWriteScope never returns an empty string for any mode", () => {
    expect(describeWriteScope("this_repo", 1).length).toBeGreaterThan(0);
    expect(describeWriteScope("all_repos", 0).length).toBeGreaterThan(0);
    expect(describeWriteScope("repo_list", 0).length).toBeGreaterThan(0);
  });
});
