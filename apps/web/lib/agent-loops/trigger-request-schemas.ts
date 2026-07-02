/**
 * Loop trigger API — request validation schemas (#762)
 *
 * Reuses the shared trigger-shape schema (lib/background-agents) rather than
 * duplicating the schedule.cron validation. webhook.error is out of scope for
 * loop triggers in this ticket (webhook-kind triggers with public URLs are
 * explicitly out of scope — see issue #762).
 */
import { z } from "zod";
import { triggerShapeSchema } from "@/lib/background-agents/trigger-shape-schema";
import { validateSchedule } from "@/lib/background-agents/schedule-presets";

const loopTriggerKinds = [
  "github.pull_request",
  "github.pull_request_review",
  "github.deployment_status",
  "github.issue",
  "github.check_suite",
  "schedule.cron",
] as const;

export const createLoopTriggerBodySchema = triggerShapeSchema.refine(
  (trigger) => (loopTriggerKinds as readonly string[]).includes(trigger.kind),
  {
    message: "kind must be one of: " + loopTriggerKinds.join(", "),
    path: ["kind"],
  },
);

export const updateLoopTriggerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["enabled", "disabled"]).optional(),
    conditions: triggerShapeSchema.shape.conditions.optional(),
    schedule: z.string().trim().max(100).optional().nullable(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // The update body doesn't necessarily include `kind`, so we can't gate
    // this on kind === "schedule.cron" the way the create schema does. If a
    // caller supplies a non-empty schedule string on an update, it must be a
    // valid expression regardless of the trigger's stored kind — an invalid
    // string is never useful to persist.
    if (!body.schedule || body.schedule.trim() === "") {
      return;
    }
    const result = validateSchedule(body.schedule);
    if (!result.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedule"],
        message: result.error,
      });
    }
  });

export type CreateLoopTriggerBody = z.infer<typeof createLoopTriggerBodySchema>;
export type UpdateLoopTriggerBody = z.infer<typeof updateLoopTriggerBodySchema>;
