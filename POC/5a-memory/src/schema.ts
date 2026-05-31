/**
 * Memory store schema.
 *
 * Two views of the same table:
 *
 *  1. `agentMemoriesPg` — the PRODUCTION Drizzle definition that would be added
 *     to `apps/web/lib/db/schema.ts`. It mirrors the repo's pgTable conventions
 *     (text ids, snake_case columns, timestamps, scoping indexes) and uses
 *     pgvector for the embedding column. This is documentation-as-code: it is
 *     the exact integration artifact, not executed by the offline eval.
 *
 *  2. `agentMemories` (sqlite) — the SELF-CONTAINED definition the eval runs
 *     against. Postgres + pgvector is not available offline, so the embedding
 *     is stored as a JSON-encoded float array in a text column and cosine
 *     similarity is computed in-process. The column set is identical so the
 *     write/retrieval logic is portable verbatim.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const MEMORY_KINDS = ["decision", "convention", "fix", "fact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

// ---------------------------------------------------------------------------
// Self-contained sqlite table used by the eval.
// ---------------------------------------------------------------------------

export const agentMemories = sqliteTable(
  "agent_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    content: text("content").notNull(),
    // JSON-encoded number[]; in production this is a pgvector `vector` column.
    embedding: text("embedding").notNull(),
    // Records which embedding model produced the vector (drift guard).
    embeddingModel: text("embedding_model").notNull(),
    sourceSessionId: text("source_session_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    useCount: integer("use_count").notNull().default(0),
  },
  (table) => [
    // The scoping index that retrieval ALWAYS filters on. Multi-tenant safety
    // is enforced in SQL (WHERE userId/repoOwner/repoName), not in app code.
    index("agent_memories_scope_idx").on(
      table.userId,
      table.repoOwner,
      table.repoName,
    ),
  ],
);

export type AgentMemoryRow = typeof agentMemories.$inferSelect;
export type NewAgentMemoryRow = typeof agentMemories.$inferInsert;

// ---------------------------------------------------------------------------
// Production Postgres + pgvector definition (integration reference).
//
// This is the literal addition for apps/web/lib/db/schema.ts. Kept as a string
// constant so the POC has no Postgres runtime dependency, but it is real,
// copy-pasteable Drizzle. EMBED_DIM matches the chosen gateway model
// (text-embedding-3-small = 1536). pgvector + an HNSW index gives sub-linear
// ANN retrieval at scale.
// ---------------------------------------------------------------------------

export const PRODUCTION_PG_SCHEMA = String.raw`
// apps/web/lib/db/schema.ts  (add near sessions/chats)
//
// Requires:  CREATE EXTENSION IF NOT EXISTS vector;   (Drizzle: sql\` \` in a migration)
// import { vector, index, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const agentMemoryKind = ["decision", "convention", "fix", "fact"] as const;
const EMBED_DIM = 1536; // openai/text-embedding-3-small via AI Gateway

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    kind: text("kind", { enum: agentMemoryKind }).notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    sourceSessionId: text("source_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    useCount: integer("use_count").notNull().default(0),
  },
  (table) => [
    // Scope-first composite index: every query filters by this tuple.
    index("agent_memories_scope_idx").on(
      table.userId,
      table.repoOwner,
      table.repoName,
    ),
    // ANN index for vector search (cosine). HNSW for low-latency top-k.
    index("agent_memories_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
`;
