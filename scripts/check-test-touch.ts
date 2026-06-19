/**
 * Make "behavior changed but no test changed" visible instead of silent.
 *
 * The Behavior-First TDD and Regression Discipline docs require a test for
 * behavior changes, but that has been prose-only. This is a heuristic backstop:
 * if a PR changes meaningful source files (lib, API routes, agent/sandbox
 * packages, db schema) without touching any `*.test.ts(x)` file, it flags it.
 *
 * By default this only WARNS (exit 0) so legitimate refactors, type-only, and
 * doc changes are not blocked. Set `STRICT_TEST_TOUCH=1` to make it fail the
 * build — useful once the team wants a hard gate. It compares against
 * `BASE_REF` (default `origin/main`) and skips cleanly outside a git diff.
 */

const WATCHED_SOURCE = [
  /^apps\/web\/lib\/.*\.(ts|tsx)$/,
  /^apps\/web\/app\/api\/.*\.(ts|tsx)$/,
  /^packages\/[^/]+\/.*\.(ts|tsx)$/,
];

const TEST_FILE = /\.test\.(ts|tsx)$/;

function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

function isWatchedSource(path: string): boolean {
  if (isTestFile(path)) {
    return false;
  }
  return WATCHED_SOURCE.some((pattern) => pattern.test(path));
}

function getBaseRef(): string {
  return process.env.BASE_REF?.trim() || "origin/main";
}

function listChangedFiles(baseRef: string): string[] | null {
  const proc = Bun.spawnSync(
    ["git", "diff", "--name-only", `${baseRef}...HEAD`],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    console.warn(
      `test-touch: could not diff against ${baseRef} (${stderr || "unknown error"}); skipping.`,
    );
    return null;
  }

  return proc.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function annotate(message: string): void {
  // Surfaces as a warning annotation on the PR when run in GitHub Actions.
  console.log(`::warning::${message}`);
}

function main(): void {
  const strict = process.env.STRICT_TEST_TOUCH === "1";
  const baseRef = getBaseRef();
  const changed = listChangedFiles(baseRef);

  if (changed === null || changed.length === 0) {
    console.log("✓ test-touch: nothing to check.");
    return;
  }

  const sourceChanges = changed.filter(isWatchedSource);
  const testChanges = changed.filter(isTestFile);

  if (sourceChanges.length === 0 || testChanges.length > 0) {
    console.log(
      `✓ test-touch: ${sourceChanges.length} source change(s), ${testChanges.length} test change(s).`,
    );
    return;
  }

  const message =
    `${sourceChanges.length} source file(s) changed without any test change. ` +
    "Add a behavior/regression test or document the exception in the PR " +
    "(see docs/process/behavior-tdd.md).";

  if (strict) {
    console.error(`❌ test-touch: ${message}`);
    for (const file of sourceChanges) {
      console.error(`   ${file}`);
    }
    process.exit(1);
  }

  annotate(message);
  console.log(`⚠ test-touch: ${message}`);
  for (const file of sourceChanges) {
    console.log(`   ${file}`);
  }
}

main();
