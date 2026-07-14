import { dirname, join } from "node:path";

const TEST_PATTERNS = ["**/*.test.ts", "**/*.test.tsx"] as const;
const WORKSPACE_MANIFEST_PATTERNS = [
  "apps/*/package.json",
  "packages/*/package.json",
] as const;
const NON_UNIT_DIRECTORY_NAMES = new Set([
  "contract",
  "integration",
  "journey",
]);

export type TestSummaryReason =
  | "dependency_missing"
  | "toolchain_version_mismatch"
  | "test_child_failed"
  | "test_child_crashed";

export interface TestResult {
  readonly crashed: boolean;
  readonly exitCode: number | null;
  readonly file: string;
  readonly output: string;
}

export interface TestSummary {
  readonly bunVersion: string;
  readonly durationMs: number;
  readonly filesDiscovered: number;
  readonly filesFailed: number;
  readonly filesPassed: number;
  readonly reason?: TestSummaryReason;
  readonly skippedTestsObserved: number;
  readonly status: "blocked" | "failed" | "passed";
}

export interface RunnerOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly summary: TestSummary;
}

export interface RunnerDependencies {
  readonly bunVersion: string;
  readonly collectTestFiles: () => Promise<string[]>;
  readonly concurrency: number;
  readonly error: (message: string) => void;
  readonly findMissingDependencies: () => Promise<string[]>;
  readonly log: (message: string) => void;
  readonly now: () => number;
  readonly readExpectedBunVersion: () => Promise<string | null>;
  readonly runTestFile: (file: string) => Promise<TestResult>;
}

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly packageManager?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.some(([, version]) => typeof version !== "string")) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function parsePackageManifest(value: unknown): PackageManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    dependencies: stringRecord(value.dependencies),
    devDependencies: stringRecord(value.devDependencies),
    packageManager:
      typeof value.packageManager === "string"
        ? value.packageManager
        : undefined,
  };
}

function expectedBunVersion(packageManager: string | undefined): string | null {
  const match = packageManager?.match(/^bun@(.+)$/);
  return match?.[1] ?? null;
}

export function isUnitTestPath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (
    segments.some(
      (segment) => segment === "node_modules" || segment.startsWith("."),
    )
  ) {
    return false;
  }
  if (segments.some((segment) => NON_UNIT_DIRECTORY_NAMES.has(segment))) {
    return false;
  }

  return /\.test\.tsx?$/.test(segments.at(-1) ?? "");
}

export function countSkippedTests(output: string): number {
  let skipped = 0;
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+skip(?:ped)?$/);
    if (match?.[1]) {
      skipped += Number.parseInt(match[1], 10);
    }
  }
  return skipped;
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

async function readManifest(path: string): Promise<PackageManifest | null> {
  try {
    return parsePackageManifest(await Bun.file(path).json());
  } catch {
    return null;
  }
}

async function collectManifestPaths(cwd: string): Promise<string[]> {
  const paths = new Set<string>(["package.json"]);
  for (const pattern of WORKSPACE_MANIFEST_PATTERNS) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan(cwd)) {
      paths.add(path);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function dependencyNames(manifest: PackageManifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

function dependencyResolves(name: string, from: string): boolean {
  try {
    Bun.resolveSync(`${name}/package.json`, from);
    return true;
  } catch {
    try {
      Bun.resolveSync(name, from);
      return true;
    } catch {
      return false;
    }
  }
}

async function findMissingDependencies(cwd: string): Promise<string[]> {
  const missing = new Set<string>();
  for (const relativePath of await collectManifestPaths(cwd)) {
    const absolutePath = join(cwd, relativePath);
    const manifest = await readManifest(absolutePath);
    if (!manifest) {
      missing.add(`${relativePath}:invalid_manifest`);
      continue;
    }

    const from = dirname(absolutePath);
    for (const name of dependencyNames(manifest)) {
      if (!dependencyResolves(name, from)) {
        missing.add(name);
      }
    }
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

async function collectTestFiles(cwd: string): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of TEST_PATTERNS) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan(cwd)) {
      if (isUnitTestPath(path)) {
        files.add(path);
      }
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

async function runTestFile(cwd: string, file: string): Promise<TestResult> {
  try {
    const child = Bun.spawn([process.execPath, "test", file], {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      crashed: false,
      exitCode,
      file,
      output: `${stdout}${stderr}`.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { crashed: true, exitCode: null, file, output: message };
  }
}

async function runPool(
  files: readonly string[],
  dependencies: RunnerDependencies,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let completed = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      if (!file) {
        return;
      }

      const result = await dependencies.runTestFile(file);
      results.push(result);
      completed += 1;
      const status = result.exitCode === 0 && !result.crashed ? "PASS" : "FAIL";
      dependencies.log(`[${completed}/${files.length}] ${status} ${file}`);
    }
  }

  const workerCount = Math.min(dependencies.concurrency, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function reportFailures(
  failures: readonly TestResult[],
  error: (message: string) => void,
): void {
  error(`\n${failures.length} test file(s) failed:\n`);
  for (const failure of failures) {
    const exit =
      failure.exitCode === null ? "crashed" : `exit ${failure.exitCode}`;
    error(`──────── ${failure.file} (${exit}) ────────`);
    if (failure.output) {
      error(failure.output);
    }
    error("");
  }

  error("Failed files:");
  for (const failure of [...failures].sort((left, right) =>
    left.file.localeCompare(right.file),
  )) {
    error(`  ${failure.file}`);
  }
}

function finish(
  dependencies: RunnerDependencies,
  startedAt: number,
  exitCode: 0 | 1 | 2,
  summary: Omit<TestSummary, "durationMs">,
): RunnerOutcome {
  const completedSummary: TestSummary = {
    ...summary,
    durationMs: Math.max(0, dependencies.now() - startedAt),
  };
  dependencies.log(JSON.stringify(completedSummary));
  return { exitCode, summary: completedSummary };
}

export async function runIsolatedTests(
  dependencies: RunnerDependencies,
): Promise<RunnerOutcome> {
  const startedAt = dependencies.now();
  const emptyCounts = {
    filesDiscovered: 0,
    filesFailed: 0,
    filesPassed: 0,
    skippedTestsObserved: 0,
  } as const;

  const missingDependencies = await dependencies.findMissingDependencies();
  if (missingDependencies.length > 0) {
    dependencies.error(
      `[preflight] BLOCKED dependency_missing (${missingDependencies.length} unresolved: ${missingDependencies.slice(0, 5).join(", ")})`,
    );
    return finish(dependencies, startedAt, 2, {
      ...emptyCounts,
      bunVersion: dependencies.bunVersion,
      reason: "dependency_missing",
      status: "blocked",
    });
  }

  const expectedVersion = await dependencies.readExpectedBunVersion();
  if (expectedVersion !== dependencies.bunVersion) {
    dependencies.error(
      `[preflight] BLOCKED toolchain_version_mismatch (expected ${expectedVersion ?? "bun@<missing>"}; actual ${dependencies.bunVersion})`,
    );
    return finish(dependencies, startedAt, 2, {
      ...emptyCounts,
      bunVersion: dependencies.bunVersion,
      reason: "toolchain_version_mismatch",
      status: "blocked",
    });
  }

  dependencies.log(
    `[preflight] PASS dependencies resolved; Bun ${dependencies.bunVersion}`,
  );
  const files = await dependencies.collectTestFiles();
  if (files.length === 0) {
    dependencies.log("No unit test files found.");
    return finish(dependencies, startedAt, 0, {
      ...emptyCounts,
      bunVersion: dependencies.bunVersion,
      status: "passed",
    });
  }

  dependencies.log(
    `Running ${files.length} unit test files in isolated processes (concurrency ${dependencies.concurrency})...`,
  );
  const results = await runPool(files, dependencies);
  const failures = results.filter(
    (result) => result.crashed || result.exitCode !== 0,
  );
  const skippedTestsObserved = results.reduce(
    (total, result) => total + countSkippedTests(result.output),
    0,
  );

  if (failures.length > 0) {
    reportFailures(failures, dependencies.error);
    const reason: TestSummaryReason = failures.some(
      (failure) => failure.crashed,
    )
      ? "test_child_crashed"
      : "test_child_failed";
    return finish(dependencies, startedAt, 1, {
      bunVersion: dependencies.bunVersion,
      filesDiscovered: files.length,
      filesFailed: failures.length,
      filesPassed: results.length - failures.length,
      reason,
      skippedTestsObserved,
      status: "failed",
    });
  }

  dependencies.log(`\nAll ${files.length} isolated unit test files passed.`);
  return finish(dependencies, startedAt, 0, {
    bunVersion: dependencies.bunVersion,
    filesDiscovered: files.length,
    filesFailed: 0,
    filesPassed: results.length,
    skippedTestsObserved,
    status: "passed",
  });
}

export function createDefaultRunnerDependencies(
  cwd = process.cwd(),
): RunnerDependencies {
  return {
    bunVersion: Bun.version,
    collectTestFiles: () => collectTestFiles(cwd),
    concurrency: resolveConcurrency(),
    error: console.error,
    findMissingDependencies: () => findMissingDependencies(cwd),
    log: console.log,
    now: Date.now,
    readExpectedBunVersion: async () => {
      const manifest = await readManifest(join(cwd, "package.json"));
      return expectedBunVersion(manifest?.packageManager);
    },
    runTestFile: (file) => runTestFile(cwd, file),
  };
}
