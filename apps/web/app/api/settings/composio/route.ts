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

/**
 * Walk the error chain (error -> error.cause -> ...) looking for a postgres
 * unique-constraint violation.
 *
 * DrizzleQueryError (drizzle-orm 0.45+) wraps every driver error in `cause`.
 * Its own `message` is `"Failed query: <sql>\nparams: <values>"` which
 * includes user-supplied data, so we must NOT run a "unique|duplicate" regex
 * against it — a profile named e.g. "unique tools" would cause a false 409
 * for any unrelated failure.
 *
 * Instead we:
 *  1. Check `code === "23505"` (PostgreSQL unique_violation) at every node.
 *  2. Check `message` for "unique|duplicate" only on nodes whose message does
 *     NOT look like a DrizzleQueryError wrapper (i.e. does not start with
 *     "Failed query:").  This covers direct application throws and non-Drizzle
 *     driver stacks while avoiding the mislabelling edge case.
 */
function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const pgCode = (current as Error & { code?: string }).code;
    if (pgCode === "23505") return true;
    const isDrizzleWrapper = current.message.startsWith("Failed query:");
    if (!isDrizzleWrapper && /unique|duplicate/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function composioProfileErrorResponse(error: unknown): Response {
  if (isUniqueConstraintError(error)) {
    return Response.json(
      { error: "A profile with that name already exists." },
      { status: 409 },
    );
  }
  // Surface domain-level validation messages that callers intentionally raise.
  const message = error instanceof Error ? error.message : String(error);
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
