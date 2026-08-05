import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getRepositorySettings,
  upsertRepositorySettings,
} from "@/lib/db/repository-settings";
import { resolveRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { isManagedRuntimeProfileId } from "@open-agents/sandbox/managed-runtime-profiles";
import {
  repoSettingsPatchSchema,
  ALLOWED_VCPU_VALUES,
} from "@/app/settings/repositories/[owner]/[repo]/repo-settings-form";

// ── Route context ──────────────────────────────────────────────────────────────

type RouteContext = {
  params: Promise<{ repoOwner: string; repoName: string }>;
};

const routeParamsSchema = z.object({
  repoOwner: z.string().trim().min(1),
  repoName: z.string().trim().min(1),
});

async function parseRouteParams(context: RouteContext) {
  const params = await context.params;
  return routeParamsSchema.safeParse({
    repoOwner: decodeURIComponent(params.repoOwner),
    repoName: decodeURIComponent(params.repoName),
  });
}

// ── The "all-null" settings object used by DELETE to reset all overrides ───────

const ALL_NULL_SETTINGS = {
  fullClone: null,
  prewarmEnabled: null,
  runtimeMode: null,
  managedRuntimeProfileId: null,
  vcpus: null,
  autoCommitPush: null,
  autoCreatePr: null,
  defaultBranch: null,
  isNewBranch: null,
} as const;

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  context: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json(
      { error: "Invalid repository", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { repoOwner, repoName } = parsedParams.data;
  const { userId } = authResult;

  const [resolved, raw] = await Promise.all([
    resolveRepoDefaults({ userId, repoOwner, repoName }),
    getRepositorySettings({ userId, repoOwner, repoName }),
  ]);

  return Response.json({ resolved, raw: raw ?? null });
}

// ── PATCH ──────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json(
      { error: "Invalid repository", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { repoOwner, repoName } = parsedParams.data;
  const { userId } = authResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  // Validate schema
  const parsedBody = repoSettingsPatchSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "Invalid repository settings",
        details: parsedBody.error.issues,
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const patch = parsedBody.data;

  // Validate managedRuntimeProfileId
  if (
    patch.managedRuntimeProfileId !== undefined &&
    patch.managedRuntimeProfileId !== null &&
    !isManagedRuntimeProfileId(patch.managedRuntimeProfileId)
  ) {
    return Response.json(
      {
        error: "Invalid managedRuntimeProfileId",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  // Validate vcpus against allowed set
  if (
    patch.vcpus !== undefined &&
    patch.vcpus !== null &&
    !ALLOWED_VCPU_VALUES.has(patch.vcpus)
  ) {
    return Response.json(
      {
        error: `Invalid vcpus — allowed values: ${[...ALLOWED_VCPU_VALUES].join(", ")}`,
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  // Enforce cross-field invariant in BOTH directions: after applying this patch,
  // autoCreatePr must not be true while autoCommitPush is not true. This covers
  // PATCH {autoCreatePr:true} AND PATCH {autoCommitPush:false}. Compute the full
  // post-patch effective state per field, where undefined=unchanged (keep current
  // override), null=inherit (fall through to user pref / system), value=override.
  {
    const [current, prefs] = await Promise.all([
      getRepositorySettings({ userId, repoOwner, repoName }),
      getUserPreferences(userId),
    ]);
    const postPatchOverride = <T>(
      patchValue: T | null | undefined,
      currentValue: T | null | undefined,
    ): T | null =>
      patchValue !== undefined ? patchValue : (currentValue ?? null);

    // `?? ` only falls through on null/undefined, so an explicit `false` override is preserved.
    const nextAutoCommitPush =
      postPatchOverride(patch.autoCommitPush, current?.autoCommitPush) ??
      prefs.autoCommitPush ??
      false;
    const nextAutoCreatePr =
      postPatchOverride(patch.autoCreatePr, current?.autoCreatePr) ??
      prefs.autoCreatePr ??
      false;

    if (nextAutoCreatePr === true && nextAutoCommitPush !== true) {
      return Response.json(
        {
          error:
            "autoCreatePr cannot be enabled while autoCommitPush is off (or inherited as off)",
          errorKind: "invalid_request",
        },
        { status: 400 },
      );
    }
  }

  // Upsert settings (undefined fields are omitted = left unchanged)
  await upsertRepositorySettings({
    userId,
    repoOwner,
    repoName,
    settings: patch,
  });

  // Return refreshed resolved + raw
  const [resolved, raw] = await Promise.all([
    resolveRepoDefaults({ userId, repoOwner, repoName }),
    getRepositorySettings({ userId, repoOwner, repoName }),
  ]);

  return Response.json({ resolved, raw: raw ?? null });
}

// ── DELETE — reset all overrides to inherit ───────────────────────────────────

export async function DELETE(
  _req: Request,
  context: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json(
      { error: "Invalid repository", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { repoOwner, repoName } = parsedParams.data;
  const { userId } = authResult;

  // Reset all overrides by writing all-null (no schema change, no new DB helper needed)
  await upsertRepositorySettings({
    userId,
    repoOwner,
    repoName,
    settings: ALL_NULL_SETTINGS,
  });

  const [resolved, raw] = await Promise.all([
    resolveRepoDefaults({ userId, repoOwner, repoName }),
    getRepositorySettings({ userId, repoOwner, repoName }),
  ]);

  return Response.json({ resolved, raw: raw ?? null });
}
