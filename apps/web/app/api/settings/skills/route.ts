import {
  type ApiErrorKind,
  apiErrorKindForStatus,
} from "@/lib/api/error-response";
import {
  createUserSkill,
  deleteUserSkill,
  listUserSkills,
  SkillNameConflictError,
  updateUserSkill,
} from "@/lib/db/skills";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  createUserSkillInputSchema,
  deleteUserSkillInputSchema,
  updateUserSkillInputSchema,
} from "@/lib/skills/skill-types";

function jsonError(error: string, status: number, kind?: ApiErrorKind) {
  return Response.json(
    { error, errorKind: kind ?? apiErrorKindForStatus(status) },
    { status },
  );
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  const skills = await listUserSkills(session.user.id);
  return Response.json({ skills });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = createUserSkillInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid skill payload",
      400,
    );
  }

  try {
    const skill = await createUserSkill(session.user.id, parsed.data);
    return Response.json({ skill }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return jsonError(error.message, 409);
    }
    console.error("Failed to create skill:", error);
    return jsonError("Failed to create skill", 500);
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = updateUserSkillInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid skill payload",
      400,
    );
  }

  try {
    const skill = await updateUserSkill(session.user.id, parsed.data);
    if (!skill) {
      return jsonError("Skill not found", 404);
    }
    return Response.json({ skill });
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return jsonError(error.message, 409);
    }
    console.error("Failed to update skill:", error);
    return jsonError("Failed to update skill", 500);
  }
}

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return jsonError("Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = deleteUserSkillInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid skill payload", 400);
  }

  try {
    const deleted = await deleteUserSkill(session.user.id, parsed.data.id);
    if (!deleted) {
      return jsonError("Skill not found", 404);
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete skill:", error);
    return jsonError("Failed to delete skill", 500);
  }
}
