/**
 * TDD RED tests for #762 — shared trigger-shape validation.
 *
 * The background-agent create/update paths (types.ts) and the new
 * loop-trigger routes must validate a single trigger's shape identically:
 * name/kind/status/conditions/schedule, with schedule.cron requiring a valid
 * schedule expression. Rather than duplicating this superRefine logic in a
 * second Zod schema for loop triggers, both paths import one shared element
 * schema from this new colocated module.
 */
import { describe, expect, test } from "bun:test";
import { triggerShapeSchema } from "./trigger-shape-schema";

describe("triggerShapeSchema — shared element schema (#762)", () => {
  test("accepts a valid github.pull_request trigger", () => {
    const result = triggerShapeSchema.safeParse({
      name: "PR opened",
      kind: "github.pull_request",
      conditions: { actions: ["opened"] },
    });
    expect(result.success).toBe(true);
  });

  test("defaults status to enabled and conditions to {}", () => {
    const result = triggerShapeSchema.safeParse({
      name: "PR opened",
      kind: "github.pull_request",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("enabled");
      expect(result.data.conditions).toEqual({});
    }
  });

  test("accepts a valid schedule.cron trigger", () => {
    const result = triggerShapeSchema.safeParse({
      name: "Nightly",
      kind: "schedule.cron",
      schedule: "0 2 * * *",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a schedule.cron trigger with a missing schedule", () => {
    const result = triggerShapeSchema.safeParse({
      name: "Nightly",
      kind: "schedule.cron",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("rejects a schedule.cron trigger with an invalid cron expression", () => {
    const result = triggerShapeSchema.safeParse({
      name: "Nightly",
      kind: "schedule.cron",
      schedule: "not-a-cron",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown trigger kind", () => {
    const result = triggerShapeSchema.safeParse({
      name: "Bad kind",
      kind: "github.made_up_kind",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown keys (.strict())", () => {
    const result = triggerShapeSchema.safeParse({
      name: "PR opened",
      kind: "github.pull_request",
      unexpectedField: true,
    });
    expect(result.success).toBe(false);
  });
});
