/**
 * Behavior tests for GitHubToolCard component and permissionsToAccess helper.
 * Uses renderToStaticMarkup (react-dom/server) — no JSDOM needed.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubToolCard, permissionsToAccess } from "./github-tool-card";

describe("permissionsToAccess", () => {
  test("both write => 'pr'", () => {
    expect(permissionsToAccess("write", "write")).toBe("pr");
  });

  test("contents read, pullRequests write => 'read-only'", () => {
    expect(permissionsToAccess("read", "write")).toBe("read-only");
  });

  test("both read => 'read-only'", () => {
    expect(permissionsToAccess("read", "read")).toBe("read-only");
  });

  test("contents write, pullRequests read => 'read-only'", () => {
    expect(permissionsToAccess("write", "read")).toBe("read-only");
  });
});

describe("GitHubToolCard", () => {
  const noop = () => {};

  test("renders GitHub identity (name visible in output)", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("GitHub");
  });

  test("renders 'Required' badge (non-removable)", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("Required");
  });

  test("renders both segmented options: Read-only and Open pull requests", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("Read-only");
    expect(html).toContain("Open pull requests");
  });

  test("read-only access: Read-only button is aria-pressed=true, PR button is false", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    // Read-only button should come first with aria-pressed="true"
    const readOnlyIdx = html.indexOf("Read-only");
    const prIdx = html.indexOf("Open pull requests");
    // Read-only pressed
    const beforeReadOnly = html.slice(0, readOnlyIdx);
    const lastButtonBeforeReadOnly = beforeReadOnly.lastIndexOf("<button");
    expect(html.slice(lastButtonBeforeReadOnly, readOnlyIdx)).toContain(
      'aria-pressed="true"',
    );
    // PR button pressed=false
    const beforePr = html.slice(0, prIdx);
    const lastButtonBeforePr = beforePr.lastIndexOf("<button");
    expect(html.slice(lastButtonBeforePr, prIdx)).toContain(
      'aria-pressed="false"',
    );
  });

  test("pr access: PR button is aria-pressed=true, Read-only is false", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="pr" onChange={noop} />,
    );
    const readOnlyIdx = html.indexOf("Read-only");
    const prIdx = html.indexOf("Open pull requests");
    // Read-only pressed=false
    const beforeReadOnly = html.slice(0, readOnlyIdx);
    const lastButtonBeforeReadOnly = beforeReadOnly.lastIndexOf("<button");
    expect(html.slice(lastButtonBeforeReadOnly, readOnlyIdx)).toContain(
      'aria-pressed="false"',
    );
    // PR pressed=true
    const beforePr = html.slice(0, prIdx);
    const lastButtonBeforePr = beforePr.lastIndexOf("<button");
    expect(html.slice(lastButtonBeforePr, prIdx)).toContain(
      'aria-pressed="true"',
    );
  });

  test("read-only description copy is present when access=read-only", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("change anything");
  });

  test("PR description copy is present when access=pr", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="pr" onChange={noop} />,
    );
    expect(html).toContain("Never merges");
  });

  test("autonomy sentence: read-only => 'can look but not touch'", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("can look but not touch");
  });

  test("autonomy sentence: pr => 'propose changes as pull requests'", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="pr" onChange={noop} />,
    );
    expect(html).toContain("propose changes as pull requests");
  });

  test("static permissions (issues, deployments, checks) always shown", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain("issues");
    expect(html).toContain("deployments");
    expect(html).toContain("checks");
  });

  test("disabled prop renders buttons with disabled attribute", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} disabled />,
    );
    // Both segmented control buttons should be disabled
    const matches = html.match(/disabled=""/g);
    // At least 2 disabled buttons (the two segmented options)
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("group role is present for accessibility", () => {
    const html = renderToStaticMarkup(
      <GitHubToolCard access="read-only" onChange={noop} />,
    );
    expect(html).toContain('role="group"');
  });
});
