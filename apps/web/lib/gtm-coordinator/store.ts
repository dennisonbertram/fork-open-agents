import "server-only";

import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmAccounts,
  gtmApprovals,
  gtmExperiments,
  gtmSignals,
} from "@/lib/db/schema";
import {
  buildGtmSnapshot,
  parseGtmSnapshotWindow,
  type GtmSnapshotOptions,
} from "./snapshot";

const DEFAULT_SOURCE_LIMIT = 50;

export async function buildDbBackedGtmSnapshot(
  options: Omit<GtmSnapshotOptions, "loaders">,
) {
  const now = options.now ?? new Date();
  const window = parseGtmSnapshotWindow(options.window, now);

  return buildGtmSnapshot({
    ...options,
    now,
    loaders: {
      accounts: async () =>
        db
          .select({
            id: gtmAccounts.id,
            name: gtmAccounts.name,
            status: gtmAccounts.status,
            domain: gtmAccounts.domain,
            sourceKind: gtmAccounts.sourceKind,
            updatedAt: gtmAccounts.updatedAt,
            metadata: gtmAccounts.metadata,
          })
          .from(gtmAccounts)
          .where(
            and(
              eq(gtmAccounts.userId, options.userId),
              gte(gtmAccounts.updatedAt, window.since),
            ),
          )
          .orderBy(desc(gtmAccounts.updatedAt))
          .limit(DEFAULT_SOURCE_LIMIT),
      signals: async () =>
        db
          .select({
            id: gtmSignals.id,
            kind: gtmSignals.kind,
            status: gtmSignals.status,
            confidence: gtmSignals.confidence,
            summary: gtmSignals.summary,
            accountId: gtmSignals.accountId,
            contactId: gtmSignals.contactId,
            updatedAt: gtmSignals.updatedAt,
            metadata: gtmSignals.metadata,
          })
          .from(gtmSignals)
          .where(
            and(
              eq(gtmSignals.userId, options.userId),
              or(
                gte(gtmSignals.updatedAt, window.since),
                eq(gtmSignals.status, "draft"),
              ),
            ),
          )
          .orderBy(desc(gtmSignals.updatedAt))
          .limit(DEFAULT_SOURCE_LIMIT),
      experiments: async () =>
        db
          .select({
            id: gtmExperiments.id,
            title: gtmExperiments.title,
            status: gtmExperiments.status,
            channel: gtmExperiments.channel,
            outcomeSummary: gtmExperiments.outcomeSummary,
            updatedAt: gtmExperiments.updatedAt,
          })
          .from(gtmExperiments)
          .where(
            and(
              eq(gtmExperiments.userId, options.userId),
              or(
                gte(gtmExperiments.updatedAt, window.since),
                inArray(gtmExperiments.status, ["planned", "running"]),
              ),
            ),
          )
          .orderBy(desc(gtmExperiments.updatedAt))
          .limit(DEFAULT_SOURCE_LIMIT),
      approvals: async () =>
        db
          .select({
            id: gtmApprovals.id,
            actionKind: gtmApprovals.actionKind,
            targetKind: gtmApprovals.targetKind,
            targetId: gtmApprovals.targetId,
            status: gtmApprovals.status,
            updatedAt: gtmApprovals.updatedAt,
          })
          .from(gtmApprovals)
          .where(
            and(
              eq(gtmApprovals.userId, options.userId),
              or(
                gte(gtmApprovals.updatedAt, window.since),
                eq(gtmApprovals.status, "pending"),
              ),
            ),
          )
          .orderBy(desc(gtmApprovals.updatedAt))
          .limit(DEFAULT_SOURCE_LIMIT),
    },
  });
}
