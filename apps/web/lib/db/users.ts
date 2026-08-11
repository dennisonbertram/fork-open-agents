import { eq } from "drizzle-orm";
import { db } from "./client";
import { users } from "./schema";

/**
 * Check if a user exists in the database by ID.
 * Returns true if found, false otherwise. Lightweight query (only fetches the ID).
 */
export async function userExists(userId: string): Promise<boolean> {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result.length > 0;
}

/**
 * The identity fields session creation needs.
 *
 * A request-scoped caller reads these off the auth session, but a caller with
 * only a user id (an MCP tool authenticated by an access token) has to look
 * them up. `username` seeds generated branch names, so it is not optional in
 * practice — a missing one silently produces a differently-named branch.
 */
export async function getUserIdentity(
  userId: string,
): Promise<{ username: string; name: string | null } | undefined> {
  const [row] = await db
    .select({ username: users.username, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/**
 * Check if a user has admin privileges.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const result = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0]?.isAdmin === true;
}
