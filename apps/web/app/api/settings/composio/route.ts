import { z } from "zod";
import {
  createComposioToolProfile,
  deleteComposioToolProfile,
  getComposioAgentDefaults,
  listComposioProfileOptionsForRepository,
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
    | ReturnType<typeof getComposioDisabledStatus>
    | ReturnType<typeof getComposioUnavailableStatus>;
  profiles: Awaited<ReturnType<typeof listComposioToolProfiles>>;
  profileOptions: Awaited<
    ReturnType<typeof listComposioProfileOptionsForRepository>
  >["profileOptions"];
  repositorySettings: Awaited<
    ReturnType<typeof listComposioProfileOptionsForRepository>
  >["repositorySettings"];
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

export async function GET(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const searchParams = new URL(req.url).searchParams;
  const repoOwner = searchParams.get("repoOwner");
  const repoName = searchParams.get("repoName");

  const [profilePolicy, defaults, status] = await Promise.all([
    listComposioProfileOptionsForRepository({
      userId: authResult.userId,
      repoOwner,
      repoName,
    }),
    getComposioAgentDefaults(authResult.userId),
    getLiveComposioStatus(authResult.userId),
  ]);

  return Response.json({
    status,
    profiles: profilePolicy.profiles,
    profileOptions: profilePolicy.profileOptions,
    repositorySettings: profilePolicy.repositorySettings,
    defaults,
  } satisfies ComposioSettingsResponse);
}

function composioProfileErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (/unique|duplicate/i.test(message)) {
    return Response.json(
      { error: "A profile with that name already exists." },
      { status: 409 },
    );
  }
  if (/at least one toolkit/i.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  console.error("[composio] Failed to save profile:", error);
  return Response.json(
    { error: "Failed to save Composio profile." },
    { status: 400 },
  );
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
    const profile = await createComposioToolProfile(
      authResult.userId,
      parsed.data,
    );
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return composioProfileErrorResponse(error);
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
    try {
      const profile = await updateComposioToolProfile(
        authResult.userId,
        parsed.data.profileId,
        parsed.data.profile,
      );
      if (!profile) {
        return Response.json({ error: "Profile not found" }, { status: 404 });
      }
      updates.profile = profile;
    } catch (error) {
      return composioProfileErrorResponse(error);
    }
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
