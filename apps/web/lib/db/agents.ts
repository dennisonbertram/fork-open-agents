import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { type Agent, agents } from "./schema";
import type { AgentRole } from "@/lib/agents/resolve-agent";

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

// ── Phase 3: user_default CRUD ────────────────────────────────────────────────

export interface UserDefaultAgentPatch {
  modelId?: string | null;
  composioToolkitSlugs?: string[];
  composioProfileId?: string | null;
  instructions?: string | null;
  managedRuntimeProfileId?: string | null;
}

/**
 * Get the user_default agent row for a given userId + role.
 * Returns undefined when no row exists (synthetic fallback is used instead).
 */
export async function getUserDefaultAgent(
  userId: string,
  role: AgentRole,
): Promise<Agent | undefined> {
  const [row] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.userId, userId),
        eq(agents.role, role),
        eq(agents.scope, "user_default"),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Upsert (create or update) a user_default agent row for a given userId + role.
 * One row per (userId, role, scope=user_default, sessionId=null).
 *
 * On conflict (same userId+role+scope), updates the patch fields and updatedAt.
 */
export async function upsertUserDefaultAgent(
  userId: string,
  role: AgentRole,
  patch: UserDefaultAgentPatch,
): Promise<void> {
  const now = new Date();
  const id = nanoid();

  const row = {
    id,
    userId,
    name: `${role} (user default)`,
    description: "",
    role,
    scope: "user_default" as const,
    sessionId: null,
    repoOwner: null,
    repoName: null,
    modelId: patch.modelId ?? null,
    composioToolkitSlugs: patch.composioToolkitSlugs ?? [],
    composioProfileId: patch.composioProfileId ?? null,
    instructions: patch.instructions ?? null,
    managedRuntimeProfileId: patch.managedRuntimeProfileId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(agents)
    .values(row)
    .onConflictDoUpdate({
      target: [agents.userId, agents.role, agents.scope],
      set: {
        modelId: row.modelId,
        composioToolkitSlugs: row.composioToolkitSlugs,
        composioProfileId: row.composioProfileId,
        instructions: row.instructions,
        managedRuntimeProfileId: row.managedRuntimeProfileId,
        updatedAt: now,
      },
    });
}

/**
 * Delete the user_default agent row for a given userId + role.
 * Resetting to "inherited" — the resolver falls back to synthetic defaults.
 */
export async function deleteUserDefaultAgent(
  userId: string,
  role: AgentRole,
): Promise<void> {
  await db
    .delete(agents)
    .where(
      and(
        eq(agents.userId, userId),
        eq(agents.role, role),
        eq(agents.scope, "user_default"),
      ),
    );
}
