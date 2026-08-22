import "server-only";

import type {
  SandboxMeter,
  SandboxMeterCloseEvent,
  SandboxMeterOpenEvent,
} from "@open-agents/sandbox";
import { setSandboxMeter } from "@open-agents/sandbox";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sandboxUsageEvents } from "@/lib/db/schema";
import { estimateSandboxCost } from "@/lib/usage/compute-pricing";

function warn(phase: "open" | "close", error: unknown): void {
  console.warn(
    JSON.stringify({
      service: "usage",
      event: "sandbox-usage-meter-failed",
      level: "warn",
      phase,
      errorName: error instanceof Error ? error.name : typeof error,
    }),
  );
}

/**
 * The host application's handler for `packages/sandbox`'s metering hook.
 *
 * Owns the two properties the hook's doc comment requires of a handler:
 * idempotent opens (keyed on `sandboxName`, one live VM = one open span) and
 * full error containment (every method wraps its body in try/catch — a
 * metering failure must never propagate into the sandbox lifecycle).
 */
export function createSandboxMeter(): SandboxMeter {
  return {
    async onOpen(event: SandboxMeterOpenEvent) {
      try {
        const attribution = event.attribution;
        // No tenant identified by the creating call site — never invent an
        // owner. Drop the event silently; this is the expected shape for any
        // call site that didn't pass `meter`, not an error.
        if (!attribution?.userId) {
          return;
        }

        if (event.sandboxName) {
          const [existingOpenSpan] = await db
            .select({ id: sandboxUsageEvents.id })
            .from(sandboxUsageEvents)
            .where(
              and(
                eq(sandboxUsageEvents.sandboxName, event.sandboxName),
                isNull(sandboxUsageEvents.endedAt),
              ),
            )
            .limit(1);

          // One live VM is one span. A reconnect reports another open for a
          // sandbox whose span is already open — ignore it.
          if (existingOpenSpan) {
            return;
          }
        }

        await db.insert(sandboxUsageEvents).values({
          id: nanoid(),
          userId: attribution.userId,
          sessionId: attribution.sessionId ?? null,
          source: attribution.source ?? "web",
          sandboxName: event.sandboxName ?? null,
          sandboxId: event.sandboxId ?? null,
          vcpus: event.vcpus,
          memoryMb: event.memoryMb,
          region: event.region ?? null,
          startedAt: event.startedAt,
        });
      } catch (error) {
        warn("open", error);
      }
    },

    async onClose(event: SandboxMeterCloseEvent) {
      try {
        if (!event.sandboxName) {
          return;
        }

        const [openSpan] = await db
          .select()
          .from(sandboxUsageEvents)
          .where(
            and(
              eq(sandboxUsageEvents.sandboxName, event.sandboxName),
              isNull(sandboxUsageEvents.endedAt),
            ),
          )
          .orderBy(desc(sandboxUsageEvents.startedAt))
          .limit(1);

        if (!openSpan) {
          return;
        }

        const wallClockMs =
          event.endedAt.getTime() - openSpan.startedAt.getTime();
        const { memoryGbHours, estimatedCostUsd } = estimateSandboxCost({
          memoryMb: openSpan.memoryMb,
          wallClockMs,
        });

        await db
          .update(sandboxUsageEvents)
          .set({
            endedAt: event.endedAt,
            wallClockMs,
            endReason: event.reason,
            memoryGbHours,
            estimatedCostUsd,
          })
          .where(eq(sandboxUsageEvents.id, openSpan.id));
      } catch (error) {
        warn("close", error);
      }
    },
  };
}

/** Register the app's sandbox meter once, at server startup. */
export function registerSandboxMeter(): void {
  setSandboxMeter(createSandboxMeter());
}
