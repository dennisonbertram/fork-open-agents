import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  createInferenceProfile,
  listInferenceProfiles,
  setInferenceProfileModels,
} from "@/lib/db/inference-profiles";
import { fetchInferenceProfileModels } from "@/lib/inference/fetch-profile-models";
import { createInferenceProfileInputSchema } from "@/lib/inference/types";
import {
  getProfileErrorMessage,
  handleDeleteInferenceProfile,
  handleUpdateInferenceProfile,
  isDuplicateNameError,
  jsonError,
} from "./_lib/profile-handlers";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const profiles = await listInferenceProfiles(authResult.userId);
  return Response.json({ profiles });
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
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = createInferenceProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid inference profile payload", 400);
  }

  try {
    const profile = await createInferenceProfile(
      authResult.userId,
      parsed.data,
    );
    // Populate the endpoint's real model list up front (best-effort) so the
    // picker shows the provider's own models rather than the Anthropic catalog.
    const fetchedModels = await fetchInferenceProfileModels({
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: parsed.data.apiKey,
    });
    if (fetchedModels.length > 0) {
      const withModels = await setInferenceProfileModels(
        authResult.userId,
        profile.id,
        fetchedModels,
      );
      return Response.json({ profile: withModels ?? profile }, { status: 201 });
    }
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return jsonError(
      getProfileErrorMessage(error),
      isDuplicateNameError(error) ? 409 : 400,
    );
  }
}

/** @deprecated Use PATCH /api/inference-profiles/[profileId]. Kept for existing callers. */
export async function PATCH(req: Request) {
  return await handleUpdateInferenceProfile(req);
}

/** @deprecated Use DELETE /api/inference-profiles/[profileId]. Kept for existing callers. */
export async function DELETE(req: Request) {
  return await handleDeleteInferenceProfile(req);
}
