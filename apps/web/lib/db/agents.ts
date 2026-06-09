import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { type Agent, agents } from "./schema";

export interface ListAgentsForUserParams {
  userId: string;
  role?: "main" | "explorer" | "executor" | "design";
}

/**
 * List all agent rows for a user, optionally filtered by role.
 * Returns rows across all scopes so the resolver can pick the most specific.
 */
export async function listAgentsForUser(
  params: ListAgentsForUserParams,
): Promise<Agent[]> {
  const conditions = params.role
    ? and(eq(agents.userId, params.userId), eq(agents.role, params.role))
    : eq(agents.userId, params.userId);

  return db.select().from(agents).where(conditions);
}

/**
 * Get a single agent row by id + userId (ownership check).
 */
export async function getAgentById(
  userId: string,
  agentId: string,
): Promise<Agent | undefined> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);

  return row;
}
