/**
 * Trigger-related primitives shared by types.ts and trigger-shape-schema.ts.
 *
 * Kept in their own module (no dependency on either file) so that types.ts
 * can depend on trigger-shape-schema.ts (for the shared trigger element
 * schema, #762) without creating a circular import — both files import these
 * primitives from here instead of from each other.
 */
import { z } from "zod";

export const backgroundAgentTriggerKinds = [
  "github.pull_request",
  "github.pull_request_review",
  "github.deployment_status",
  "github.issue",
  "github.check_suite",
  "schedule.cron",
  "webhook.error",
] as const;

export type BackgroundAgentTriggerKind =
  (typeof backgroundAgentTriggerKinds)[number];

export const backgroundAgentStatuses = ["enabled", "disabled"] as const;

export type BackgroundAgentStatus = (typeof backgroundAgentStatuses)[number];

export const triggerConditionsSchema = z
  .object({
    actions: z.array(z.string().min(1)).optional(),
    branches: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
    environments: z.array(z.string().min(1)).optional(),
    severities: z.array(z.string().min(1)).optional(),
    // mergedOnly restricts github.pull_request to merged-closed events.
    // Stored as JSONB, no migration needed. Not user-exposed yet (CODE-03).
    mergedOnly: z.boolean().optional(),
    // actors/ignoreActors (#749): allowlist/denylist matched case-insensitively
    // against event.actor (sender.login). Lets a reviewer agent ignore its own
    // bot login, or a fixer ignore the reviewer, to break ping-pong loops.
    actors: z.array(z.string().min(1)).max(20).optional(),
    ignoreActors: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();
