import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmApprovals,
  gtmEvents,
  gtmExperiments,
  gtmSignals,
} from "@/lib/db/schema";
import { redactGtmPayload, redactGtmText } from "@/lib/gtm/redaction";
import type { GtmEntityKind } from "@/lib/gtm/types";
import type {
  GtmBriefItem,
  GtmDiagnosisResponse,
  GtmSnapshotSource,
} from "./types";

export function gtmEventEntityKindForDiagnosisSource(
  source: GtmSnapshotSource,
): GtmEntityKind | null {
  switch (source) {
    case "account_work":
      return "signal";
    case "distribution":
      return "experiment";
    case "inbound":
      return "approval";
    case "audience":
    case "product_shipments":
      return null;
  }
}

function metadata(value: Record<string, unknown>) {
  const redacted = redactGtmPayload(value);
  return Object.fromEntries(
    Object.entries(redacted).filter(
      (entry): entry is [string, string | number | boolean | null] => {
        const item = entry[1];
        return (
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        );
      },
    ),
  );
}

function diagnosisHref(source: GtmSnapshotSource, id: string): string {
  const params = new URLSearchParams({ source, id });
  return `/api/gtm/diagnosis?${params.toString()}`;
}

export async function buildDbBackedGtmDiagnosis(params: {
  userId: string;
  source: GtmSnapshotSource;
  id: string;
  limit?: number;
}): Promise<GtmDiagnosisResponse | null> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  let item: GtmBriefItem | null = null;

  if (params.source === "account_work") {
    const [signal] = await db
      .select()
      .from(gtmSignals)
      .where(
        and(eq(gtmSignals.userId, params.userId), eq(gtmSignals.id, params.id)),
      );
    if (signal) {
      item = {
        id: signal.id,
        source: params.source,
        title: redactGtmText(signal.summary, 140) ?? "GTM signal",
        status: signal.status === "draft" ? "draft" : "active",
        needsAttention: signal.status === "draft",
        attentionReasons: signal.status === "draft" ? ["draft_signal"] : [],
        priority: signal.status === "draft" ? "medium" : "low",
        updatedAt: signal.updatedAt.toISOString(),
        summary: redactGtmText(signal.summary) ?? "Signal",
        metadata: metadata({
          kind: signal.kind,
          confidence: signal.confidence,
        }),
        diagnosisHref: diagnosisHref(params.source, signal.id),
      };
    }
  }

  if (params.source === "distribution") {
    const [experiment] = await db
      .select()
      .from(gtmExperiments)
      .where(
        and(
          eq(gtmExperiments.userId, params.userId),
          eq(gtmExperiments.id, params.id),
        ),
      );
    if (experiment) {
      item = {
        id: experiment.id,
        source: params.source,
        title: redactGtmText(experiment.title, 140) ?? "GTM experiment",
        status: experiment.status === "completed" ? "completed" : "active",
        needsAttention: false,
        attentionReasons: [],
        priority: "low",
        updatedAt: experiment.updatedAt.toISOString(),
        summary:
          redactGtmText(experiment.outcomeSummary ?? experiment.hypothesis) ??
          "Experiment",
        metadata: metadata({ channel: experiment.channel }),
        diagnosisHref: diagnosisHref(params.source, experiment.id),
      };
    }
  }

  if (params.source === "inbound") {
    const [approval] = await db
      .select()
      .from(gtmApprovals)
      .where(
        and(
          eq(gtmApprovals.userId, params.userId),
          eq(gtmApprovals.id, params.id),
        ),
      );
    if (approval) {
      item = {
        id: approval.id,
        source: params.source,
        title:
          redactGtmText(`${approval.actionKind} approval`, 140) ??
          "GTM approval",
        status:
          approval.status === "pending" ? "pending_approval" : "completed",
        needsAttention: approval.status === "pending",
        attentionReasons:
          approval.status === "pending" ? ["pending_approval"] : [],
        priority: approval.status === "pending" ? "high" : "low",
        updatedAt: approval.updatedAt.toISOString(),
        summary: `Review ${approval.targetKind} ${approval.targetId}`,
        metadata: metadata({ actionKind: approval.actionKind }),
        diagnosisHref: diagnosisHref(params.source, approval.id),
      };
    }
  }

  if (!item) {
    return null;
  }
  const entityKind = gtmEventEntityKindForDiagnosisSource(params.source);
  if (!entityKind) {
    return null;
  }

  const events = await db
    .select()
    .from(gtmEvents)
    .where(
      and(
        eq(gtmEvents.userId, params.userId),
        eq(gtmEvents.entityKind, entityKind),
        eq(gtmEvents.entityId, params.id),
      ),
    )
    .orderBy(desc(gtmEvents.createdAt))
    .limit(limit);

  return {
    generatedAt: new Date().toISOString(),
    source: params.source,
    id: params.id,
    item,
    sourceStatus: [{ source: params.source, status: "healthy", itemCount: 1 }],
    evidence: events.map((event) => ({
      id: event.id,
      title: event.eventName,
      status: event.status,
      summary: event.errorKind ?? undefined,
      occurredAt: event.createdAt.toISOString(),
      metadata: metadata({
        requestId: event.requestId,
        level: event.level,
        redactionStatus: event.redactionStatus,
      }),
    })),
  };
}
