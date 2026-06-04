/**
 * Failing tests for #162 review blockers in github-windows.tsx and page.tsx:
 * - LOW: errorMessage() has no invalid_repo case → add repo-not-found copy
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrSummary } from "./github-windows";
import { PullRequestsWindow } from "./github-windows";

describe("github-windows review-fix: LOW — invalid_repo error copy", () => {
  // LOW-A: invalid_repo errorKind shows repo-not-found copy (currently falls to default)
  test("LOW-A: invalid_repo errorKind shows repo-not-found copy, not generic fallback", () => {
    const summary: PrSummary = {
      ok: false,
      errorKind: "invalid_repo",
    };
    const html = renderToStaticMarkup(
      <PullRequestsWindow summary={summary} owner="acme" repo="widgets" />,
    );

    // Must show something specific about the repo not being found
    // Currently falls to default: "GitHub data could not be loaded."
    // After fix: should mention "not found" or "does not exist"
    expect(html).toMatch(/not found|does not exist|invalid|repo/i);
    // Must NOT only show the generic fallback message
    expect(html).not.toBe(expect.stringContaining("GitHub data could not be loaded."));
  });
});
