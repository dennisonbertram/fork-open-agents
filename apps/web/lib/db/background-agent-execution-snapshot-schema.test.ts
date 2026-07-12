import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  });
});
