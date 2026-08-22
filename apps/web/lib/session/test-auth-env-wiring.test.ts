import { describe, expect, test } from "bun:test";

/**
 * `isTestAuthEnabled()` is a security boundary. Its inputs only work as a
 * set: `VERCEL_ENV` and `NODE_ENV` are the production refusals,
 * `TEST_AUTH_SECRET` is the required shared secret without which test-auth
 * stays disabled entirely, and `OPEN_AGENTS_ENABLE_TEST_AUTH` is the opt-in
 * on Preview/Dev.
 *
 * Request-time session resolution reads these from the platform env, not from
 * Turbo. They are still declared on the build task so a future build-path
 * caller cannot silently drop them the way `PRODUCTION_DB_HOST` once did.
 *
 * `.env.example` documents the keys. An empty template value does **not** arm
 * anything — this test only pins the comments so operators see the
 * Production refusal and the secret requirement before they copy the file.
 */

const TURBO_CONFIG_PATH = new URL("../../../../turbo.json", import.meta.url);
const ENV_EXAMPLE_PATH = new URL("../../.env.example", import.meta.url);
const TEST_AUTH_PATH = new URL("test-auth.ts", import.meta.url);

type TurboConfig = {
  tasks?: Record<string, { env?: string[] }>;
  pipeline?: Record<string, { env?: string[] }>;
};

async function buildTaskEnv(): Promise<string[]> {
  const config = (await Bun.file(TURBO_CONFIG_PATH).json()) as TurboConfig;
  const tasks = config.tasks ?? config.pipeline ?? {};
  return tasks.build?.env ?? [];
}

/** Runtime-provided names that Turbo does not have to allowlist. */
const RUNTIME_ALWAYS = new Set(["NODE_ENV"]);

async function testAuthEnvReads(): Promise<string[]> {
  const source = await Bun.file(TEST_AUTH_PATH).text();
  const reads = source.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  return [
    ...new Set(
      [...reads]
        .map((match) => match[1] as string)
        .filter((name) => !RUNTIME_ALWAYS.has(name)),
    ),
  ];
}

describe("test-auth env wiring", () => {
  test("turbo build passes every variable isTestAuthEnabled reads", async () => {
    const declared = new Set(await buildTaskEnv());
    const missing = (await testAuthEnvReads()).filter(
      (name) => !declared.has(name),
    );

    expect(missing).toEqual([]);
  });

  test.each([
    [
      "VERCEL_ENV",
      "production would look local and the hard-refuse would never fire",
    ],
    [
      "OPEN_AGENTS_ENABLE_TEST_AUTH",
      "Preview/Dev could not opt in after a Turbo-stripped build",
    ],
    [
      "TEST_AUTH_SECRET",
      "the shared-secret requirement could never be satisfied after a Turbo-stripped build",
    ],
  ])("turbo build declares %s — without it, %s", async (name) => {
    expect(await buildTaskEnv()).toContain(name);
  });

  test("the production refusal is pinned in source, not only in helper tests", async () => {
    const source = await Bun.file(TEST_AUTH_PATH).text();
    expect(source).toContain('process.env.VERCEL_ENV === "production"');
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toMatch(/return false;/);
  });

  test("the shared-secret requirement is pinned in source, not only in helper tests", async () => {
    const source = await Bun.file(TEST_AUTH_PATH).text();
    expect(source).toContain("process.env.TEST_AUTH_SECRET");
  });

  test(".env.example documents the flag and the Production refusal (docs, not arming)", async () => {
    const example = await Bun.file(ENV_EXAMPLE_PATH).text();
    expect(example).toContain("OPEN_AGENTS_ENABLE_TEST_AUTH");
    expect(example).toMatch(/[Nn]ever.*[Pp]roduction|Production.*refus/);
  });

  test(".env.example documents TEST_AUTH_SECRET as local-only (docs, not arming)", async () => {
    const example = await Bun.file(ENV_EXAMPLE_PATH).text();
    expect(example).toContain("TEST_AUTH_SECRET");
    expect(example).toMatch(/[Ll]ocal only/);
  });
});
