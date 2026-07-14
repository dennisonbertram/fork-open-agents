import { describe, expect, test } from "bun:test";
import {
  countSkippedTests,
  isUnitTestPath,
  runIsolatedTests,
  type RunnerDependencies,
  type TestResult,
} from "./isolated-runner";

interface Harness {
  readonly dependencies: RunnerDependencies;
  readonly errors: string[];
  readonly logs: string[];
  readonly spawnedFiles: string[];
}

function createHarness(overrides: Partial<RunnerDependencies> = {}): Harness {
  const errors: string[] = [];
  const logs: string[] = [];
  const spawnedFiles: string[] = [];
  let clock = 100;

  const dependencies: RunnerDependencies = {
    bunVersion: "1.3.14",
    collectTestFiles: async () => ["first.test.ts", "second.test.ts"],
    concurrency: 2,
    error: (message) => errors.push(message),
    findMissingDependencies: async () => [],
    log: (message) => logs.push(message),
    now: () => {
      const current = clock;
      clock += 25;
      return current;
    },
    readExpectedBunVersion: async () => "1.3.14",
    runTestFile: async (file) => {
      spawnedFiles.push(file);
      return {
        crashed: false,
        exitCode: 0,
        file,
        output: "2 pass\n0 fail",
      };
    },
    ...overrides,
  };

  return { dependencies, errors, logs, spawnedFiles };
}

function summaryFrom(logs: readonly string[]): Record<string, unknown> {
  const line = logs.at(-1);
  if (!line) {
    throw new Error("runner did not emit a summary");
  }
  return JSON.parse(line) as Record<string, unknown>;
}

describe("isolated unit runner", () => {
  test("blocks before discovery or child processes when dependencies are missing", async () => {
    let discoveryCalled = false;
    const harness = createHarness({
      collectTestFiles: async () => {
        discoveryCalled = true;
        return ["must-not-run.test.ts"];
      },
      findMissingDependencies: async () => ["next", "zod"],
    });

    const outcome = await runIsolatedTests(harness.dependencies);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.summary.status).toBe("blocked");
    expect(outcome.summary.reason).toBe("dependency_missing");
    expect(discoveryCalled).toBeFalse();
    expect(harness.spawnedFiles).toEqual([]);
    expect(harness.errors.join("\n")).toContain("dependency_missing");
    expect(summaryFrom(harness.logs)).toMatchObject({
      filesDiscovered: 0,
      reason: "dependency_missing",
      status: "blocked",
    });
  });

  test("blocks before discovery or child processes on an exact Bun mismatch", async () => {
    let discoveryCalled = false;
    const harness = createHarness({
      bunVersion: "1.3.13",
      collectTestFiles: async () => {
        discoveryCalled = true;
        return ["must-not-run.test.ts"];
      },
    });

    const outcome = await runIsolatedTests(harness.dependencies);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.summary.reason).toBe("toolchain_version_mismatch");
    expect(discoveryCalled).toBeFalse();
    expect(harness.spawnedFiles).toEqual([]);
    expect(harness.errors.join("\n")).toContain(
      "expected 1.3.14; actual 1.3.13",
    );
  });

  test("keeps unit tests and excludes contract, integration, and journey directories", () => {
    expect(isUnitTestPath("apps/web/lib/auth/session.test.ts")).toBeTrue();
    expect(isUnitTestPath("packages/agent/open-agent.test.tsx")).toBeTrue();
    expect(isUnitTestPath("apps/web/tests/contract/auth.test.ts")).toBeFalse();
    expect(
      isUnitTestPath("apps/web/tests/integration/auth.test.ts"),
    ).toBeFalse();
    expect(isUnitTestPath("apps/web/tests/journey/login.test.tsx")).toBeFalse();
    expect(isUnitTestPath("node_modules/pkg/index.test.ts")).toBeFalse();
    expect(isUnitTestPath("apps/web/lib/not-a-test.ts")).toBeFalse();
  });

  test("runs every file and exits 1 with aggregate failure counts", async () => {
    const results = new Map<string, TestResult>([
      [
        "first.test.ts",
        {
          crashed: false,
          exitCode: 0,
          file: "first.test.ts",
          output: "1 pass\n1 skip",
        },
      ],
      [
        "second.test.ts",
        {
          crashed: false,
          exitCode: 1,
          file: "second.test.ts",
          output: "expect(received).toBe(expected)",
        },
      ],
    ]);
    const harness = createHarness({
      runTestFile: async (file) => {
        harness.spawnedFiles.push(file);
        const result = results.get(file);
        if (!result) {
          throw new Error(`missing fixture for ${file}`);
        }
        return result;
      },
    });

    const outcome = await runIsolatedTests(harness.dependencies);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toMatchObject({
      filesDiscovered: 2,
      filesFailed: 1,
      filesPassed: 1,
      reason: "test_child_failed",
      skippedTestsObserved: 1,
      status: "failed",
    });
    expect(harness.spawnedFiles.sort()).toEqual([
      "first.test.ts",
      "second.test.ts",
    ]);
    expect(harness.errors.join("\n")).toContain("second.test.ts");
  });

  test("distinguishes a child crash from a normal test failure", async () => {
    const harness = createHarness({
      collectTestFiles: async () => ["crashed.test.ts"],
      runTestFile: async (file) => ({
        crashed: true,
        exitCode: null,
        file,
        output: "spawn failed",
      }),
    });

    const outcome = await runIsolatedTests(harness.dependencies);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary.reason).toBe("test_child_crashed");
  });

  test("exits 0 and emits reliable pass, skip, and duration counts", async () => {
    const harness = createHarness({
      runTestFile: async (file) => {
        harness.spawnedFiles.push(file);
        return {
          crashed: false,
          exitCode: 0,
          file,
          output: file.startsWith("first")
            ? "3 pass\n2 skip\n0 fail"
            : "4 pass\n1 skipped\n0 fail",
        };
      },
    });

    const outcome = await runIsolatedTests(harness.dependencies);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.summary).toEqual({
      bunVersion: "1.3.14",
      durationMs: 25,
      filesDiscovered: 2,
      filesFailed: 0,
      filesPassed: 2,
      skippedTestsObserved: 3,
      status: "passed",
    });
    expect(summaryFrom(harness.logs)).toEqual(outcome.summary);
  });

  test("counts only Bun summary skip lines", () => {
    expect(
      countSkippedTests(
        "test name containing skip\n 2 skip\n1 skipped\nnot 4 skip here",
      ),
    ).toBe(3);
  });
});
