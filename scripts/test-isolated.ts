/**
 * Run every test file in its own `bun test` process.
 *
 * Each file gets an isolated process so module-level state, mocks, and globals
 * cannot leak between files. Unlike a naive serial loop, this runner:
 *
 *   1. runs files concurrently with a bounded worker pool, and
 *   2. collects every failure instead of stopping at the first one,
 *
 * so an agent (or human) sees the full set of failing files in a single run
 * instead of fixing one, re-running the whole suite, and repeating.
 *
 * Concurrency defaults to the machine's parallelism and can be overridden with
 * `TEST_CONCURRENCY`. Set `TEST_CONCURRENCY=1` to reproduce strict serial runs.
 */

const testPatterns = ["**/*.test.ts", "**/*.test.tsx"];

interface TestResult {
  readonly file: string;
  readonly exitCode: number;
  readonly output: string;
}

function isIgnoredPath(path: string): boolean {
  return (
    path.startsWith("node_modules/") ||
    path.includes("/node_modules/") ||
    path.startsWith(".")
  );
}

function resolveConcurrency(): number {
  const override = process.env.TEST_CONCURRENCY?.trim();
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const detected = navigator.hardwareConcurrency;
  if (Number.isFinite(detected) && detected > 0) {
    return Math.min(detected, 8);
  }

  return 4;
}

async function collectTestFiles(): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of testPatterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan(".")) {
      if (isIgnoredPath(path)) {
        continue;
      }
      files.add(path);
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

async function runTestFile(file: string): Promise<TestResult> {
  // Capture output instead of inheriting stdio so concurrent runs do not
  // interleave their lines into an unreadable stream.
  const process = Bun.spawn(["bun", "test", file], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { file, exitCode, output: `${stdout}${stderr}`.trim() };
}

async function runPool(
  files: string[],
  concurrency: number,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) {
        return;
      }

      const file = files[index];
      const result = await runTestFile(file);
      results.push(result);
      completed++;

      const status = result.exitCode === 0 ? "PASS" : "FAIL";
      console.log(`[${completed}/${files.length}] ${status} ${file}`);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

function reportFailures(failures: TestResult[]): void {
  console.error(`\n${failures.length} test file(s) failed:\n`);

  for (const failure of failures) {
    console.error(
      `──────── ${failure.file} (exit ${failure.exitCode}) ────────`,
    );
    if (failure.output) {
      console.error(failure.output);
    }
    console.error("");
  }

  console.error("Failed files:");
  for (const failure of failures.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ${failure.file}`);
  }
}

async function main(): Promise<void> {
  const files = await collectTestFiles();

  if (files.length === 0) {
    console.log("No test files found.");
    return;
  }

  const concurrency = resolveConcurrency();
  console.log(
    `Running ${files.length} test files in isolated processes (concurrency ${concurrency})...`,
  );

  const results = await runPool(files, concurrency);
  const failures = results.filter((result) => result.exitCode !== 0);

  if (failures.length > 0) {
    reportFailures(failures);
    process.exit(1);
  }

  console.log(`\nAll ${files.length} isolated test files passed.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
