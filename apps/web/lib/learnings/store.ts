import "server-only";

import { and, eq } from "drizzle-orm";
import { repoLearningExtractionRuns, repoLearnings } from "@/lib/db/schema";
import type {
  FindForDedupResult,
  LearningsStore,
  RepoLearningExtractionRunRow,
  RepoLearningRow,
} from "./types";

type DbClient = {
  insert: (table: unknown) => {
    values: (values: unknown) => Promise<unknown>;
  };
  update: (table: unknown) => {
    set: (values: unknown) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown[]>;
    };
  };
};

/**
 * Creates a Drizzle-backed LearningsStore.
 * This is the only DB-touching file in the learnings module.
 */
export function createDbLearningsStore(db: DbClient): LearningsStore {
  return {
    async findForDedup({ userId, repoOwner, repoName }) {
      const rows = await (db
        .select()
        .from(repoLearnings)
        .where(
          and(
            eq(repoLearnings.userId, userId),
            eq(repoLearnings.repoOwner, repoOwner),
            eq(repoLearnings.repoName, repoName),
          ),
        ) as unknown as Promise<RepoLearningRow[]>);

      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        rootCause: r.rootCause,
        solution: r.solution,
        affectedPaths: r.affectedPaths,
        prevention: r.prevention,
        dedupSignature: r.dedupSignature,
      })) satisfies FindForDedupResult;
    },

    async createLearning(learning) {
      const [row] = await (db.insert(repoLearnings).values({
        ...learning,
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as unknown as Promise<RepoLearningRow[]>);
      return row;
    },

    async updateLearning(id, updates) {
      const [row] = await (db
        .update(repoLearnings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(repoLearnings.id, id)) as unknown as Promise<
        RepoLearningRow[]
      >);
      return row;
    },

    async recordExtractionRun(run) {
      const [row] = await (db
        .insert(repoLearningExtractionRuns)
        .values({ ...run, createdAt: new Date() }) as unknown as Promise<
        RepoLearningExtractionRunRow[]
      >);
      return row;
    },
  };
}
