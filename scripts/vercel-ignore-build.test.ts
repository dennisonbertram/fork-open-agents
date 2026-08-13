import { describe, expect, test } from "bun:test";
import { shouldSkipBuild } from "./vercel-ignore-build.mjs";

/**
 * 90% of this project's deployments are previews: 282 of 312 over 12.52 days,
 * 738 build-minutes, $11.40/month. Two things drive that — every push to every
 * branch builds whether or not anyone is reviewing it, and a docs-only commit
 * builds the entire app.
 *
 * The decision must fail SAFE: anything this cannot positively identify as
 * skippable gets built. A wrongly skipped production deploy is a far worse
 * outcome than a wasted preview build.
 */
describe("shouldSkipBuild", () => {
  test("never skips production, whatever changed", () => {
    expect(
      shouldSkipBuild({
        vercelEnv: "production",
        pullRequestId: null,
        changedFiles: ["README.md"],
      }),
    ).toEqual({ skip: false, reason: "production" });
  });

  test("skips a preview on a branch with no open pull request", () => {
    // Vercel sets VERCEL_GIT_PULL_REQUEST_ID only for a branch with an open
    // PR. No PR means nobody is reviewing this preview.
    expect(
      shouldSkipBuild({
        vercelEnv: "preview",
        pullRequestId: null,
        changedFiles: ["apps/web/app/page.tsx"],
      }),
    ).toEqual({ skip: true, reason: "no_open_pull_request" });
  });

  test("builds a preview once a pull request is open", () => {
    expect(
      shouldSkipBuild({
        vercelEnv: "preview",
        pullRequestId: "1216",
        changedFiles: ["apps/web/app/page.tsx"],
      }).skip,
    ).toBe(false);
  });

  test("skips a docs-only change even with an open pull request", () => {
    expect(
      shouldSkipBuild({
        vercelEnv: "preview",
        pullRequestId: "1216",
        changedFiles: [
          "docs/process/release-merge-train.md",
          "AGENTS.md",
          "docs/process/index.md",
        ],
      }),
    ).toEqual({ skip: true, reason: "docs_only" });
  });

  test("builds when a docs change is mixed with code", () => {
    expect(
      shouldSkipBuild({
        vercelEnv: "preview",
        pullRequestId: "1216",
        changedFiles: ["docs/plan.md", "apps/web/lib/sandbox/config.ts"],
      }).skip,
    ).toBe(false);
  });

  test("does not treat a config or workflow file as docs", () => {
    // .github/workflows/*.yml and package.json are text, but they change what
    // the build does. Only prose is safe to skip.
    for (const file of [
      ".github/workflows/ci.yml",
      "package.json",
      "apps/web/vercel.json",
    ]) {
      expect(
        shouldSkipBuild({
          vercelEnv: "preview",
          pullRequestId: "1216",
          changedFiles: [file],
        }).skip,
      ).toBe(false);
    }
  });

  test("builds when the changed-file list is unavailable", () => {
    // An empty list means the diff could not be computed — a shallow clone, a
    // first commit on a branch. Never read that as "nothing changed".
    expect(
      shouldSkipBuild({
        vercelEnv: "preview",
        pullRequestId: "1216",
        changedFiles: [],
      }),
    ).toEqual({ skip: false, reason: "no_diff_available" });
  });

  test("builds for an unknown environment", () => {
    expect(
      shouldSkipBuild({
        vercelEnv: undefined,
        pullRequestId: null,
        changedFiles: ["README.md"],
      }).skip,
    ).toBe(false);
  });
});
