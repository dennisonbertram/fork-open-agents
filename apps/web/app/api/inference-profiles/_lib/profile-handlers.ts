import {
  type ApiErrorKind,
  apiErrorKindForStatus,
} from "@/lib/api/error-response";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  deleteInferenceProfile,
  listInferenceProfiles,
  updateInferenceProfile,
} from "@/lib/db/inference-profiles";
import {
  deleteInferenceProfileInputSchema,
  updateInferenceProfileInputSchema,
} from "@/lib/inference/types";

export function jsonError(error: string, status: number, kind?: ApiErrorKind) {
  return Response.json(
    { error, errorKind: kind ?? apiErrorKindForStatus(status) },
    { status },
  );
}

const UNIQUE_VIOLATION_CODE = "23505";

/**
 * drizzle-orm wraps driver errors in DrizzleQueryError, whose message is
 * "Failed query: ...\nparams: ..." — the postgres unique-violation details only
 * live on `cause`, so walk the chain instead of reading the top message.
 * Wrapper messages embed query params (including the submitted profile name),
 * so only unwrapped errors are matched by text.
 */
export function isDuplicateNameError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = current as Error & { code?: unknown; query?: unknown };
    if (candidate.code === UNIQUE_VIOLATION_CODE) {
      return true;
    }
    if (
      candidate.query === undefined &&
      /unique|duplicate/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export function getProfileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isDuplicateNameError(error)) {
    return "An inference profile with that name already exists.";
  }
  if (/OpenAI-compatible profiles require a base URL/i.test(message)) {
    return "OpenAI-compatible profiles require a base URL.";
  }
  if (/base url/i.test(message) || /invalid url/i.test(message)) {
    return "Base URL must be a valid HTTP URL.";
  }
  return "Failed to save inference profile.";
}

async function readJson(req: Request): Promise<
  | { ok: true; body: unknown }
  | {
      ok: false;
      response: Response;
    }
> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body", 400) };
  }
}

/**
 * Single implementation behind both the collection-level PATCH (id in the body,
 * deprecated) and PATCH /api/inference-profiles/[profileId].
 */
export async function handleUpdateInferenceProfile(
  req: Request,
  profileIdFromPath?: string,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const json = await readJson(req);
  if (!json.ok) {
    return json.response;
  }

  const payload =
    profileIdFromPath === undefined
      ? json.body
      : {
          ...(json.body && typeof json.body === "object" ? json.body : {}),
          profileId: profileIdFromPath,
        };

  const parsed = updateInferenceProfileInputSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError("Invalid inference profile payload", 400);
  }

  try {
    const profile = await updateInferenceProfile(
      authResult.userId,
      parsed.data,
    );
    if (!profile) {
      return jsonError("Inference profile not found", 404);
    }
    return Response.json({ profile });
  } catch (error) {
    return jsonError(
      getProfileErrorMessage(error),
      isDuplicateNameError(error) ? 409 : 400,
    );
  }
}

/**
 * Single implementation behind both the collection-level DELETE (id in the
 * body, deprecated) and DELETE /api/inference-profiles/[profileId].
 */
export async function handleDeleteInferenceProfile(
  req: Request,
  profileIdFromPath?: string,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let profileId = profileIdFromPath;
  if (profileId === undefined) {
    const json = await readJson(req);
    if (!json.ok) {
      return json.response;
    }
    const parsed = deleteInferenceProfileInputSchema.safeParse(json.body);
    if (!parsed.success) {
      return jsonError("Invalid inference profile id", 400);
    }
    profileId = parsed.data.profileId;
  }

  const deleted = await deleteInferenceProfile(authResult.userId, profileId);
  if (!deleted) {
    return jsonError("Inference profile not found", 404);
  }

  return Response.json({ success: true });
}

export async function handleGetInferenceProfile(
  profileId: string,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  // ponytail: reuses the sanitized list instead of adding a second safe-getter
  // to the db layer; swap to a dedicated query if profile counts ever grow.
  const profiles = await listInferenceProfiles(authResult.userId);
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return jsonError("Inference profile not found", 404);
  }

  return Response.json({ profile });
}
