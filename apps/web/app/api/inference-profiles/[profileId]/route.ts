import {
  handleDeleteInferenceProfile,
  handleGetInferenceProfile,
  handleUpdateInferenceProfile,
} from "../_lib/profile-handlers";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { profileId } = await context.params;
  return await handleGetInferenceProfile(profileId);
}

export async function PATCH(req: Request, context: RouteContext) {
  const { profileId } = await context.params;
  return await handleUpdateInferenceProfile(req, profileId);
}

export async function DELETE(req: Request, context: RouteContext) {
  const { profileId } = await context.params;
  return await handleDeleteInferenceProfile(req, profileId);
}
