import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

describe("loop execution snapshot integration contract", () => {
  test("schema and migration keep a strict nullable V1 tuple", () => {
    const schema = readFileSync(join(root, "lib/db/schema.ts"), "utf8");
    const migration = readFileSync(
      join(root, "lib/db/migrations/0087_agent_loop_execution_snapshot.sql"),
      "utf8",
    );
    for (const source of [schema, migration]) {
      expect(source).toContain("execution_snapshot");
      expect(source).toContain("definition_version");
      expect(source).toContain("definition_hash");
      expect(source).toContain("agent_loop_runs_execution_snapshot_all_or_none");
      expect(source).toContain("snapshotVersion");
    }
  });

  test("public loop Run serializers never return the private snapshot body", () => {
    const apiTypes = readFileSync(
      join(root, "app/api/agent-loops/types.ts"),
      "utf8",
    );
    const route = readFileSync(
      join(root, "app/api/agent-loop-runs/[runId]/route.ts"),
      "utf8",
    );
    const detail = readFileSync(join(root, "lib/runs/detail-loaders.ts"), "utf8");
    expect(apiTypes).toContain("PublicAgentLoopRun");
    expect(route).toContain("toPublicAgentLoopRun");
    expect(detail).toContain("toPublicAgentLoopRun");
  });

  test("dispatcher parses the graph from the winning run, not the stale source object", () => {
    const dispatcher = readFileSync(
      join(root, "lib/agent-loops/dispatcher-bridge.ts"),
      "utf8",
    );
    expect(dispatcher).toContain(
      "loopDefinitionSchema.safeParse(result.run.definitionSnapshot)",
    );
  });
});
