/**
 * TDD RED tests for #762 — loop trigger request-body schemas.
 *
 * These reuse the shared triggerShapeSchema (lib/background-agents) rather
 * than duplicating the schedule.cron validation.
 */
import { describe, expect, test } from "bun:test";
import {
  createLoopTriggerBodySchema,
  updateLoopTriggerBodySchema,
} from "./trigger-request-schemas";

describe("createLoopTriggerBodySchema (#762)", () => {
  test("accepts a valid schedule.cron trigger body", () => {
    const result = createLoopTriggerBodySchema.safeParse({
      name: "Nightly run",
      kind: "schedule.cron",
      schedule: "0 2 * * *",
    });
    expect(result.success).toBe(true);
  });

  test("accepts a valid github event trigger body", () => {
    const result = createLoopTriggerBodySchema.safeParse({
      name: "On PR opened",
      kind: "github.pull_request",
      conditions: { actions: ["opened"] },
    });
    expect(result.success).toBe(true);
  });

  test("rejects a schedule.cron trigger with an invalid cron expression", () => {
    const result = createLoopTriggerBodySchema.safeParse({
      name: "Nightly",
      kind: "schedule.cron",
      schedule: "garbage",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unsupported kind (webhook.error is out of scope for #762)", () => {
    const result = createLoopTriggerBodySchema.safeParse({
      name: "Webhook",
      kind: "webhook.error",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing name", () => {
    const result = createLoopTriggerBodySchema.safeParse({
      kind: "github.issue",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateLoopTriggerBodySchema (#762)", () => {
  test("accepts a partial update with only status", () => {
    const result = updateLoopTriggerBodySchema.safeParse({
      status: "disabled",
    });
    expect(result.success).toBe(true);
  });

  test("accepts a partial update with only schedule", () => {
    const result = updateLoopTriggerBodySchema.safeParse({
      schedule: "0 9 * * 1-5",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid schedule on update", () => {
    const result = updateLoopTriggerBodySchema.safeParse({
      schedule: "not-a-cron",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown keys", () => {
    const result = updateLoopTriggerBodySchema.safeParse({
      unexpectedField: true,
    });
    expect(result.success).toBe(false);
  });
});
