/**
 * Run every unit test file in its own `bun test` process.
 *
 * The runner preflights the checkout before discovery, keeps contract and
 * integration lanes out of unit results, and aggregates every child failure.
 * `TEST_CONCURRENCY=1` reproduces a strict serial run.
 */

import {
  createDefaultRunnerDependencies,
  runIsolatedTests,
} from "./testing/isolated-runner";

const outcome = await runIsolatedTests(createDefaultRunnerDependencies());
process.exitCode = outcome.exitCode;
