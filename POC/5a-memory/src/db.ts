/**
 * Self-contained database for the eval.
 *
 * Stands in for the real Neon client (`apps/web/lib/db/client.ts`). Uses
 * `bun:sqlite` + Drizzle and creates the `agent_memories` table at startup.
 * The retrieval/write logic is written against the Drizzle query builder so it
 * is portable to the production Postgres client with no behavioral change
 * (the only difference is pgvector ANN vs. the in-process cosine scan here).
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { agentMemories } from "./schema";

export type MemoryDb = ReturnType<typeof createMemoryDb>;

export function createMemoryDb(path = ":memory:") {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      source_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_used_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      use_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_memories_scope_idx
      ON agent_memories (user_id, repo_owner, repo_name);
  `);
  const db = drizzle(sqlite, { schema: { agentMemories } });
  return Object.assign(db, { $sqlite: sqlite });
}
