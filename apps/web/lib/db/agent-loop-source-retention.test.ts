import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = join(import.meta.dir, "schema.ts");
const migrationsDir = join(import.meta.dir, "migrations");

function agentLoopRunsSchema(): string {
  const schema = readFileSync(schemaPath, "utf8");
  const start = schema.indexOf("export const agentLoopRuns = pgTable(");
  const end = schema.indexOf("// ── Agent Loop Step Runs", start);
  return schema.slice(start, end);
}

function retentionMigration(): string {
  const file = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .find((name) => {
      const sql = readFileSync(join(migrationsDir, name), "utf8");
      return /ADD CONSTRAINT "agent_loop_runs_loop_id_agent_loops_id_fk"[^;]+ON DELETE set null/i.test(
        sql,
      );
    });
  if (!file) throw new Error("Agent-loop source-retention migration not found");
  return readFileSync(join(migrationsDir, file), "utf8");
}

describe("agent loop source deletion retention", () => {
  test("agent_loop_runs.loop_id is nullable and uses ON DELETE SET NULL", () => {
    const runSchema = agentLoopRunsSchema();
    const loopIdColumn = runSchema.match(
      /loopId: text\("loop_id"\)([\s\S]*?)userId: text\("user_id"\)/,
    )?.[1];

    expect(loopIdColumn).toBeDefined();
    expect(loopIdColumn).not.toContain(".notNull()");
    expect(loopIdColumn).toContain('onDelete: "set null"');
  });

  test("migration changes only nullability/FK policy and does not rebuild or delete history", () => {
    const sql = retentionMigration();

    expect(sql).toMatch(/ALTER COLUMN "loop_id" DROP NOT NULL/i);
    expect(sql).toMatch(/ON DELETE set null/i);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
    expect(sql).toMatch(/-- migration-safety:\s*fix-forward/i);
  });
});
