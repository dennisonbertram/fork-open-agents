import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmAgentRuns,
  gtmApprovals,
  gtmEvents,
  gtmSignals,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import { redactGtmPayload } from "@/lib/gtm/redaction";
import { classifyGtmActivationSignals } from "./classifier";
import type {
  GtmActivationQueueItem,
  RunGtmActivationWatcherInput,
  RunGtmActivationWatcherResult,
} from "./types";
import { GtmActivationError } from "./types";

type GtmActivationDatabase = typeof db;

export async function runGtmActivationWatcher(
  input: RunGtmActivationWatcherInput,
  database: GtmActivationDatabase = db,
): Promise<RunGtmActivationWatcherResult> {
  if (!input.userId.trim() || !input.requestId.trim()) {
    throw new GtmActivationError(
      "invalid_signal_input",
      "Activation watcher requires userId and requestId.",
    );
  }

  const candidates = classifyGtmActivationSignals(input.candidates);

  return database.transaction(async (tx) => {
    const now = new Date();
    const runId = crypto.randomUUID();
    const [run] = await tx
      .insert(gtmAgentRuns)
      .values({
        id: runId,
        userId: input.userId,
        runKind: "activation_watcher",
        status: "completed",
        requestId: input.requestId,
        summary: `${candidates.length} activation signal candidate(s)`,
        metadata: redactGtmPayload({
          scannedUserCount: input.candidates.length,
          signalCount: candidates.length,
        }),
        startedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!run) {
      throw new GtmActivationError(
        "persistence_failed",
        "Activation watcher run insert failed.",
      );
    }

    const [scanEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "activation.watcher.scanned",
          entityKind: "agent_run",
          entityId: run.id,
          status: "succeeded",
          gtmAgentRunId: run.id,
          payload: {
            scannedUserCount: input.candidates.length,
            signalCount: candidates.length,
          },
        }),
      )
      .returning();

    if (!scanEvent) {
      throw new GtmActivationError(
        "persistence_failed",
        "Activation watcher scan event insert failed.",
      );
    }

    const signalIds: string[] = [];
    const approvalIds: string[] = [];
    let dedupedCount = 0;

    for (const candidate of candidates) {
      const existing = await tx
        .select({ id: gtmSignals.id })
        .from(gtmSignals)
        .where(
          and(
            eq(gtmSignals.userId, input.userId),
            eq(gtmSignals.dedupSignature, candidate.dedupSignature),
          ),
        );

      if (existing.length > 0) {
        dedupedCount += 1;
        const [dedupeEvent] = await tx
          .insert(gtmEvents)
          .values(
            buildGtmEventInsert({
              userId: input.userId,
              requestId: input.requestId,
              eventName: "activation.signal.deduped",
              entityKind: "signal",
              entityId: String(existing[0]?.id),
              status: "info",
              gtmAgentRunId: run.id,
              payload: {
                dedupeKey: candidate.dedupSignature,
                signalType: candidate.signalType,
              },
            }),
          )
          .returning();

        if (!dedupeEvent) {
          throw new GtmActivationError(
            "persistence_failed",
            "Activation dedupe event insert failed.",
          );
        }
        continue;
      }

      const signalId = crypto.randomUUID();
      const [signal] = await tx
        .insert(gtmSignals)
        .values({
          id: signalId,
          userId: input.userId,
          kind:
            candidate.signalType === "product_request"
              ? "product_request"
              : "activation",
          status: "draft",
          confidence: candidate.severity === "high" ? "high" : "medium",
          summary: candidate.summary,
          evidenceRefs: candidate.evidenceRefs,
          dedupSignature: candidate.dedupSignature,
          metadata: redactGtmPayload({
            activationRunId: run.id,
            signalType: candidate.signalType,
            severity: candidate.severity,
            targetUserHash: candidate.targetUserHash,
            suggestedIntervention: candidate.suggestedIntervention,
            draftIssue: candidate.draftIssue,
          }),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!signal) {
        throw new GtmActivationError(
          "persistence_failed",
          "Activation signal insert failed.",
        );
      }
      signalIds.push(signal.id);

      const approvalId = crypto.randomUUID();
      const [approval] = await tx
        .insert(gtmApprovals)
        .values({
          id: approvalId,
          userId: input.userId,
          actionKind: "activation_issue_draft_file",
          targetKind: "signal",
          targetId: signal.id,
          status: "pending",
          requestId: input.requestId,
          requestedBy: "activation_watcher",
          policySnapshot: {
            requiresApproval: true,
            signalType: candidate.signalType,
            externalMutation: "github_issue_create",
          },
          redactedPreview: redactGtmPayload(candidate.draftIssue),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!approval) {
        throw new GtmActivationError(
          "persistence_failed",
          "Activation issue approval insert failed.",
        );
      }
      approvalIds.push(approval.id);

      const [signalEvent] = await tx
        .insert(gtmEvents)
        .values(
          buildGtmEventInsert({
            userId: input.userId,
            requestId: input.requestId,
            eventName: "activation.signal.created",
            entityKind: "signal",
            entityId: signal.id,
            status: "blocked",
            level: "warn",
            gtmAgentRunId: run.id,
            payload: {
              signalType: candidate.signalType,
              severity: candidate.severity,
              evidenceCount: candidate.evidenceRefs.length,
              approvalId: approval.id,
            },
          }),
        )
        .returning();

      if (!signalEvent) {
        throw new GtmActivationError(
          "persistence_failed",
          "Activation signal event insert failed.",
        );
      }
    }

    return { runId: run.id, signalIds, approvalIds, dedupedCount };
  });
}

export async function listGtmActivationSignals(
  userId: string,
  database: GtmActivationDatabase = db,
): Promise<GtmActivationQueueItem[]> {
  if (!userId.trim()) {
    throw new GtmActivationError(
      "invalid_signal_input",
      "Activation queue requires userId.",
    );
  }

  const rows = await database
    .select({
      signalId: gtmSignals.id,
      signalType: gtmSignals.kind,
      severity: gtmSignals.confidence,
      summary: gtmSignals.summary,
      evidenceRefs: gtmSignals.evidenceRefs,
      metadata: gtmSignals.metadata,
      updatedAt: gtmSignals.updatedAt,
    })
    .from(gtmSignals)
    .where(and(eq(gtmSignals.userId, userId), eq(gtmSignals.status, "draft")))
    .orderBy(desc(gtmSignals.updatedAt));

  return rows.map((row) => ({
    signalId: row.signalId,
    signalType: row.signalType,
    severity: row.severity,
    summary: row.summary,
    evidenceRefs: row.evidenceRefs,
    metadata: row.metadata,
    updatedAt: row.updatedAt,
  }));
}
