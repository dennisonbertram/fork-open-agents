import { describe, expect, test } from "bun:test";

/**
 * Executable half of `docs/process/guard-integrity.md`.
 *
 * A guard is only as good as its inputs. This repo has shipped guards that
 * passed their own unit tests and did nothing in production because a variable
 * they read was never delivered:
 *
 * - stripped by Turbo's strict env allowlist, so the guard failed open in every
 *   real build (#1167)
 * - absent from `.env.example`, so it was unarmed on every fresh checkout
 *
 * Those are configuration failures, and configuration is what unit tests skip.
 * This file asserts the delivery path for the migration guard's inputs instead
 * of the guard's logic, which is covered in `migration-target-guard.test.ts`.
 *
 * The expected set is derived from `migrate.ts` itself rather than hardcoded, so
 * adding a `process.env` read there fails this test until the value is actually
 * wired through.
 */

const REPO_ROOT = new URL("../../../../", import.meta.url);
const MIGRATE_ENTRY = new URL("apps/web/lib/db/migrate.ts", REPO_ROOT);
const TURBO_CONFIG = new URL("turbo.json", REPO_ROOT);
const ENV_EXAMPLE = new URL("apps/web/.env.example", REPO_ROOT);

/**
 * Variables a checkout must supply for the guard to be armed.
 *
 * `.env.example` DOCUMENTS these; it does not arm them — the template ships
 * them empty, and an empty value makes the guard fail open. Key presence is
 * therefore not evidence of an armed guard, which is why the arming check below
 * tests `init.sh`'s warning rather than the template's contents.
 *
 * `POSTGRES_URL` is excluded deliberately: it is the target being guarded, and
 * its absence disables migrations outright rather than silently weakening the
 * guard. `VERCEL_ENV` is excluded because the platform injects it.
 */
const MUST_BE_DOCUMENTED_IN_ENV_EXAMPLE = ["PRODUCTION_DB_HOST"];

type TurboConfig = {
  tasks?: Record<string, { env?: string[] }>;
  pipeline?: Record<string, { env?: string[] }>;
};

async function migrationEnvReads(): Promise<string[]> {
  const source = await Bun.file(MIGRATE_ENTRY).text();
  const reads = source.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  return [...new Set([...reads].map((match) => match[1] as string))];
}

async function turboBuildEnv(): Promise<string[]> {
  const config = (await Bun.file(TURBO_CONFIG).json()) as TurboConfig;
  const tasks = config.tasks ?? config.pipeline ?? {};
  return tasks.build?.env ?? [];
}

async function envExampleKeys(): Promise<string[]> {
  const source = await Bun.file(ENV_EXAMPLE).text();
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0] as string);
}

describe("guard config coverage", () => {
  test("turbo delivers every variable the migration entry point reads", async () => {
    const declared = new Set(await turboBuildEnv());
    const undelivered = (await migrationEnvReads()).filter(
      (name) => !declared.has(name),
    );

    // Failure means the guard reads something the real build never supplies —
    // it will fail open, or misread its own environment, in production.
    expect(undelivered).toEqual([]);
  });

  test.each(MUST_BE_DOCUMENTED_IN_ENV_EXAMPLE)(
    "%s is documented in .env.example",
    async (name) => {
      expect(await envExampleKeys()).toContain(name);
    },
  );

  // Two prior versions of this test were wrong in the same way, one step apart:
  //
  //   v1 asserted the key existed in `.env.example` and called the guard armed.
  //      The template ships it empty.
  //   v2 asserted the string "DISARMED" appeared somewhere in the reporter.
  //      The reporter was only invoked on 1 of `init.sh`'s 3 env routes, so the
  //      two routes that actually create `.env.local` reported nothing.
  //
  // Both checked for the presence of a thing rather than its delivery. This
  // version EXECUTES each route with stubs and asserts the report appears, which
  // is the only form that would have caught v2.
  test.each([
    ["offline skeleton", "OFFLINE=1; FORCE_ENV_PULL=0; rm -f $WEB_ENV_FILE"],
    ["reuse existing", "OFFLINE=0; FORCE_ENV_PULL=0"],
    ["fresh pull", "OFFLINE=0; FORCE_ENV_PULL=1"],
  ])(
    "init.sh reports the database target on the %s route",
    async (_name, setup) => {
      const initPath = new URL("init.sh", REPO_ROOT).pathname;
      const script = [
        "set -uo pipefail",
        "ROOT_DIR=$TMP; WEB_ENV_FILE=$TMP/e.env; WEB_ENV_EXAMPLE=$TMP/e.example",
        "ENVIRONMENT=development",
        'info(){ echo "INFO $*"; }; ok(){ :; }; warn(){ echo "WARN $*"; }',
        'die(){ echo "DIE $*"; return 1; }',
        "ensure_better_auth_secret(){ :; }; link_vercel_if_requested(){ :; }",
        // real call is: vercel env pull "$tmp_file" --environment=... => file is $3
        `vercel(){ printf 'POSTGRES_URL="postgresql://u:p@ep-probe-host.aws.neon.tech/db"\n' > "$3"; }`,
        `printf 'POSTGRES_URL="postgresql://u:p@ep-probe-host.aws.neon.tech/db"\n' > "$WEB_ENV_EXAMPLE"`,
        `eval "$(sed -n '/^report_database_target() {/,/^}/p' ${initPath})"`,
        `eval "$(sed -n '/^create_env_skeleton() {/,/^}/p' ${initPath})"`,
        `eval "$(sed -n '/^resolve_web_env() {/,/^}/p' ${initPath})"`,
        `eval "$(sed -n '/^pull_vercel_env() {/,/^}/p' ${initPath})"`,
        setup,
        "pull_vercel_env",
      ].join("\n");

      const tmp = `/tmp/guard-probe-${Math.random().toString(36).slice(2)}`;
      await Bun.$`mkdir -p ${tmp}`.quiet();
      try {
        const out = await Bun.$`TMP=${tmp} bash -c ${script}`.text();
        expect(out).toContain("database target:");
      } finally {
        await Bun.$`rm -rf ${tmp}`.quiet();
      }
    },
  );

  test("the guard's fail-open default is documented where it is defined", async () => {
    const source = await Bun.file(
      new URL("apps/web/lib/db/migration-target-guard.ts", REPO_ROOT),
    ).text();

    // Fail-open is a deliberate choice here — migrations gate every build, so
    // refusing when merely unconfigured would block all deploys. An
    // undocumented fail-open reads as a bug to the next person and invites a
    // "fix" that causes an outage.
    expect(source).toContain("FAILS OPEN");
  });
});
