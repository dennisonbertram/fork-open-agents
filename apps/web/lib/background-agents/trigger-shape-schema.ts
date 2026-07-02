/**
 * Shared trigger-shape validation (#762).
 *
 * The background-agent create/update paths (types.ts) and the new loop
 * trigger routes (lib/agent-loops/trigger-request-schemas.ts) both validate
 * a single trigger's shape identically: name/kind/status/conditions/schedule,
 * with schedule.cron requiring a valid schedule expression. This module is
 * the ONE place that shape is defined so the two paths cannot drift.
 */
import { z } from "zod";
import {
  backgroundAgentStatuses,
  backgroundAgentTriggerKinds,
  triggerConditionsSchema,
} from "./trigger-primitives";
import { validateSchedule } from "./schedule-presets";

export const triggerShapeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(backgroundAgentTriggerKinds),
    status: z.enum(backgroundAgentStatuses).default("enabled"),
    conditions: triggerConditionsSchema.default({}),
    schedule: z.string().trim().max(100).optional().nullable(),
  })
  .strict()
  .superRefine((trigger, ctx) => {
    if (trigger.kind === "schedule.cron") {
      const result = validateSchedule(trigger.schedule);
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule"],
          message:
            result.error ??
            "Invalid schedule expression. Supported formats: @hourly, @daily, @weekly, or a 5-field cron expression.",
        });
      }
    }
  });

export type TriggerShapeInput = z.infer<typeof triggerShapeSchema>;
