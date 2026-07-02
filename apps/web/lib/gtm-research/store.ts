import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmAccounts,
  gtmAgentRuns,
  gtmContacts,
  gtmEvents,
  gtmSignals,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import { buildAccountBriefDraft } from "./brief";
import type {
  CreateGtmResearchRunInput,
  CreateGtmResearchRunResult,
} from "./types";
import { GtmResearchError } from "./types";

type GtmResearchDatabase = typeof db;
type GtmResearchQueryExecutor = Pick<typeof db, "select">;

async function assertOwnedTargets(
  tx: GtmResearchQueryExecutor,
  input: CreateGtmResearchRunInput,
) {
  if (input.accountId) {
    const [account] = await tx
      .select({ id: gtmAccounts.id })
      .from(gtmAccounts)
      .where(
        and(
          eq(gtmAccounts.id, input.accountId),
          eq(gtmAccounts.userId, input.userId),
        ),
      );
    if (!account) {
      throw new GtmResearchError(
        "cross_user_reference",
        "Research account does not belong to the requesting user.",
      );
    }
  }

  if (input.contactId) {
    const [contact] = await tx
      .select({ id: gtmContacts.id })
      .from(gtmContacts)
      .where(
        and(
          eq(gtmContacts.id, input.contactId),
          eq(gtmContacts.userId, input.userId),
        ),
      );
    if (!contact) {
      throw new GtmResearchError(
        "cross_user_reference",
        "Research contact does not belong to the requesting user.",
      );
    }
  }
}

export async function createGtmResearchRun(
  input: CreateGtmResearchRunInput,
  database: GtmResearchDatabase = db,
): Promise<CreateGtmResearchRunResult> {
  if (!input.userId.trim() || !input.requestId.trim()) {
    throw new GtmResearchError(
      "invalid_research_input",
      "Research run requires userId and requestId.",
    );
  }

  const brief = buildAccountBriefDraft(input);

  return database.transaction(async (tx) => {
    await assertOwnedTargets(tx, input);

    const now = new Date();
    const runId = crypto.randomUUID();
    const [run] = await tx
      .insert(gtmAgentRuns)
      .values({
        id: runId,
        userId: input.userId,
        runKind: "research",
        status: "completed",
        requestId: input.requestId,
        summary: `${brief.citedFacts.length} cited facts, ${brief.unknownClaims.length} unknown claims`,
        metadata: { brief },
        startedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!run) {
      throw new GtmResearchError(
        "persistence_failed",
        "Research run insert failed.",
      );
    }

    const [startedEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.agent_run.started",
          entityKind: "agent_run",
          entityId: runId,
          status: "started",
          gtmAgentRunId: runId,
          payload: { runKind: "research" },
        }),
      )
      .returning();

    if (!startedEvent) {
      throw new GtmResearchError(
        "persistence_failed",
        "Research run start event insert failed.",
      );
    }

    const signalIds: string[] = [];
    for (const candidate of brief.signalCandidates) {
      const signalId = crypto.randomUUID();
      const [signal] = await tx
        .insert(gtmSignals)
        .values({
          id: signalId,
          userId: input.userId,
          accountId: input.accountId ?? null,
          contactId: input.contactId ?? null,
          kind: candidate.kind,
          status: "draft",
          confidence: candidate.confidence,
          summary: candidate.summary,
          evidenceRefs: candidate.evidenceRefs,
          metadata: { researchRunId: runId },
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!signal) {
        throw new GtmResearchError(
          "persistence_failed",
          "Research signal insert failed.",
        );
      }
      signalIds.push(signal.id);

      const [signalEvent] = await tx
        .insert(gtmEvents)
        .values(
          buildGtmEventInsert({
            userId: input.userId,
            requestId: input.requestId,
            eventName: "gtm.signal.recorded",
            entityKind: "signal",
            entityId: signal.id,
            status: "info",
            gtmAgentRunId: runId,
            payload: {
              signalKind: candidate.kind,
              confidence: candidate.confidence,
              evidenceCount: candidate.evidenceRefs.length,
            },
          }),
        )
        .returning();

      if (!signalEvent) {
        throw new GtmResearchError(
          "persistence_failed",
          "Research signal event insert failed.",
        );
      }
    }

    const [completedEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.agent_run.completed",
          entityKind: "agent_run",
          entityId: runId,
          status: "succeeded",
          gtmAgentRunId: runId,
          payload: {
            citedFactCount: brief.citedFacts.length,
            unknownClaimCount: brief.unknownClaims.length,
            signalCount: signalIds.length,
          },
        }),
      )
      .returning();

    if (!completedEvent) {
      throw new GtmResearchError(
        "persistence_failed",
        "Research run completion event insert failed.",
      );
    }

    return { runId, brief, signalIds };
  });
}
