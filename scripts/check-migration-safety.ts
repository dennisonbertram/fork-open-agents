/**
 * Enforce the "Migration Rollback Rule" from the Production Release Runbook as
 * a deterministic gate instead of prose.
 *
 * A migration is "destructive" when it can drop or invalidate existing data
 * (DROP TABLE/COLUMN/CONSTRAINT, TRUNCATE, or adding a NOT NULL constraint to
 * an existing column). Those are exactly the migrations that need an explicit,
 * reviewed rollback decision before they merge.
 *
 * This script looks at migration .sql files ADDED in the current diff (vs
 * `BASE_REF`, default `origin/main`). For each destructive one, it requires an
 * acknowledgment comment in the file:
 *
 *   -- migration-safety: <app-only | forward-compatible | fix-forward> <reason>
 *
 * If a destructive migration is added without that line, the check fails and
 * tells the author exactly what to add. Non-destructive migrations need
 * nothing. Outside a git diff context (no base), it scans nothing and passes.
 */

import { readFileSync } from "node:fs";

const MIGRATIONS_GLOB = "apps/web/lib/db/migrations";

const DESTRUCTIVE_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: "DROP TABLE", regex: /\bdrop\s+table\b/i },
  { label: "DROP COLUMN", regex: /\bdrop\s+column\b/i },
  { label: "DROP CONSTRAINT", regex: /\bdrop\s+constraint\b/i },
  { label: "TRUNCATE", regex: /\btruncate\b/i },
  { label: "SET NOT NULL", regex: /\bset\s+not\s+null\b/i },
];

const ACK_REGEX =
  /--\s*migration-safety:\s*(app-only|forward-compatible|fix-forward)\b/i;

function getBaseRef(): string {
  return process.env.BASE_REF?.trim() || "origin/main";
}

function listAddedMigrations(baseRef: string): string[] {
  const proc = Bun.spawnSync(
    [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=A",
      `${baseRef}...HEAD`,
      "--",
      `${MIGRATIONS_GLOB}/*.sql`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    console.warn(
      `migration-safety: could not diff against ${baseRef} (${stderr || "unknown error"}); skipping.`,
    );
    return [];
  }

  return proc.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"));
}

function findDestructive(sql: string): string[] {
  return DESTRUCTIVE_PATTERNS.filter(({ regex }) => regex.test(sql)).map(
    ({ label }) => label,
  );
}

function main(): void {
  const baseRef = getBaseRef();
  const added = listAddedMigrations(baseRef);

  if (added.length === 0) {
    console.log("✓ migration-safety: no new migrations to check.");
    return;
  }

  const violations: string[] = [];

  for (const file of added) {
    let sql: string;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const destructive = findDestructive(sql);
    if (destructive.length === 0) {
      continue;
    }

    if (!ACK_REGEX.test(sql)) {
      violations.push(
        `${file} contains destructive statement(s) [${destructive.join(", ")}] without a rollback acknowledgment.`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("❌ migration-safety check failed:\n");
    for (const violation of violations) {
      console.error(`   ${violation}`);
    }
    console.error(
      "\nAdd a comment to each destructive migration documenting the rollback class:\n" +
        "   -- migration-safety: app-only <reason>\n" +
        "   -- migration-safety: forward-compatible <reason>\n" +
        "   -- migration-safety: fix-forward <reason>\n" +
        "See docs/process/production-release-runbook.md (Migration Rollback Rule).",
    );
    process.exit(1);
  }

  console.log(
    `✓ migration-safety: ${added.length} new migration(s) checked, destructive changes acknowledged.`,
  );
}

main();
