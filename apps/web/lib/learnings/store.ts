import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  repoLearningEvidence,
  repoLearningExtractionRuns,
  repoLearnings,
  type RepoLearning,
  type RepoLearningEvidence,
} from "@/lib/db/schema";
import type { FindForDedupResult, LearningsStore } from "./types";

export type RepoLearningWithEvidence = RepoLearning & {
  evidence: RepoLearningEvidence[];
};

export async function listRepoLearnings(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  status?: RepoLearning["status"];
  limit?: number;
  database?: typeof db;
}): Promise<RepoLearningWithEvidence[]> {
  const database = params.database ?? db;
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const where = params.status
    ? and(
        eq(repoLearnings.userId, params.userId),
        eq(repoLearnings.repoOwner, params.repoOwner),
        eq(repoLearnings.repoName, params.repoName),
        eq(repoLearnings.status, params.status),
      )
    : and(
        eq(repoLearnings.userId, params.userId),
        eq(repoLearnings.repoOwner, params.repoOwner),
        eq(repoLearnings.repoName, params.repoName),
      );

  const rows = await database.query.repoLearnings.findMany({
    where,
    orderBy: [desc(repoLearnings.updatedAt)],
    limit,
  });

  if (rows.length === 0) {
    return [];
  }

  const evidenceRows = await database.query.repoLearningEvidence.findMany({
    where: inArray(
      repoLearningEvidence.learningId,
      rows.map((row) => row.id),
    ),
    orderBy: [desc(repoLearningEvidence.createdAt)],
  });
  const evidenceByLearning = new Map<string, RepoLearningEvidence[]>();
  for (const evidence of evidenceRows) {
    const list = evidenceByLearning.get(evidence.learningId) ?? [];
    list.push(evidence);
    evidenceByLearning.set(evidence.learningId, list);
  }

  return rows.map((row) => ({
    ...row,
    evidence: evidenceByLearning.get(row.id) ?? [],
  }));
}

export async function getRepoLearningWithEvidence(
  learningId: string,
  database = db,
): Promise<RepoLearningWithEvidence | undefined> {
  const row = await database.query.repoLearnings.findFirst({
    where: eq(repoLearnings.id, learningId),
  });
  if (!row) {
    return undefined;
  }

  const evidence = await database.query.repoLearningEvidence.findMany({
    where: eq(repoLearningEvidence.learningId, learningId),
    orderBy: [desc(repoLearningEvidence.createdAt)],
  });

  return { ...row, evidence };
}

export async function updateOwnedRepoLearning(params: {
  userId: string;
  learningId: string;
  updates: Partial<
    Pick<RepoLearning, "confidence" | "status"> & { updatedAt: Date }
  >;
  database?: typeof db;
}): Promise<RepoLearning | undefined> {
  const database = params.database ?? db;
  const [row] = await database
    .update(repoLearnings)
    .set({ ...params.updates, updatedAt: new Date() })
    .where(
      and(
        eq(repoLearnings.id, params.learningId),
        eq(repoLearnings.userId, params.userId),
      ),
    )
    .returning();

  return row;
}

/**
 * Creates a Drizzle-backed LearningsStore. This is the only DB-touching file in
 * the learnings module; all extraction/dedup/redaction logic stays pure and is
 * unit-tested against the LearningsStore interface with an injected fake.
 *
 * The `database` parameter defaults to the real client but stays injectable so
 * the executor wiring (#274) and any future integration test can substitute a
 * transaction-scoped client.
 */
export function createDbLearningsStore(database = db): LearningsStore {
  return {
    async findForDedup({ userId, repoOwner, repoName }) {
      const rows = await database
        .select({
          id: repoLearnings.id,
          title: repoLearnings.title,
          rootCause: repoLearnings.rootCause,
          solution: repoLearnings.solution,
          affectedPaths: repoLearnings.affectedPaths,
          prevention: repoLearnings.prevention,
          dedupSignature: repoLearnings.dedupSignature,
        })
        .from(repoLearnings)
        .where(
          and(
            eq(repoLearnings.userId, userId),
            eq(repoLearnings.repoOwner, repoOwner),
            eq(repoLearnings.repoName, repoName),
          ),
        );

      return rows satisfies FindForDedupResult;
    },

    async createLearning(learning) {
      const [row] = await database
        .insert(repoLearnings)
        .values(learning)
        .returning();
      return row;
    },

    async updateLearning(id, updates) {
      const [row] = await database
        .update(repoLearnings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(repoLearnings.id, id))
        .returning();
      return row;
    },

    async recordExtractionRun(run) {
      const [row] = await database
        .insert(repoLearningExtractionRuns)
        .values(run)
        .returning();
      return row;
    },
  };
}
