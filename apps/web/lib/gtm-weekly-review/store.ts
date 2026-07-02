import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type GtmExperiment,
  gtmAgentRuns,
  gtmApprovals,
  gtmEvents,
  gtmExperiments,
  gtmInsights,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import { redactGtmPayload, redactGtmText } from "@/lib/gtm/redaction";
import type { GtmEvidenceRef } from "@/lib/gtm/types";
import type {
  GtmLearningContextItem,
  GtmWeeklyExperimentSummary,
  GtmWeeklyLearningCandidate,
  GtmWeeklyMetricValue,
  GtmWeeklyNextBet,
  GtmWeeklyReviewApprovalInput,
  GtmWeeklySourceGap,
  RunGtmWeeklyReviewInput,
  RunGtmWeeklyReviewResult,
} from "./types";
import { GtmWeeklyReviewError } from "./types";

type GtmWeeklyReviewDatabase = typeof db;
type GtmWeeklyEventWriter = Pick<GtmWeeklyReviewDatabase, "insert">;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function parseReviewDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assertReviewInput(input: RunGtmWeeklyReviewInput): {
  weekStart: Date;
  weekEnd: Date;
} {
  const weekStart = parseReviewDate(input.weekStart);
  const weekEnd = parseReviewDate(input.weekEnd);
  if (
    !input.userId.trim() ||
    !input.requestId.trim() ||
    !weekStart ||
    !weekEnd ||
    weekStart >= weekEnd
  ) {
    throw new GtmWeeklyReviewError(
      "invalid_review_window",
      "Weekly review requires a valid user, request id, and date window.",
    );
  }

  return { weekStart, weekEnd };
}

function metricSummary(
  metrics: Record<string, unknown>,
): Array<{ key: string; value: GtmWeeklyMetricValue }> {
  return Object.entries(metrics)
    .filter((entry): entry is [string, GtmWeeklyMetricValue] => {
      const value = entry[1];
      return (
        value === null || ["string", "number", "boolean"].includes(typeof value)
      );
    })
    .map(([key, value]) => ({ key, value }));
}

function sourceGapsForExperiment(
  experiment: GtmExperiment,
  metrics: Array<{ key: string; value: GtmWeeklyMetricValue }>,
): GtmWeeklySourceGap[] {
  const gaps: GtmWeeklySourceGap[] = [];
  if (metrics.length === 0) {
    gaps.push({
      experimentId: experiment.id,
      sourceKind: "metrics",
      errorKind: "metric_source_unavailable",
      message: "No metric values were available for this experiment.",
    });
  }
  if (!experiment.outcomeSummary?.trim()) {
    gaps.push({
      experimentId: experiment.id,
      sourceKind: "qualitative",
      errorKind: "qualitative_source_unavailable",
      message: "No qualitative outcome summary was available.",
    });
  }
  if (experiment.evidenceRefs.length === 0) {
    gaps.push({
      experimentId: experiment.id,
      sourceKind: "evidence",
      errorKind: "source_gap",
      message: "No source evidence was attached to this experiment.",
    });
  }
  return gaps;
}

function isBlockedByRedaction(value: string): boolean {
  return value.includes("[redacted:");
}

function approvalMap(
  approvals: GtmWeeklyReviewApprovalInput[] | undefined,
): Map<string, GtmWeeklyReviewApprovalInput["decision"]> {
  return new Map(
    (approvals ?? []).map((approval) => [
      approval.candidateKey,
      approval.decision,
    ]),
  );
}

function buildExperimentSummary(
  experiment: GtmExperiment,
): GtmWeeklyExperimentSummary {
  const summary = redactGtmText(experiment.outcomeSummary, 320);
  return {
    experimentId: experiment.id,
    title: redactGtmText(experiment.title, 140) ?? "GTM experiment",
    hypothesis:
      redactGtmText(experiment.hypothesis, 240) ?? "Hypothesis unavailable",
    channel: redactGtmText(experiment.channel, 80) ?? "unknown",
    owner: redactGtmText(experiment.owner, 80) ?? null,
    metricSummary: metricSummary(experiment.metrics),
    qualitativeSignals: summary ? [summary] : [],
    evidenceRefs: experiment.evidenceRefs,
  };
}

function buildLearningCandidate(
  experiment: GtmExperiment,
): GtmWeeklyLearningCandidate {
  const title =
    redactGtmText(`Experiment learning: ${experiment.title}`, 180) ??
    "Experiment learning";
  const summary =
    redactGtmText(
      experiment.outcomeSummary ??
        `Expected signal: ${experiment.expectedSignal ?? "unknown"}`,
      500,
    ) ?? "No outcome summary available.";
  const blocked =
    isBlockedByRedaction(title) ||
    isBlockedByRedaction(summary) ||
    experiment.evidenceRefs.some(
      (ref) =>
        ref.excerpt && isBlockedByRedaction(redactGtmText(ref.excerpt) ?? ""),
    );

  return {
    candidateKey: experiment.id,
    experimentId: experiment.id,
    title,
    summary,
    confidence:
      experiment.evidenceRefs.length > 0 &&
      Object.keys(experiment.metrics).length > 0
        ? "medium"
        : "low",
    evidenceRefs: experiment.evidenceRefs,
    redactionStatus: blocked ? "blocked" : "redacted",
    approvalStatus: blocked ? "denied" : "pending",
    dedupSignature: stableHash(
      [
        experiment.title,
        experiment.hypothesis,
        experiment.channel,
        experiment.outcomeSummary ?? "",
      ]
        .join("|")
        .toLowerCase(),
    ),
  };
}

function buildNextBet(summary: GtmWeeklyExperimentSummary): GtmWeeklyNextBet {
  const metricText =
    summary.metricSummary.length > 0
      ? summary.metricSummary
          .map((metric) => `${metric.key}: ${String(metric.value)}`)
          .join(", ")
      : "no metrics";
  return {
    title: `Follow up on ${summary.title}`,
    rationale: `Recent ${summary.channel} experiment reported ${metricText}.`,
    confidence: summary.metricSummary.length > 0 ? "medium" : "low",
    evidenceRefs: summary.evidenceRefs,
  };
}

async function appendWeeklyEvent(
  tx: GtmWeeklyEventWriter,
  input: Parameters<typeof buildGtmEventInsert>[0],
) {
  const [event] = await tx
    .insert(gtmEvents)
    .values(buildGtmEventInsert(input))
    .returning();
  if (!event) {
    throw new GtmWeeklyReviewError(
      "learning_persistence_failed",
      "Weekly review event insert failed.",
    );
  }
}

export async function runGtmWeeklyReview(
  input: RunGtmWeeklyReviewInput,
  database: GtmWeeklyReviewDatabase = db,
): Promise<RunGtmWeeklyReviewResult> {
  const { weekStart, weekEnd } = assertReviewInput(input);
  const decisions = approvalMap(input.approvals);

  return database.transaction(async (tx) => {
    const now = new Date();
    const runId = crypto.randomUUID();
    const [run] = await tx
      .insert(gtmAgentRuns)
      .values({
        id: runId,
        userId: input.userId,
        runKind: "weekly_review",
        status: "running",
        requestId: input.requestId,
        summary: `Weekly GTM review ${input.weekStart} to ${input.weekEnd}`,
        metadata: redactGtmPayload({
          weekStart: input.weekStart,
          weekEnd: input.weekEnd,
        }),
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!run) {
      throw new GtmWeeklyReviewError(
        "learning_persistence_failed",
        "Weekly review run insert failed.",
      );
    }

    await appendWeeklyEvent(tx, {
      userId: input.userId,
      requestId: input.requestId,
      eventName: "weekly_review.started",
      entityKind: "agent_run",
      entityId: run.id,
      status: "started",
      gtmAgentRunId: run.id,
      payload: { weekStart: input.weekStart, weekEnd: input.weekEnd },
    });

    const experiments = await tx
      .select()
      .from(gtmExperiments)
      .where(
        and(
          eq(gtmExperiments.userId, input.userId),
          eq(gtmExperiments.status, "completed"),
          gte(gtmExperiments.endedAt, weekStart),
          lte(gtmExperiments.endedAt, weekEnd),
        ),
      )
      .orderBy(desc(gtmExperiments.endedAt));

    const experimentSummaries: GtmWeeklyExperimentSummary[] = [];
    const sourceGaps: GtmWeeklySourceGap[] = [];
    const nextBets: GtmWeeklyNextBet[] = [];
    const learningCandidates: GtmWeeklyLearningCandidate[] = [];
    const approvalIds: string[] = [];
    const persistedLearningIds: string[] = [];
    let dedupedCount = 0;

    for (const experiment of experiments) {
      const summary = buildExperimentSummary(experiment);
      experimentSummaries.push(summary);
      nextBets.push(buildNextBet(summary));
      const gaps = sourceGapsForExperiment(experiment, summary.metricSummary);
      sourceGaps.push(...gaps);

      await appendWeeklyEvent(tx, {
        userId: input.userId,
        requestId: input.requestId,
        eventName: "weekly_review.experiment_summarized",
        entityKind: "experiment",
        entityId: experiment.id,
        status: "succeeded",
        gtmAgentRunId: run.id,
        payload: {
          metricCount: summary.metricSummary.length,
          signalCount: summary.qualitativeSignals.length,
        },
      });

      for (const gap of gaps) {
        await appendWeeklyEvent(tx, {
          userId: input.userId,
          requestId: input.requestId,
          eventName: "weekly_review.source_gap_detected",
          entityKind: "experiment",
          entityId: experiment.id,
          status: "info",
          level: "warn",
          gtmAgentRunId: run.id,
          errorKind: gap.errorKind,
          payload: {
            sourceKind: gap.sourceKind,
            message: gap.message,
          },
        });
      }

      const candidate = buildLearningCandidate(experiment);
      learningCandidates.push(candidate);

      await appendWeeklyEvent(tx, {
        userId: input.userId,
        requestId: input.requestId,
        eventName: "weekly_review.learning_candidate_extracted",
        entityKind: "experiment",
        entityId: experiment.id,
        status: "info",
        gtmAgentRunId: run.id,
        payload: {
          candidateKey: candidate.candidateKey,
          confidence: candidate.confidence,
          evidenceCount: candidate.evidenceRefs.length,
        },
      });

      if (candidate.redactionStatus === "blocked") {
        sourceGaps.push({
          experimentId: experiment.id,
          sourceKind: "redaction",
          errorKind: "redaction_failed",
          message: "Learning candidate contained secret-looking evidence.",
        });
        await appendWeeklyEvent(tx, {
          userId: input.userId,
          requestId: input.requestId,
          eventName: "weekly_review.learning_redaction_blocked",
          entityKind: "experiment",
          entityId: experiment.id,
          status: "blocked",
          level: "warn",
          gtmAgentRunId: run.id,
          errorKind: "redaction_failed",
          payload: {
            candidateKey: candidate.candidateKey,
            redactionStatus: candidate.redactionStatus,
          },
        });
        continue;
      }

      const decision = decisions.get(candidate.candidateKey);
      if (!decision) {
        const approvalId = crypto.randomUUID();
        const [approval] = await tx
          .insert(gtmApprovals)
          .values({
            id: approvalId,
            userId: input.userId,
            actionKind: "gtm_learning_persist",
            targetKind: "experiment",
            targetId: experiment.id,
            status: "pending",
            requestId: input.requestId,
            requestedBy: "gtm_weekly_review_agent",
            policySnapshot: {
              requiresApproval: true,
              externalMutation: false,
              reviewRunId: run.id,
            },
            redactedPreview: redactGtmPayload(candidate),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!approval) {
          throw new GtmWeeklyReviewError(
            "approval_required",
            "Weekly review approval insert failed.",
          );
        }
        approvalIds.push(approval.id);
        candidate.approvalId = approval.id;

        await appendWeeklyEvent(tx, {
          userId: input.userId,
          requestId: input.requestId,
          eventName: "weekly_review.learning_approval_requested",
          entityKind: "approval",
          entityId: approval.id,
          status: "blocked",
          level: "warn",
          gtmAgentRunId: run.id,
          errorKind: "approval_required",
          payload: {
            candidateKey: candidate.candidateKey,
            experimentId: experiment.id,
          },
        });
        continue;
      }

      if (decision === "denied") {
        candidate.approvalStatus = "denied";
        continue;
      }

      const existing = await tx
        .select({ id: gtmInsights.id })
        .from(gtmInsights)
        .where(
          and(
            eq(gtmInsights.userId, input.userId),
            eq(gtmInsights.dedupSignature, candidate.dedupSignature),
          ),
        );

      if (existing.length > 0 || decision === "merge") {
        const existingLearningId = String(existing[0]?.id ?? "");
        if (!existingLearningId) {
          throw new GtmWeeklyReviewError(
            "dedup_failed",
            "Merge was requested without an existing learning.",
          );
        }
        const [updated] = await tx
          .update(gtmInsights)
          .set({
            summary: candidate.summary,
            confidence: candidate.confidence,
            status: "active",
            updatedAt: now,
          })
          .where(eq(gtmInsights.id, existingLearningId))
          .returning();
        if (!updated) {
          throw new GtmWeeklyReviewError(
            "learning_persistence_failed",
            "Weekly review learning merge failed.",
          );
        }
        dedupedCount += 1;
        candidate.approvalStatus = "merged";
        candidate.existingLearningId = existingLearningId;

        await appendWeeklyEvent(tx, {
          userId: input.userId,
          requestId: input.requestId,
          eventName: "weekly_review.learning_deduped",
          entityKind: "insight",
          entityId: existingLearningId,
          status: "info",
          gtmAgentRunId: run.id,
          payload: {
            candidateKey: candidate.candidateKey,
            dedupSignature: candidate.dedupSignature,
          },
        });
        continue;
      }

      const insightId = crypto.randomUUID();
      const [insight] = await tx
        .insert(gtmInsights)
        .values({
          id: insightId,
          userId: input.userId,
          kind: "experiment",
          status: "active",
          title: candidate.title,
          summary: candidate.summary,
          confidence: candidate.confidence,
          dedupSignature: candidate.dedupSignature,
          sourceKind: "weekly_review",
          sourceId: run.id,
          evidenceRefs: candidate.evidenceRefs,
          createdBy: "gtm_weekly_review_agent",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!insight) {
        throw new GtmWeeklyReviewError(
          "learning_persistence_failed",
          "Weekly review learning insert failed.",
        );
      }

      candidate.approvalStatus = "approved";
      candidate.learningId = insight.id;
      persistedLearningIds.push(insight.id);

      await appendWeeklyEvent(tx, {
        userId: input.userId,
        requestId: input.requestId,
        eventName: "weekly_review.learning_persisted",
        entityKind: "insight",
        entityId: insight.id,
        status: "succeeded",
        gtmAgentRunId: run.id,
        payload: {
          candidateKey: candidate.candidateKey,
          dedupSignature: candidate.dedupSignature,
        },
      });
    }

    const status =
      sourceGaps.length > 0
        ? "partial"
        : approvalIds.length > 0
          ? "blocked"
          : "completed";

    await appendWeeklyEvent(tx, {
      userId: input.userId,
      requestId: input.requestId,
      eventName: "weekly_review.completed",
      entityKind: "agent_run",
      entityId: run.id,
      status: status === "blocked" ? "blocked" : "succeeded",
      gtmAgentRunId: run.id,
      payload: {
        summarizedCount: experimentSummaries.length,
        sourceGapCount: sourceGaps.length,
        persistedLearningCount: persistedLearningIds.length,
        dedupedCount,
      },
    });

    await tx
      .update(gtmAgentRuns)
      .set({
        status,
        summary: `${experimentSummaries.length} experiment(s), ${persistedLearningIds.length} learning(s) persisted`,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(gtmAgentRuns.id, run.id))
      .returning();

    return {
      reviewRunId: run.id,
      status,
      experimentSummaries,
      sourceGaps,
      nextBets,
      learningCandidates,
      approvalIds,
      persistedLearningIds,
      dedupedCount,
    };
  });
}

export async function listActiveGtmLearningsForContext(
  userId: string,
  database: GtmWeeklyReviewDatabase = db,
): Promise<GtmLearningContextItem[]> {
  if (!userId.trim()) {
    throw new GtmWeeklyReviewError(
      "experiment_source_missing",
      "GTM learning context requires a user id.",
    );
  }

  const rows = await database
    .select({
      id: gtmInsights.id,
      title: gtmInsights.title,
      summary: gtmInsights.summary,
      confidence: gtmInsights.confidence,
      sourceId: gtmInsights.sourceId,
      evidenceRefs: gtmInsights.evidenceRefs,
      updatedAt: gtmInsights.updatedAt,
    })
    .from(gtmInsights)
    .where(
      and(
        eq(gtmInsights.userId, userId),
        eq(gtmInsights.status, "active"),
        eq(gtmInsights.createdBy, "gtm_weekly_review_agent"),
      ),
    )
    .orderBy(desc(gtmInsights.updatedAt));

  return rows.map((row) => ({
    learningId: row.id,
    title: row.title,
    summary: row.summary,
    confidence: row.confidence,
    sourceId: row.sourceId,
    evidenceRefs: row.evidenceRefs as GtmEvidenceRef[],
    updatedAt: row.updatedAt,
  }));
}
