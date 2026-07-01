import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmAccounts,
  gtmAgentRuns,
  gtmApprovals,
  gtmContacts,
  gtmEvents,
  gtmInsights,
  gtmTouchpoints,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import { redactGtmPayload, redactGtmText } from "@/lib/gtm/redaction";
import { buildGtmCallBrief, buildGtmCallDebrief } from "./extraction";
import type {
  CreateGtmCallDebriefInput,
  CreateGtmCallDebriefResult,
  CreateGtmCallPrepInput,
  CreateGtmCallPrepResult,
  GtmCallDebrief,
} from "./types";
import { GtmCallError } from "./types";

type GtmCallDatabase = typeof db;
type GtmCallQueryExecutor = Pick<typeof db, "select">;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function assertOwnedCallTargets(
  tx: GtmCallQueryExecutor,
  input: {
    userId: string;
    accountId?: string | null;
    contactId?: string | null;
  },
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
      throw new GtmCallError(
        "cross_user_reference",
        "Call account does not belong to the requesting user.",
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
      throw new GtmCallError(
        "cross_user_reference",
        "Call contact does not belong to the requesting user.",
      );
    }
  }
}

function insightRowsFromDebrief(debrief: GtmCallDebrief) {
  return [
    ...debrief.objections.map((summary) => ({
      kind: "objection" as const,
      title: "Call objection",
      summary,
    })),
    ...debrief.productAsks.map((summary) => ({
      kind: "product" as const,
      title: "Call product ask",
      summary,
    })),
  ].slice(0, 8);
}

export async function createGtmCallPrep(
  input: CreateGtmCallPrepInput,
  database: GtmCallDatabase = db,
): Promise<CreateGtmCallPrepResult> {
  if (!input.userId.trim() || !input.requestId.trim()) {
    throw new GtmCallError(
      "invalid_call_input",
      "Call prep requires userId and requestId.",
    );
  }

  if (!input.founderObjective.trim()) {
    throw new GtmCallError(
      "invalid_call_input",
      "Call prep requires a founder objective.",
    );
  }

  const brief = buildGtmCallBrief({
    founderObjective: input.founderObjective,
    knownContext: input.knownContext,
    openLoops: input.openLoops,
    desiredOutcome: input.desiredOutcome,
    sourceCount: input.evidenceRefs?.length ?? input.knownContext?.length ?? 0,
  });

  return database.transaction(async (tx) => {
    await assertOwnedCallTargets(tx, input);

    const now = new Date();
    const callId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const [run] = await tx
      .insert(gtmAgentRuns)
      .values({
        id: runId,
        userId: input.userId,
        runKind: "call_prep",
        status: "completed",
        requestId: input.requestId,
        summary: brief.objective,
        metadata: redactGtmPayload({ brief, callId }),
        startedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!run) {
      throw new GtmCallError(
        "persistence_failed",
        "Call prep run insert failed.",
      );
    }

    const [touchpoint] = await tx
      .insert(gtmTouchpoints)
      .values({
        id: callId,
        userId: input.userId,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        channel: "call",
        direction: "outbound",
        status: "draft",
        summary: `Call prep: ${brief.objective}`,
        bodyPreview: brief.conciseBrief,
        evidenceRefs: input.evidenceRefs ?? [],
        metadata: redactGtmPayload({ brief, runId }),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!touchpoint) {
      throw new GtmCallError(
        "persistence_failed",
        "Call prep touchpoint insert failed.",
      );
    }

    const [event] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.call_brief.created",
          entityKind: "touchpoint",
          entityId: touchpoint.id,
          status: "succeeded",
          gtmAgentRunId: run.id,
          payload: {
            callId: touchpoint.id,
            accountId: input.accountId ?? null,
            contactId: input.contactId ?? null,
            sourceCount: brief.sourceCount,
          },
        }),
      )
      .returning();

    if (!event) {
      throw new GtmCallError(
        "persistence_failed",
        "Call prep event insert failed.",
      );
    }

    return { callId: touchpoint.id, runId: run.id, brief };
  });
}

export async function createGtmCallDebrief(
  input: CreateGtmCallDebriefInput,
  database: GtmCallDatabase = db,
): Promise<CreateGtmCallDebriefResult> {
  if (!input.userId.trim() || !input.requestId.trim() || !input.notes.trim()) {
    throw new GtmCallError(
      "invalid_call_input",
      "Call debrief requires userId, requestId, and notes.",
    );
  }

  let debrief: GtmCallDebrief;
  try {
    debrief = buildGtmCallDebrief({
      notes: input.notes,
      attendees: input.attendees,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "transcript_too_large") {
      throw new GtmCallError(
        "transcript_too_large",
        "Call notes exceed the supported debrief size.",
      );
    }
    throw error;
  }

  return database.transaction(async (tx) => {
    await assertOwnedCallTargets(tx, input);

    const now = new Date();
    const runId = crypto.randomUUID();
    const callId = input.callId ?? crypto.randomUUID();
    const [run] = await tx
      .insert(gtmAgentRuns)
      .values({
        id: runId,
        userId: input.userId,
        runKind: "call_debrief",
        status: "blocked",
        requestId: input.requestId,
        summary: debrief.summary,
        metadata: redactGtmPayload({
          callId,
          notesHash: stableHash(input.notes),
          debrief,
        }),
        startedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!run) {
      throw new GtmCallError(
        "persistence_failed",
        "Call debrief run insert failed.",
      );
    }

    const [touchpoint] = await tx
      .insert(gtmTouchpoints)
      .values({
        id: callId,
        userId: input.userId,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        channel: "call",
        direction: "inbound",
        status: "pending_approval",
        summary: debrief.summary,
        bodyPreview: redactGtmText(input.notes, 320) ?? "",
        evidenceRefs: input.evidenceRefs ?? [],
        metadata: redactGtmPayload({
          runId,
          notesHash: stableHash(input.notes),
          debrief,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!touchpoint) {
      throw new GtmCallError(
        "persistence_failed",
        "Call debrief touchpoint insert failed.",
      );
    }

    const [notesEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.call_notes.ingested",
          entityKind: "touchpoint",
          entityId: touchpoint.id,
          status: "succeeded",
          gtmAgentRunId: run.id,
          payload: {
            callId: touchpoint.id,
            inputKind: "manual_notes",
            notesHash: stableHash(input.notes),
          },
        }),
      )
      .returning();

    if (!notesEvent) {
      throw new GtmCallError(
        "persistence_failed",
        "Call notes event insert failed.",
      );
    }

    const insightIds: string[] = [];
    for (const insightCandidate of insightRowsFromDebrief(debrief)) {
      const insightId = crypto.randomUUID();
      const [insight] = await tx
        .insert(gtmInsights)
        .values({
          id: insightId,
          userId: input.userId,
          kind: insightCandidate.kind,
          status: "draft",
          title: insightCandidate.title,
          summary: insightCandidate.summary,
          confidence: "medium",
          dedupSignature: stableHash(
            `${input.userId}:${insightCandidate.kind}:${insightCandidate.summary}`,
          ),
          sourceKind: "call",
          sourceId: touchpoint.id,
          evidenceRefs: input.evidenceRefs ?? [],
          createdBy: "gtm_call_debrief_agent",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!insight) {
        throw new GtmCallError(
          "persistence_failed",
          "Call insight insert failed.",
        );
      }
      insightIds.push(insight.id);
    }

    const approvalIds: string[] = [];
    for (const proposedAction of debrief.proposedActions) {
      const approvalId = crypto.randomUUID();
      const [approval] = await tx
        .insert(gtmApprovals)
        .values({
          id: approvalId,
          userId: input.userId,
          actionKind: `call_${proposedAction.actionKind}`,
          targetKind: proposedAction.targetKind,
          targetId: touchpoint.id,
          status: "pending",
          requestId: input.requestId,
          requestedBy: "gtm_call_debrief_agent",
          policySnapshot: {
            requiresApproval: true,
            callId: touchpoint.id,
            actionKind: proposedAction.actionKind,
            targetKind: proposedAction.targetKind,
          },
          redactedPreview: redactGtmPayload({
            summary: proposedAction.summary,
            callSummary: debrief.summary,
          }),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!approval) {
        throw new GtmCallError(
          "persistence_failed",
          "Call action approval insert failed.",
        );
      }
      approvalIds.push(approval.id);

      const [actionEvent] = await tx
        .insert(gtmEvents)
        .values(
          buildGtmEventInsert({
            userId: input.userId,
            requestId: input.requestId,
            eventName: "gtm.call_action.proposed",
            entityKind: "approval",
            entityId: approval.id,
            status: "blocked",
            level: "warn",
            gtmAgentRunId: run.id,
            payload: {
              callId: touchpoint.id,
              actionKind: proposedAction.actionKind,
              targetKind: proposedAction.targetKind,
            },
          }),
        )
        .returning();

      if (!actionEvent) {
        throw new GtmCallError(
          "persistence_failed",
          "Call action event insert failed.",
        );
      }
    }

    const [completedEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.call_debrief.extracted",
          entityKind: "touchpoint",
          entityId: touchpoint.id,
          status: "blocked",
          level: "warn",
          gtmAgentRunId: run.id,
          payload: {
            callId: touchpoint.id,
            nextStepCount: debrief.nextSteps.length,
            insightCount: insightIds.length,
            proposedActionCount: approvalIds.length,
          },
        }),
      )
      .returning();

    if (!completedEvent) {
      throw new GtmCallError(
        "persistence_failed",
        "Call debrief event insert failed.",
      );
    }

    return {
      callId: touchpoint.id,
      runId: run.id,
      debrief,
      insightIds,
      approvalIds,
    };
  });
}
