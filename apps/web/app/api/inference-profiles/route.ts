import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  createInferenceProfile,
  deleteInferenceProfile,
  listInferenceProfiles,
  setInferenceProfileModels,
  updateInferenceProfile,
} from "@/lib/db/inference-profiles";
import { fetchInferenceProfileModels } from "@/lib/inference/fetch-profile-models";
import {
  createInferenceProfileInputSchema,
  deleteInferenceProfileInputSchema,
  updateInferenceProfileInputSchema,
} from "@/lib/inference/types";

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function getProfileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/unique|duplicate/i.test(message)) {
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
    return jsonError(getProfileErrorMessage(error), 400);
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
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = updateInferenceProfileInputSchema.safeParse(body);
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
    return jsonError(getProfileErrorMessage(error), 400);
  }
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
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = deleteInferenceProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid inference profile id", 400);
  }

  const deleted = await deleteInferenceProfile(
    authResult.userId,
    parsed.data.profileId,
  );
  if (!deleted) {
    return jsonError("Inference profile not found", 404);
  }

  return Response.json({ success: true });
}
