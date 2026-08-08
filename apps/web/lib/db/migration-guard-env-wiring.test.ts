import { describe, expect, test } from "bun:test";

/**
 * The guard in `migrate.ts` is only as good as the environment it can see.
 *
 * Root `bun run build` invokes `turbo build`, and Turbo's strict environment
 * mode passes ONLY the variables declared in the build task's `env` list. When
 * `PRODUCTION_DB_HOST` was missing from that list the guard received
 * `productionHost: undefined` and failed open on every real build — inert
 * exactly where it was needed.
 *
 * `VERCEL_ENV` is the sharper edge: with the host declared but the environment
 * stripped, a production deploy looks like a local build and gets REFUSED,
 * which would block every release. The guard's inputs only work as a set.
 *
 * This test pins the Turbo config to what the code actually reads, so the two
 * cannot drift apart again silently.
 */

const TURBO_CONFIG_PATH = new URL("../../../../turbo.json", import.meta.url);
const MIGRATE_ENTRY_PATH = new URL("migrate.ts", import.meta.url);

type TurboConfig = {
  tasks?: Record<string, { env?: string[] }>;
  pipeline?: Record<string, { env?: string[] }>;
};

async function buildTaskEnv(): Promise<string[]> {
  const config = (await Bun.file(TURBO_CONFIG_PATH).json()) as TurboConfig;
  const tasks = config.tasks ?? config.pipeline ?? {};
  return tasks.build?.env ?? [];
}

/** Every `process.env.X` the migration entry point reads. */
async function migrationEnvReads(): Promise<string[]> {
  const source = await Bun.file(MIGRATE_ENTRY_PATH).text();
  const reads = source.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  return [...new Set([...reads].map((match) => match[1] as string))];
}

describe("migration guard env wiring", () => {
  test("turbo build passes every variable the migration entry point reads", async () => {
    const declared = new Set(await buildTaskEnv());
    const missing = (await migrationEnvReads()).filter(
      (name) => !declared.has(name),
    );

    expect(missing).toEqual([]);
  });

  // Named explicitly so a future edit that drops one of these fails loudly with
  // an obvious reason, rather than silently disarming the guard.
  test.each([
    ["POSTGRES_URL", "the guard cannot see the target database"],
    ["PRODUCTION_DB_HOST", "the guard fails open and never fires"],
    ["VERCEL_ENV", "a production deploy looks local and gets refused"],
    ["ALLOW_PRODUCTION_MIGRATION", "the operator override cannot be used"],
  ])("turbo build declares %s — without it, %s", async (name) => {
    expect(await buildTaskEnv()).toContain(name);
  });
});
