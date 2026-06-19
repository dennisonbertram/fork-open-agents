import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repoLearningExtractionRuns, repoLearnings } from "@/lib/db/schema";
import type { FindForDedupResult, LearningsStore } from "./types";

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
