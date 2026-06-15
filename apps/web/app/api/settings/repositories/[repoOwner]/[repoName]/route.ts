import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getRepositorySettings,
  upsertRepositorySettings,
} from "@/lib/db/repository-settings";
import { resolveRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";
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
    return Response.json({ error: "Invalid repository" }, { status: 400 });
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
    return Response.json({ error: "Invalid repository" }, { status: 400 });
  }

  const { repoOwner, repoName } = parsedParams.data;
  const { userId } = authResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate schema
  const parsedBody = repoSettingsPatchSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "Invalid repository settings",
        details: parsedBody.error.issues,
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
      { error: "Invalid managedRuntimeProfileId" },
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
      },
      { status: 400 },
    );
  }

  // Enforce cross-field invariant: autoCreatePr cannot be true when effective autoCommitPush is false
  if (patch.autoCreatePr === true) {
    // Determine effective autoCommitPush after the patch
    const effectiveAutoCommitPush =
      patch.autoCommitPush !== undefined
        ? patch.autoCommitPush
        : (await resolveRepoDefaults({ userId, repoOwner, repoName }))
            .autoCommitPush;

    if (!effectiveAutoCommitPush) {
      return Response.json(
        {
          error:
            "autoCreatePr cannot be true when autoCommitPush is false or inherited as false",
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
    return Response.json({ error: "Invalid repository" }, { status: 400 });
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
