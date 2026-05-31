/**
 * Memory store: write path (with dedup) and retrieval path (scoped cosine).
 *
 * Scoping invariant: every read and every dedup lookup filters by the full
 * (userId, repoOwner, repoName) tuple in SQL. There is no code path that can
 * return or merge a memory from a different user or repo.
 */

import { and, eq } from "drizzle-orm";
import type { MemoryDb } from "./db";
import type { Embedder } from "./embedder";
import {
  agentMemories,
  type AgentMemoryRow,
  type MemoryKind,
} from "./schema";

export type MemoryScope = {
  userId: string;
  repoOwner: string;
  repoName: string;
};

export type WriteMemoryInput = MemoryScope & {
  kind: MemoryKind;
  content: string;
  sourceSessionId?: string;
};

export type RetrievedMemory = {
  id: string;
  kind: MemoryKind;
  content: string;
  score: number;
  useCount: number;
};

export type WriteResult =
  | { action: "inserted"; id: string }
  | { action: "merged"; id: string; mergedScore: number };

/**
 * Near-duplicate threshold. Two memories in the same scope+kind whose vectors
 * exceed this cosine similarity are treated as the same memory; the existing
 * row is reinforced (useCount++ / lastUsedAt) and its content refreshed to the
 * newer phrasing instead of inserting a second row.
 */
const DEDUP_THRESHOLD = 0.92;

function decodeEmbedding(raw: string): number[] {
  return JSON.parse(raw) as number[];
}

/** Cosine similarity. Vectors are L2-normalized by the embedder, so this is a
 *  dot product, but we divide by norms defensively for portability. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function genId(): string {
  return `mem_${crypto.randomUUID()}`;
}

export class MemoryStore {
  constructor(
    private readonly db: MemoryDb,
    private readonly embedder: Embedder,
  ) {}

  /**
   * Write a memory scoped to (user, repo). If a near-duplicate already exists
   * in the same scope and kind, merge into it (reinforce) instead of inserting.
   */
  async write(input: WriteMemoryInput): Promise<WriteResult> {
    const embedding = await this.embedder.embed(input.content);

    // Dedup lookup is itself strictly scoped.
    const existing = this.db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.userId, input.userId),
          eq(agentMemories.repoOwner, input.repoOwner),
          eq(agentMemories.repoName, input.repoName),
          eq(agentMemories.kind, input.kind),
        ),
      )
      .all() as AgentMemoryRow[];

    let best: { row: AgentMemoryRow; score: number } | null = null;
    for (const row of existing) {
      const score = cosineSimilarity(embedding, decodeEmbedding(row.embedding));
      if (!best || score > best.score) {
        best = { row, score };
      }
    }

    if (best && best.score >= DEDUP_THRESHOLD) {
      const now = new Date();
      this.db
        .update(agentMemories)
        .set({
          // Refresh to the newer phrasing + re-embed; reinforce usage signal.
          content: input.content,
          embedding: JSON.stringify(embedding),
          embeddingModel: this.embedder.id,
          lastUsedAt: now,
          useCount: best.row.useCount + 1,
        })
        .where(eq(agentMemories.id, best.row.id))
        .run();
      return { action: "merged", id: best.row.id, mergedScore: best.score };
    }

    const id = genId();
    this.db
      .insert(agentMemories)
      .values({
        id,
        userId: input.userId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        kind: input.kind,
        content: input.content,
        embedding: JSON.stringify(embedding),
        embeddingModel: this.embedder.id,
        sourceSessionId: input.sourceSessionId ?? null,
      })
      .run();
    return { action: "inserted", id };
  }

  /**
   * Retrieve the top-k most relevant memories for a query, STRICTLY scoped to
   * (userId, repoOwner, repoName). Returns nothing for an empty scope.
   *
   * @param touch when true, increments useCount / lastUsedAt on returned rows
   *   (matches production: a memory injected into context counts as "used").
   */
  async retrieve(
    query: string,
    scope: MemoryScope,
    options: { topK?: number; touch?: boolean } = {},
  ): Promise<RetrievedMemory[]> {
    const topK = options.topK ?? 3;
    const queryEmbedding = await this.embedder.embed(query);

    // SCOPE FILTER — the multi-tenant boundary. Applied in SQL, before scoring.
    const candidates = this.db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.userId, scope.userId),
          eq(agentMemories.repoOwner, scope.repoOwner),
          eq(agentMemories.repoName, scope.repoName),
        ),
      )
      .all() as AgentMemoryRow[];

    const scored = candidates
      .map((row) => ({
        row,
        score: cosineSimilarity(queryEmbedding, decodeEmbedding(row.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (options.touch) {
      const now = new Date();
      for (const { row } of scored) {
        this.db
          .update(agentMemories)
          .set({ lastUsedAt: now, useCount: row.useCount + 1 })
          .where(eq(agentMemories.id, row.id))
          .run();
      }
    }

    return scored.map(({ row, score }) => ({
      id: row.id,
      kind: row.kind,
      content: row.content,
      score,
      useCount: row.useCount,
    }));
  }

  /** Count of all memories (test helper). */
  count(scope?: MemoryScope): number {
    const rows = scope
      ? (this.db
          .select()
          .from(agentMemories)
          .where(
            and(
              eq(agentMemories.userId, scope.userId),
              eq(agentMemories.repoOwner, scope.repoOwner),
              eq(agentMemories.repoName, scope.repoName),
            ),
          )
          .all() as AgentMemoryRow[])
      : (this.db.select().from(agentMemories).all() as AgentMemoryRow[]);
    return rows.length;
  }
}
