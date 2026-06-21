import { z } from "zod";

export const SHARED_WRITER_LEASE_TTL_MS = 10 * 60 * 1000;

export const sharedWriterLeaseEventSchema = z.object({
  type: z.enum([
    "shared_writer_lock_acquired",
    "shared_writer_lock_denied",
    "shared_writer_lock_released",
    "shared_writer_lock_expired",
  ]),
  sessionId: z.string(),
  workspaceId: z.string(),
  workerId: z.string(),
  workspaceMode: z.literal("shared"),
  reasonCode: z.string(),
  activeWorkerId: z.string().optional(),
  releasedByWorkerId: z.string().optional(),
  expiresAt: z.number().int().nonnegative().optional(),
});

export type SharedWriterLeaseEvent = z.infer<
  typeof sharedWriterLeaseEventSchema
>;

export const sharedWriterLeaseResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("acquired"),
    leaseId: z.string(),
    sessionId: z.string(),
    workspaceId: z.string(),
    workerId: z.string(),
    acquiredAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    events: z.array(sharedWriterLeaseEventSchema),
  }),
  z.object({
    status: z.literal("denied"),
    sessionId: z.string(),
    workspaceId: z.string(),
    workerId: z.string(),
    activeWorkerId: z.string(),
    reasonCode: z.literal("shared_writer_already_active"),
    reason: z.string(),
    events: z.array(sharedWriterLeaseEventSchema),
  }),
]);

export type SharedWriterLeaseResult = z.infer<
  typeof sharedWriterLeaseResultSchema
>;

export const sharedWriterLeaseReleaseSchema = z.object({
  status: z.enum(["released", "not_owner", "not_found"]),
  events: z.array(sharedWriterLeaseEventSchema),
});

export type SharedWriterLeaseRelease = z.infer<
  typeof sharedWriterLeaseReleaseSchema
>;

type SharedWriterLeaseRecord = {
  leaseId: string;
  sessionId: string;
  workspaceId: string;
  workerId: string;
  acquiredAt: number;
  expiresAt: number;
};

export type SharedWriterLeaseAcquireInput = {
  sessionId: string;
  workspaceId: string;
  workerId: string;
  now?: number;
  ttlMs?: number;
};

export type SharedWriterLeaseReleaseInput = {
  sessionId: string;
  workspaceId: string;
  workerId: string;
  reasonCode: string;
  now?: number;
};

export class SharedWriterLeaseManager {
  private readonly leases = new Map<string, SharedWriterLeaseRecord>();

  acquire(input: SharedWriterLeaseAcquireInput): SharedWriterLeaseResult {
    const now = input.now ?? Date.now();
    const ttlMs = input.ttlMs ?? SHARED_WRITER_LEASE_TTL_MS;
    const key = this.key(input.sessionId, input.workspaceId);
    const activeLease = this.leases.get(key);

    if (activeLease && activeLease.expiresAt <= now) {
      this.leases.delete(key);
      const expiredEvent: SharedWriterLeaseEvent = {
        type: "shared_writer_lock_expired",
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workerId: activeLease.workerId,
        workspaceMode: "shared",
        reasonCode: "lease_expired",
        expiresAt: activeLease.expiresAt,
      };

      return this.acquireWithEvents(input, now, ttlMs, [expiredEvent]);
    }

    if (activeLease) {
      const event: SharedWriterLeaseEvent = {
        type: "shared_writer_lock_denied",
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workerId: input.workerId,
        workspaceMode: "shared",
        reasonCode: "shared_writer_already_active",
        activeWorkerId: activeLease.workerId,
        expiresAt: activeLease.expiresAt,
      };

      return {
        status: "denied",
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workerId: input.workerId,
        activeWorkerId: activeLease.workerId,
        reasonCode: "shared_writer_already_active",
        reason:
          "Another shared writer is already active for this session workspace.",
        events: [event],
      };
    }

    return this.acquireWithEvents(input, now, ttlMs, []);
  }

  release(input: SharedWriterLeaseReleaseInput): SharedWriterLeaseRelease {
    const key = this.key(input.sessionId, input.workspaceId);
    const activeLease = this.leases.get(key);

    if (!activeLease) {
      return { status: "not_found", events: [] };
    }

    if (activeLease.workerId !== input.workerId) {
      return { status: "not_owner", events: [] };
    }

    this.leases.delete(key);
    return {
      status: "released",
      events: [
        {
          type: "shared_writer_lock_released",
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workerId: input.workerId,
          workspaceMode: "shared",
          reasonCode: input.reasonCode,
          releasedByWorkerId: input.workerId,
        },
      ],
    };
  }

  reset() {
    this.leases.clear();
  }

  private acquireWithEvents(
    input: SharedWriterLeaseAcquireInput,
    now: number,
    ttlMs: number,
    priorEvents: SharedWriterLeaseEvent[],
  ): SharedWriterLeaseResult {
    const leaseId = `${input.sessionId}:${input.workspaceId}:${input.workerId}:${now}`;
    const lease: SharedWriterLeaseRecord = {
      leaseId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      workerId: input.workerId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    this.leases.set(this.key(input.sessionId, input.workspaceId), lease);

    return {
      status: "acquired",
      leaseId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      workerId: input.workerId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt,
      events: [
        ...priorEvents,
        {
          type: "shared_writer_lock_acquired",
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workerId: input.workerId,
          workspaceMode: "shared",
          reasonCode: "shared_writer_available",
          expiresAt: lease.expiresAt,
        },
      ],
    };
  }

  private key(sessionId: string, workspaceId: string) {
    return `${sessionId}:${workspaceId}`;
  }
}

export const defaultSharedWriterLeaseManager = new SharedWriterLeaseManager();
