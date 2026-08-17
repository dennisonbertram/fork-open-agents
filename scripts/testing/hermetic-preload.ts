/**
 * Bun test preload — runs once per test process, before any test file.
 *
 * Marks the process as a test run so code that must not touch shared live
 * services can refuse to. Package scripts also export OPEN_AGENTS_TEST, but
 * scripts cannot cover the entry points this repo documents as normal:
 *
 *   bun test path/to/file.test.ts
 *   bun test --isolate <dir>
 *   bun test --watch
 *
 * Those bypass package.json entirely. A preload does not — Bun applies it to
 * every `bun test` invocation via bunfig.toml, however it was launched.
 *
 * Why not rely on NODE_ENV: `bun test` sets NODE_ENV=test only when it is
 * UNSET. Verified on Bun 1.2.14 — `NODE_ENV=production bun test` keeps
 * "production", which left inherited REDIS_URL credentials live for the whole
 * suite. That is the defect this file closes.
 */
process.env.OPEN_AGENTS_TEST = "1";
