import "server-only";

import type {
  SandboxMeter,
  SandboxMeterCloseEvent,
  SandboxMeterOpenEvent,
} from "@open-agents/sandbox";
import { setSandboxMeter } from "@open-agents/sandbox";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sandboxUsageEvents } from "@/lib/db/schema";
import { estimateSandboxCost } from "@/lib/usage/compute-pricing";
import {
  decideOpenSpan,
  MAX_SANDBOX_LIFETIME_MS,
} from "@/lib/usage/span-lifecycle";

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

async function closeSpan(span: {
  id: string;
  startedAt: Date;
  memoryMb: number;
  endedAt: Date;
  reason: "hibernated" | "stopped" | "archived" | "expired" | "failed";
}): Promise<void> {
  const wallClockMs = Math.max(
    0,
    span.endedAt.getTime() - span.startedAt.getTime(),
  );
  const { memoryGbHours, estimatedCostUsd } = estimateSandboxCost({
    memoryMb: span.memoryMb,
    wallClockMs,
  });

  await db
    .update(sandboxUsageEvents)
    .set({
      endedAt: span.endedAt,
      wallClockMs,
      endReason: span.reason,
      memoryGbHours,
      estimatedCostUsd,
    })
    .where(eq(sandboxUsageEvents.id, span.id));
}

/**
 * Close spans that nothing will ever close.
 *
 * A sandbox reclaimed by the provider at its hard timeout, or one whose owning
 * process died, never runs `stop()`. Its span would otherwise stay open
 * forever: uncosted, and counted as a leak by anything reading open spans.
 * Ends each at the latest moment it could have been running.
 */
export async function sweepStaleSandboxSpans(): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - MAX_SANDBOX_LIFETIME_MS);
  const stale = await db
    .select({
      id: sandboxUsageEvents.id,
      startedAt: sandboxUsageEvents.startedAt,
      memoryMb: sandboxUsageEvents.memoryMb,
    })
    .from(sandboxUsageEvents)
    .where(
      and(
        isNull(sandboxUsageEvents.endedAt),
        lt(sandboxUsageEvents.startedAt, cutoff),
      ),
    )
    .limit(500);

  for (const span of stale) {
    await closeSpan({
      ...span,
      endedAt: new Date(span.startedAt.getTime() + MAX_SANDBOX_LIFETIME_MS),
      reason: "expired",
    });
  }

  return { closed: stale.length };
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
            .select({
              id: sandboxUsageEvents.id,
              startedAt: sandboxUsageEvents.startedAt,
              memoryMb: sandboxUsageEvents.memoryMb,
            })
            .from(sandboxUsageEvents)
            .where(
              and(
                eq(sandboxUsageEvents.sandboxName, event.sandboxName),
                isNull(sandboxUsageEvents.endedAt),
              ),
            )
            .limit(1);

          if (existingOpenSpan) {
            // One live VM is one span: a reconnect to a sandbox whose span is
            // already open reports another open, and it is ignored.
            if (
              decideOpenSpan(existingOpenSpan.startedAt, event.startedAt) ===
              "ignore"
            ) {
              return;
            }

            // Older than any sandbox can possibly live, so nothing closed it —
            // the provider reclaimed the VM at its hard timeout and no stop()
            // ever ran. Leaving it would suppress every future lifetime for
            // this sandbox, silently merging separate billed intervals into
            // one row that never ends. Close it at the timeout it could not
            // have outlived, then open the new span.
            await closeSpan({
              id: existingOpenSpan.id,
              startedAt: existingOpenSpan.startedAt,
              memoryMb: existingOpenSpan.memoryMb,
              endedAt: new Date(
                existingOpenSpan.startedAt.getTime() + MAX_SANDBOX_LIFETIME_MS,
              ),
              reason: "expired",
            });
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
