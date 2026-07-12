import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("background_agent_runs execution snapshot schema", () => {
  test("declares the nullable all-or-none snapshot tuple", () => {
    const schema = readFileSync(join(import.meta.dir, "schema.ts"), "utf8");

    expect(schema).toContain('jsonb("execution_snapshot")');
    expect(schema).toContain('integer("definition_version")');
    expect(schema).toContain('text("definition_hash")');
    expect(schema).toContain(
      '"background_agent_runs_execution_snapshot_all_or_none"',
    );
    expect(schema).toContain(
      "num_nonnulls(execution_snapshot, definition_version, definition_hash) in (0, 3)",
    );
    expect(schema).toContain("definition_version = 1");
    expect(schema).toContain("definition_hash ~ '^[0-9a-f]{64}$'");
    expect(schema).toContain("jsonb_typeof(execution_snapshot) = 'object'");
    expect(schema).toContain(
      "(execution_snapshot ->> 'snapshotVersion') is not null",
    );
    expect(schema).toContain(
      "execution_snapshot ->> 'snapshotVersion' = definition_version::text",
    );
  });

  test("migration is additive, replay-safe, and enforces V1/hash/body parity", () => {
    const migrations = join(import.meta.dir, "migrations");
    const file = readdirSync(migrations).find((entry) => {
      if (!entry.endsWith(".sql")) return false;
      return readFileSync(join(migrations, entry), "utf8").includes(
        "background_agent_runs_execution_snapshot_all_or_none",
      );
    });
    expect(file).toBeDefined();
    const sql = readFileSync(join(migrations, file ?? ""), "utf8");

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "execution_snapshot"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "definition_version"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "definition_hash"');
    expect(sql).toContain("definition_version = 1");
    expect(sql).toContain("definition_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("jsonb_typeof(execution_snapshot) = 'object'");
    expect(sql).toContain(
      "(execution_snapshot ->> 'snapshotVersion') IS NOT NULL",
    );
    expect(sql).toContain(
      "execution_snapshot ->> 'snapshotVersion' = definition_version::text",
    );
    expect(sql).not.toMatch(
      /DROP TABLE|DELETE FROM|UPDATE "background_agent_runs"/,
    );
  });
});
