import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtureRoots: string[] = [];
const isolatedGitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function run(command: string[], cwd: string): Bun.SyncSubprocess {
  return Bun.spawnSync(command, {
    cwd,
    env: isolatedGitEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
}

function output(process: Bun.SyncSubprocess): string {
  return `${process.stdout.toString()}${process.stderr.toString()}`;
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("init.sh Git hook installation", () => {
  test("installs repository-relative hooks from a linked Git worktree", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "open-agents-init-"));
    fixtureRoots.push(fixtureRoot);
    const repositoryRoot = join(fixtureRoot, "repository");
    const worktreeRoot = join(fixtureRoot, "worktree");

    await mkdir(join(repositoryRoot, "apps/web"), { recursive: true });
    await mkdir(join(repositoryRoot, ".githooks"), { recursive: true });
    await writeFile(
      join(repositoryRoot, "package.json"),
      '{"name":"fixture"}\n',
    );
    await writeFile(
      join(repositoryRoot, "apps/web/package.json"),
      '{"name":"web-fixture"}\n',
    );
    await writeFile(
      join(repositoryRoot, "apps/web/.env.example"),
      [
        "POSTGRES_URL=postgres://fixture:fixture@localhost:5432/fixture",
        "BETTER_AUTH_SECRET=fixture_secret_that_is_long_enough_for_tests",
        "",
      ].join("\n"),
    );
    await writeFile(join(repositoryRoot, ".githooks/pre-push"), "#!/bin/sh\n");
    await cp(
      resolve(import.meta.dir, "../../init.sh"),
      join(repositoryRoot, "init.sh"),
    );
    await chmod(join(repositoryRoot, "init.sh"), 0o755);

    expect(run(["git", "init", "-b", "develop"], repositoryRoot).exitCode).toBe(
      0,
    );
    expect(
      run(
        ["git", "config", "user.email", "fixture@example.com"],
        repositoryRoot,
      ).exitCode,
    ).toBe(0);
    expect(
      run(["git", "config", "user.name", "Fixture"], repositoryRoot).exitCode,
    ).toBe(0);
    expect(run(["git", "add", "."], repositoryRoot).exitCode).toBe(0);
    expect(
      run(["git", "commit", "-m", "fixture"], repositoryRoot).exitCode,
    ).toBe(0);
    const addWorktree = run(
      ["git", "worktree", "add", "-b", "fixture-worktree", worktreeRoot],
      repositoryRoot,
    );
    expect(output(addWorktree)).toContain("HEAD is now at");
    expect(addWorktree.exitCode).toBe(0);

    const init = run(
      ["./init.sh", "--offline", "--skip-install", "--skip-checks"],
      worktreeRoot,
    );
    expect(output(init)).toContain("local setup complete");
    expect(init.exitCode).toBe(0);

    const hooksPath = run(
      ["git", "config", "--get", "core.hooksPath"],
      worktreeRoot,
    );
    expect(hooksPath.exitCode).toBe(0);
    expect(hooksPath.stdout.toString().trim()).toBe(".githooks");
  });
});
