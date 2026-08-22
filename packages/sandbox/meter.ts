/**
 * Sandbox compute metering hook.
 *
 * Vercel bills provisioned memory on wall-clock life, so the only way to know
 * what a sandbox cost is to observe both ends of its life. That observation has
 * to happen here rather than at the call sites: `connectSandbox` is called from
 * roughly fifty places in the app, and the overwhelming majority of those are
 * RECONNECTS to a sandbox that is already running and already being billed.
 * Metering per call site would count the same VM many times over.
 *
 * This package must not know about databases, so it does not record anything
 * itself — it reports open and close events to a handler the host application
 * registers once at startup. Keeping the package dependency-free is the reason
 * this is a registry rather than a direct import.
 *
 * Two properties the handler must provide, because this module deliberately
 * does not:
 *
 *   - Idempotent opens. A reconnect reports an open for a VM whose span is
 *     already open. The handler is expected to key on `sandboxName` and ignore
 *     an open when an unclosed span already exists, so one live VM is one span.
 *   - Its own error containment. Reporting is fire-and-forget here; a metering
 *     failure must never fail or delay a sandbox operation a user is waiting on.
 */

/**
 * Tenant attribution for a billing span, supplied by the creating call site.
 * This package cannot derive it: it has no database and a sandbox name is not
 * a user.
 */
export type SandboxMeterAttribution = {
  userId: string;
  /** Null for runs with no chat session behind them (background agents). */
  sessionId?: string;
  source?: "web" | "background-agent" | "agent-loop";
};

export type SandboxMeterOpenEvent = {
  /**
   * Absent when the creating call site did not identify a tenant. The handler
   * drops such an event rather than inventing an owner for it.
   */
  attribution?: SandboxMeterAttribution;
  /** Durable resume key — the join back to Vercel's own usage records. */
  sandboxName?: string;
  sandboxId?: string;
  vcpus: number;
  /** The Vercel SDK allocates 2048 MB per vCPU. */
  memoryMb: number;
  region?: string;
  startedAt: Date;
};

export type SandboxMeterCloseReason =
  | "hibernated"
  | "stopped"
  | "archived"
  | "expired"
  | "failed";

export type SandboxMeterCloseEvent = {
  sandboxName?: string;
  sandboxId?: string;
  endedAt: Date;
  reason: SandboxMeterCloseReason;
};

export type SandboxMeter = {
  onOpen(event: SandboxMeterOpenEvent): void | Promise<void>;
  onClose(event: SandboxMeterCloseEvent): void | Promise<void>;
};

/** Memory the Vercel SDK provisions per vCPU. */
export const MEMORY_MB_PER_VCPU = 2048;

let registeredMeter: SandboxMeter | null = null;

/** Register the host application's meter. Pass null to disable metering. */
export function setSandboxMeter(meter: SandboxMeter | null): void {
  registeredMeter = meter;
}

export function getSandboxMeter(): SandboxMeter | null {
  return registeredMeter;
}

function swallow(error: unknown, phase: "open" | "close"): void {
  console.warn(
    JSON.stringify({
      service: "sandbox",
      event: "sandbox-meter-failed",
      level: "warn",
      phase,
      errorName: error instanceof Error ? error.name : typeof error,
    }),
  );
}

/**
 * Per-sandbox write queue.
 *
 * Both report functions are fire-and-forget, so without this a sandbox created
 * and stopped in quick succession runs `onOpen` and `onClose` concurrently. The
 * close query then reads before the open insert lands, finds no open span and
 * does nothing — and the open it raced inserts a span that stays open forever.
 * Chaining per sandbox name keeps callers non-blocking while guaranteeing a
 * close observes its own open.
 */
const writeQueues = new Map<string, Promise<void>>();

function enqueue(key: string, work: () => Promise<void>): void {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeQueues.set(key, next);
  void next.finally(() => {
    // Drop the entry once this is the last queued write, so a long-lived
    // process does not retain one promise per sandbox it has ever seen.
    if (writeQueues.get(key) === next) {
      writeQueues.delete(key);
    }
  });
}

export function reportSandboxOpen(event: SandboxMeterOpenEvent): void {
  const meter = registeredMeter;
  if (!meter) {
    return;
  }
  enqueue(event.sandboxName ?? event.sandboxId ?? "unknown", async () => {
    try {
      await meter.onOpen(event);
    } catch (error) {
      swallow(error, "open");
    }
  });
}

export function reportSandboxClose(event: SandboxMeterCloseEvent): void {
  const meter = registeredMeter;
  if (!meter) {
    return;
  }
  enqueue(event.sandboxName ?? event.sandboxId ?? "unknown", async () => {
    try {
      await meter.onClose(event);
    } catch (error) {
      swallow(error, "close");
    }
  });
}

/** Test seam: resolves once every queued meter write has settled. */
export async function flushSandboxMeter(): Promise<void> {
  await Promise.all(writeQueues.values());
}
