#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" decision.
 *
 * Wired as `ignoreCommand` in apps/web/vercel.json. Vercel reads the exit
 * code: 0 skips the build, non-zero proceeds with it.
 *
 * Plain JavaScript run by node on purpose: the ignore step executes before the
 * install step, so bun is not guaranteed to exist in the build image yet, and
 * a crashing ignore command is a broken deploy pipeline.
 *
 * Why it exists: 282 of 312 deployments over 12.52 days were previews, 738
 * build-minutes and $11.40/month, because every push to every branch builds
 * the whole app — including commits that only touch prose.
 *
 * The rule is deliberately conservative. Production always builds. A preview
 * builds unless it is provably unreviewed (no open pull request) or provably
 * prose-only. Anything this cannot classify builds.
 */

import { execFileSync } from "node:child_process";

/** Paths whose contents cannot change what the deployed app does. */
const DOCS_ONLY_PATTERNS = [
  /^docs\//,
  /^\.agents\//,
  /^[^/]*\.md$/,
  /^LICENSE$/,
];

/**
 * @param {{ vercelEnv: string | undefined, pullRequestId: string | null, changedFiles: string[] }} input
 *   The deployment context: VERCEL_ENV, the pull-request id Vercel sets only
 *   for a branch with an open PR, and the repo-relative paths this deployment
 *   changed (empty when the diff could not be computed).
 * @returns {{ skip: boolean, reason: "production" | "no_open_pull_request" | "docs_only" | "no_diff_available" | "builds" }}
 *   Whether to skip the build, and the reason, which is logged so an operator
 *   can tell a deliberate skip from a broken pipeline.
 */
export function shouldSkipBuild(input) {
  if (input.vercelEnv === "production") {
    return { skip: false, reason: "production" };
  }
  if (input.vercelEnv !== "preview") {
    return { skip: false, reason: "builds" };
  }

  // Vercel populates this only for a branch with an open pull request, so its
  // absence means nobody is reviewing this preview yet. A preview appears as
  // soon as the PR is opened, because that push re-evaluates this decision.
  if (!input.pullRequestId) {
    return { skip: true, reason: "no_open_pull_request" };
  }

  // An empty list means the diff could not be computed, not that nothing
  // changed. Build.
  if (input.changedFiles.length === 0) {
    return { skip: false, reason: "no_diff_available" };
  }

  if (
    input.changedFiles.every((file) =>
      DOCS_ONLY_PATTERNS.some((pattern) => pattern.test(file)),
    )
  ) {
    return { skip: true, reason: "docs_only" };
  }

  return { skip: false, reason: "builds" };
}

function readChangedFiles() {
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!(previousSha && commitSha)) {
    return [];
  }
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", `${previousSha}...${commitSha}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());

if (invokedDirectly) {
  const decision = shouldSkipBuild({
    vercelEnv: process.env.VERCEL_ENV,
    pullRequestId: process.env.VERCEL_GIT_PULL_REQUEST_ID || null,
    changedFiles: readChangedFiles(),
  });
  console.log(
    `[vercel-ignore-build] ${decision.skip ? "skipping" : "building"} (${decision.reason})`,
  );
  process.exit(decision.skip ? 0 : 1);
}
