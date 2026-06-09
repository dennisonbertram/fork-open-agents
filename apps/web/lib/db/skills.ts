import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CreateUserSkillInput,
  UpdateUserSkillInput,
} from "@/lib/skills/skill-types";
import { db } from "./client";
import { type NewUserSkill, type UserSkill, userSkills } from "./schema";

const SKILL_ID_PREFIX = "skill_";

/** Thrown when a create/update would collide with an existing skill name. */
export class SkillNameConflictError extends Error {
  readonly kind = "DuplicateName" as const;
  constructor(name: string) {
    super(`A skill named "${name}" already exists.`);
    this.name = "SkillNameConflictError";
  }
}

export async function listUserSkills(userId: string): Promise<UserSkill[]> {
  return db.query.userSkills.findMany({
    where: eq(userSkills.userId, userId),
    orderBy: [desc(userSkills.updatedAt), desc(userSkills.createdAt)],
  });
}

export async function listEnabledUserSkills(
  userId: string,
): Promise<UserSkill[]> {
  return db.query.userSkills.findMany({
    where: and(eq(userSkills.userId, userId), eq(userSkills.enabled, true)),
    orderBy: [desc(userSkills.updatedAt)],
  });
}

export async function countEnabledUserSkills(userId: string): Promise<number> {
  const rows = await db
    .select({ id: userSkills.id })
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), eq(userSkills.enabled, true)));
  return rows.length;
}

export async function getUserSkillByIdForUser(
  userId: string,
  skillId: string,
): Promise<UserSkill | null> {
  return (
    (await db.query.userSkills.findFirst({
      where: and(eq(userSkills.id, skillId), eq(userSkills.userId, userId)),
    })) ?? null
  );
}

async function findSkillByName(
  userId: string,
  name: string,
): Promise<UserSkill | null> {
  return (
    (await db.query.userSkills.findFirst({
      where: and(eq(userSkills.userId, userId), eq(userSkills.name, name)),
    })) ?? null
  );
}

export async function createUserSkill(
  userId: string,
  input: CreateUserSkillInput,
): Promise<UserSkill> {
  const conflict = await findSkillByName(userId, input.name);
  if (conflict) {
    throw new SkillNameConflictError(input.name);
  }

  const now = new Date();
  const row: NewUserSkill = {
    id: `${SKILL_ID_PREFIX}${nanoid()}`,
    userId,
    name: input.name,
    description: input.description,
    body: input.body,
    enabled: input.enabled,
    disableModelInvocation: input.disableModelInvocation,
    userInvocable: input.userInvocable,
    allowedTools: input.allowedTools,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db.insert(userSkills).values(row).returning();
  if (!created) {
    throw new Error("Failed to create skill");
  }
  return created;
}

export async function updateUserSkill(
  userId: string,
  input: UpdateUserSkillInput,
): Promise<UserSkill | null> {
  const existing = await getUserSkillByIdForUser(userId, input.id);
  if (!existing) {
    return null;
  }

  if (input.name !== undefined && input.name !== existing.name) {
    const conflict = await findSkillByName(userId, input.name);
    if (conflict) {
      throw new SkillNameConflictError(input.name);
    }
  }

  const updates: Partial<NewUserSkill> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    updates.name = input.name;
  }
  if (input.description !== undefined) {
    updates.description = input.description;
  }
  if (input.body !== undefined) {
    updates.body = input.body;
  }
  if (input.enabled !== undefined) {
    updates.enabled = input.enabled;
  }
  if (input.disableModelInvocation !== undefined) {
    updates.disableModelInvocation = input.disableModelInvocation;
  }
  if (input.userInvocable !== undefined) {
    updates.userInvocable = input.userInvocable;
  }
  if (input.allowedTools !== undefined) {
    updates.allowedTools = input.allowedTools;
  }

  const [updated] = await db
    .update(userSkills)
    .set(updates)
    .where(and(eq(userSkills.id, input.id), eq(userSkills.userId, userId)))
    .returning();

  return updated ?? null;
}

export async function deleteUserSkill(
  userId: string,
  skillId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(userSkills)
    .where(and(eq(userSkills.id, skillId), eq(userSkills.userId, userId)))
    .returning({ id: userSkills.id });
  return deleted.length > 0;
}
