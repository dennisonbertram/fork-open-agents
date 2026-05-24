import { z } from "zod";
import {
  createComposioToolProfile,
  deleteComposioToolProfile,
  getComposioAgentDefaults,
  listComposioToolProfiles,
  updateComposioAgentDefaults,
  updateComposioToolProfile,
} from "@/lib/db/composio";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  composioAgentDefaultsInputSchema,
  composioToolProfileInputSchema,
  composioToolProfilePatchSchema,
} from "@/lib/composio/types";
import {
  getComposioConfiguredStatus,
  getComposioConfig,
  getComposioDisabledStatus,
  getComposioUnavailableStatus,
} from "@/lib/composio/config";
import { getComposioClient } from "@/lib/composio/client";
import { toComposioUserId } from "@/lib/composio/user-id";

const updateComposioSettingsSchema = z.object({
  defaults: composioAgentDefaultsInputSchema.optional(),
  profileId: z.string().min(1).optional(),
  profile: composioToolProfilePatchSchema.optional(),
});

const deleteComposioProfileSchema = z.object({
  profileId: z.string().min(1),
});

export type ComposioSettingsResponse = {
  status:
    | ReturnType<typeof getComposioConfiguredStatus>
    | ReturnType<typeof getComposioDisabledStatus>;
  profiles: Awaited<ReturnType<typeof listComposioToolProfiles>>;
  defaults: Awaited<ReturnType<typeof getComposioAgentDefaults>>;
};

async function getLiveComposioStatus(userId: string) {
  const config = getComposioConfig();
  if (!config.configured) {
    return getComposioDisabledStatus();
  }

  try {
    await getComposioClient().connectedAccounts.list({
      userIds: [toComposioUserId(userId)],
    });
    return getComposioConfiguredStatus();
  } catch (error) {
    return getComposioUnavailableStatus(error);
  }
}

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const [profiles, defaults, status] = await Promise.all([
    listComposioToolProfiles(authResult.userId),
    getComposioAgentDefaults(authResult.userId),
    getLiveComposioStatus(authResult.userId),
  ]);

  return Response.json({
    status,
    profiles,
    defaults,
  } satisfies ComposioSettingsResponse);
}

export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = composioToolProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Composio profile" },
      { status: 400 },
    );
  }

  try {
    const profile = await createComposioToolProfile(authResult.userId, body);
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: message || "Failed to create Composio profile" },
      { status: 400 },
    );
  }
}

export async function PATCH(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateComposioSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Composio settings payload" },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};

  if (parsed.data.defaults !== undefined) {
    updates.defaults = await updateComposioAgentDefaults(
      authResult.userId,
      parsed.data.defaults,
    );
  }

  if (parsed.data.profileId && parsed.data.profile) {
    const profile = await updateComposioToolProfile(
      authResult.userId,
      parsed.data.profileId,
      parsed.data.profile,
    );
    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }
    updates.profile = profile;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: "At least one update is required" },
      { status: 400 },
    );
  }

  return Response.json(updates);
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteComposioProfileSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid profile id" }, { status: 400 });
  }

  const deleted = await deleteComposioToolProfile(
    authResult.userId,
    parsed.data.profileId,
  );
  if (!deleted) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}
