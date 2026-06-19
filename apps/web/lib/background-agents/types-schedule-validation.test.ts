import { describe, expect, test } from "bun:test";
import {
  createBackgroundAgentSchema,
  updateBackgroundAgentSchema,
} from "./types";

function basePayload(triggerOverrides: Record<string, unknown> = {}) {
  return {
    name: "Smoke runner",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Run smoke checks.",
    outputMode: "none",
    triggers: [
      {
        name: "Daily cron",
        kind: "schedule.cron",
        schedule: "@hourly",
        ...triggerOverrides,
      },
    ],
  };
}

describe("createBackgroundAgentSchema — schedule.cron trigger validation", () => {
  test("accepts @hourly as a valid schedule", () => {
    const result = createBackgroundAgentSchema.safeParse(basePayload());
    expect(result.success).toBe(true);
  });

  test("accepts @daily as a valid schedule", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: "@daily" }),
    );
    expect(result.success).toBe(true);
  });

  test("accepts @weekly as a valid schedule", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: "@weekly" }),
    );
    expect(result.success).toBe(true);
  });

  test("accepts a valid 5-field cron expression", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: "0 9 * * 1" }),
    );
    expect(result.success).toBe(true);
  });

  test("rejects a plaintext invalid cron expression", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: "not-a-valid-cron" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("rejects a 6-field cron expression (seconds not supported)", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: "0 0 9 * * 1-5" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("rejects null schedule for schedule.cron kind", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: null }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("rejects missing schedule for schedule.cron kind", () => {
    const result = createBackgroundAgentSchema.safeParse(
      basePayload({ schedule: undefined }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("github.pull_request kind with no schedule is still valid", () => {
    const result = createBackgroundAgentSchema.safeParse({
      name: "PR reviewer",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      outputMode: "comment",
      triggers: [
        {
          name: "Pull request opened",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("github.deployment_status kind with schedule:null is still valid", () => {
    const result = createBackgroundAgentSchema.safeParse({
      name: "Deploy checker",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Check deployments.",
      outputMode: "none",
      triggers: [
        {
          name: "Deployment",
          kind: "github.deployment_status",
          schedule: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("updateBackgroundAgentSchema — schedule.cron trigger validation", () => {
  test("rejects an invalid cron expression in the triggers update", () => {
    const result = updateBackgroundAgentSchema.safeParse({
      triggers: [
        {
          name: "Daily cron",
          kind: "schedule.cron",
          schedule: "not-a-valid-cron",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("rejects a 6-field cron expression in the triggers update", () => {
    const result = updateBackgroundAgentSchema.safeParse({
      triggers: [
        {
          name: "Daily cron",
          kind: "schedule.cron",
          schedule: "0 0 9 * * 1-5",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("schedule"))).toBe(true);
    }
  });

  test("accepts a valid @daily schedule in the triggers update", () => {
    const result = updateBackgroundAgentSchema.safeParse({
      triggers: [
        {
          name: "Daily cron",
          kind: "schedule.cron",
          schedule: "@daily",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts a partial update with no triggers field", () => {
    const result = updateBackgroundAgentSchema.safeParse({ name: "New name" });
    expect(result.success).toBe(true);
  });
});
