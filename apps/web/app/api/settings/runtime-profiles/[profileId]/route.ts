import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  deleteUserDefaultProfile,
  getUserDefaultProfile,
  toManagedRuntimeProfile,
  updateUserDefaultProfile,
} from "@/lib/db/managed-runtime-saved-profiles";

const commandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  required: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  setupCommands: z.array(commandSchema).min(1),
  verificationCommands: z.array(commandSchema).min(1),
  expectedTools: z.array(z.string().trim().min(1)).default([]),
  optionalTools: z.array(z.string().trim().min(1)).default([]),
  defaultPorts: z.array(z.number().int().positive()).default([]),
});

export type UserDefaultProfileDetailResponse = {
  profile: ReturnType<typeof toManagedRuntimeProfile>;
};

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

export async function PATCH(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { profileId } = await ctx.params;

  const existing = await getUserDefaultProfile({
    userId: auth.userId,
    profileId,
  });
  if (!existing) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateProfileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid managed runtime profile" },
      { status: 400 },
    );
  }

  const updated = await updateUserDefaultProfile({
    userId: auth.userId,
    profileId,
    profile: parsed.data,
  });
  if (!updated) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json({
    profile: toManagedRuntimeProfile(updated),
  } satisfies UserDefaultProfileDetailResponse);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { profileId } = await ctx.params;

  const deleted = await deleteUserDefaultProfile({
    userId: auth.userId,
    profileId,
  });
  if (!deleted) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json({
    deletedProfileId: deleted.id,
    preferenceReset: deleted.preferenceReset,
  });
}
