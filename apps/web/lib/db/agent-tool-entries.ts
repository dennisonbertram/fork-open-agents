import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { agentToolEntries, agents } from "./schema";
import type { AgentToolEntry } from "./schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateProposedToolEntryInput {
  agentId: string;
  userId: string;
  toolkitSlug: string;
  createdByChatId: string | null;
  createdByRunId: string | null;
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Record a proposed toolkit addition from an agent.
 *
 * Status starts as "proposed" — the slug is NOT appended to the agent's
 * composioToolkitSlugs until the owner explicitly approves it (off-by-default).
 */
export async function createProposedToolEntry(
  input: CreateProposedToolEntryInput,
): Promise<AgentToolEntry> {
  const id = nanoid();
  const now = new Date();

  const row = {
    id,
    agentId: input.agentId,
    userId: input.userId,
    provider: "composio" as const,
    toolkitSlug: input.toolkitSlug,
    status: "proposed" as const,
    createdByChatId: input.createdByChatId,
    createdByRunId: input.createdByRunId,
    createdAt: now,
    approvedAt: null,
  };

  const [inserted] = await db.insert(agentToolEntries).values(row).returning();

  return inserted;
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * List all tool entries for the given agent, scoped to the owner.
 * Owner scoping is enforced by requiring both userId and agentId.
 */
export async function listToolEntriesForAgent(
  userId: string,
  agentId: string,
): Promise<AgentToolEntry[]> {
  return db
    .select()
    .from(agentToolEntries)
    .where(
      and(
        eq(agentToolEntries.userId, userId),
        eq(agentToolEntries.agentId, agentId),
      ),
    );
}

// ── Approval / rejection ──────────────────────────────────────────────────────

/**
 * Approve a proposed tool entry.
 *
 * - Sets status to "approved" and records approvedAt.
 * - Appends the toolkit slug to the agent's composioToolkitSlugs (makes it live).
 * - Owner-scoped: only the entry's userId may approve.
 *
 * Returns true on success, false when the entry is not found for this user.
 */
export async function approveToolEntry(
  userId: string,
  entryId: string,
): Promise<boolean> {
  // Fetch the entry with ownership check
  const [entry] = await db
    .select()
    .from(agentToolEntries)
    .where(
      and(
        eq(agentToolEntries.id, entryId),
        eq(agentToolEntries.userId, userId),
      ),
    )
    .limit(1);

  if (!entry) {
    return false;
  }

  const now = new Date();

  // Mark entry as approved
  await db
    .update(agentToolEntries)
    .set({ status: "approved", approvedAt: now })
    .where(eq(agentToolEntries.id, entryId));

  // Append slug to the agent's composioToolkitSlugs (makes it live)
  const [agentRow] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, entry.agentId))
    .limit(1);

  if (agentRow) {
    const existing = agentRow.composioToolkitSlugs ?? [];
    if (!existing.includes(entry.toolkitSlug)) {
      await db
        .update(agents)
        .set({
          composioToolkitSlugs: [...existing, entry.toolkitSlug],
          updatedAt: now,
        })
        .where(eq(agents.id, entry.agentId));
    }
  }

  return true;
}

/**
 * Reject a proposed tool entry.
 *
 * - Sets status to "rejected".
 * - Does NOT modify the agent's composioToolkitSlugs.
 * - Owner-scoped: only the entry's userId may reject.
 *
 * Returns true on success, false when the entry is not found for this user.
 */
export async function rejectToolEntry(
  userId: string,
  entryId: string,
): Promise<boolean> {
  // Fetch the entry with ownership check
  const [entry] = await db
    .select()
    .from(agentToolEntries)
    .where(
      and(
        eq(agentToolEntries.id, entryId),
        eq(agentToolEntries.userId, userId),
      ),
    )
    .limit(1);

  if (!entry) {
    return false;
  }

  await db
    .update(agentToolEntries)
    .set({ status: "rejected" })
    .where(eq(agentToolEntries.id, entryId));

  return true;
}
