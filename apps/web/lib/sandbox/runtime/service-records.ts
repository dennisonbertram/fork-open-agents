import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type NewSandboxService,
  type SandboxService,
  sandboxServices,
} from "@/lib/db/schema";

export async function listSandboxServices(
  sessionId: string,
): Promise<SandboxService[]> {
  return db.query.sandboxServices.findMany({
    where: eq(sandboxServices.sessionId, sessionId),
    orderBy: [desc(sandboxServices.updatedAt)],
  });
}

export async function getSandboxService(params: {
  sessionId: string;
  serviceId: string;
}): Promise<SandboxService | null> {
  const service = await db.query.sandboxServices.findFirst({
    where: and(
      eq(sandboxServices.sessionId, params.sessionId),
      eq(sandboxServices.id, params.serviceId),
    ),
  });

  return service ?? null;
}

export async function upsertSandboxService(
  service: NewSandboxService,
): Promise<SandboxService> {
  const [record] = await db
    .insert(sandboxServices)
    .values(service)
    .onConflictDoUpdate({
      target: [
        sandboxServices.sessionId,
        sandboxServices.kind,
        sandboxServices.port,
      ],
      set: {
        status: service.status,
        packageDir: service.packageDir,
        command: service.command,
        url: service.url,
        pid: service.pid,
        commandId: service.commandId,
        logPath: service.logPath,
        healthPath: service.healthPath,
        lastHealthStatus: service.lastHealthStatus,
        lastStartedAt: service.lastStartedAt,
        lastSeenAt: service.lastSeenAt,
        lastStoppedAt: service.lastStoppedAt,
        relaunchOnResume: service.relaunchOnResume,
        failureMessage: service.failureMessage,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!record) {
    throw new Error("Failed to upsert sandbox service");
  }

  return record;
}

export async function updateSandboxService(
  serviceId: string,
  patch: Partial<Omit<NewSandboxService, "id" | "sessionId" | "userId">>,
): Promise<SandboxService | null> {
  const [record] = await db
    .update(sandboxServices)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sandboxServices.id, serviceId))
    .returning();

  return record ?? null;
}
