import { getServerSession } from "@/lib/session/get-server-session";
import { isKnownManagedRuntimeProfileReference } from "@/lib/db/managed-runtime-saved-profiles";
import {
  getUserPreferences,
  type DiffMode,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import {
  globalSkillRefsSchema,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";
import {
  modelSystemPromptsSchema,
  type ModelSystemPrompts,
} from "@/lib/model-system-prompts";

interface UpdatePreferencesRequest {
  defaultModelId?: string;
  defaultSubagentModelId?: string | null;
  defaultInferenceProfileId?: string | null;
  defaultSandboxType?: SandboxType;
  defaultManagedRuntimeProfileId?: string;
  defaultDiffMode?: DiffMode;
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  alertsEnabled?: boolean;
  alertSoundEnabled?: boolean;
  publicUsageEnabled?: boolean;
  globalSkillRefs?: GlobalSkillRef[];
  enabledModelIds?: string[];
  modelSystemPrompts?: ModelSystemPrompts;
}

export async function GET(_req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const preferences = await getUserPreferences(session.user.id);
  return Response.json({ preferences });
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: UpdatePreferencesRequest;
  try {
    body = (await req.json()) as UpdatePreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: UpdatePreferencesRequest = {};

  if (body.defaultSandboxType !== undefined) {
    const validTypes = ["vercel"];
    if (
      typeof body.defaultSandboxType !== "string" ||
      !validTypes.includes(body.defaultSandboxType)
    ) {
      return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
    }
    updates.defaultSandboxType = body.defaultSandboxType;
  }

  if (body.defaultManagedRuntimeProfileId !== undefined) {
    // Preferences are account-level (no session context), so the
    // session-scope arm of isKnownManagedRuntimeProfileReference's OR clause
    // is a no-op here — only the built-in and owned user_default arms apply.
    const isKnown = await isKnownManagedRuntimeProfileReference({
      userId: session.user.id,
      sessionId: "__preferences__",
      profileId: body.defaultManagedRuntimeProfileId,
    });
    if (!isKnown) {
      return Response.json(
        {
          error: "Invalid managed runtime profile",
          errorKind: "profile_not_found",
          nextAction:
            "This profile no longer exists. Choose another profile or recreate it.",
        },
        { status: 400 },
      );
    }
    updates.defaultManagedRuntimeProfileId =
      body.defaultManagedRuntimeProfileId;
  }

  if (body.defaultDiffMode !== undefined) {
    const validDiffModes = ["unified", "split"];
    if (
      typeof body.defaultDiffMode !== "string" ||
      !validDiffModes.includes(body.defaultDiffMode)
    ) {
      return Response.json({ error: "Invalid diff mode" }, { status: 400 });
    }
    updates.defaultDiffMode = body.defaultDiffMode;
  }

  if (body.defaultModelId !== undefined) {
    if (typeof body.defaultModelId !== "string") {
      return Response.json(
        { error: "Invalid defaultModelId" },
        { status: 400 },
      );
    }
    updates.defaultModelId = body.defaultModelId;
  }

  if (body.defaultSubagentModelId !== undefined) {
    if (
      body.defaultSubagentModelId !== null &&
      typeof body.defaultSubagentModelId !== "string"
    ) {
      return Response.json(
        { error: "Invalid defaultSubagentModelId" },
        { status: 400 },
      );
    }
    updates.defaultSubagentModelId = body.defaultSubagentModelId;
  }

  if (body.defaultInferenceProfileId !== undefined) {
    if (
      body.defaultInferenceProfileId !== null &&
      typeof body.defaultInferenceProfileId !== "string"
    ) {
      return Response.json(
        { error: "Invalid defaultInferenceProfileId" },
        { status: 400 },
      );
    }
    updates.defaultInferenceProfileId = body.defaultInferenceProfileId;
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }
  if (body.autoCommitPush !== undefined) {
    updates.autoCommitPush = body.autoCommitPush;
  }

  if (
    body.autoCreatePr !== undefined &&
    typeof body.autoCreatePr !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCreatePr value" },
      { status: 400 },
    );
  }
  if (body.autoCreatePr !== undefined) {
    updates.autoCreatePr = body.autoCreatePr;
  }

  if (
    body.alertsEnabled !== undefined &&
    typeof body.alertsEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid alertsEnabled value" },
      { status: 400 },
    );
  }
  if (body.alertsEnabled !== undefined) {
    updates.alertsEnabled = body.alertsEnabled;
  }

  if (
    body.alertSoundEnabled !== undefined &&
    typeof body.alertSoundEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid alertSoundEnabled value" },
      { status: 400 },
    );
  }
  if (body.alertSoundEnabled !== undefined) {
    updates.alertSoundEnabled = body.alertSoundEnabled;
  }

  if (
    body.publicUsageEnabled !== undefined &&
    typeof body.publicUsageEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid publicUsageEnabled value" },
      { status: 400 },
    );
  }
  if (body.publicUsageEnabled !== undefined) {
    updates.publicUsageEnabled = body.publicUsageEnabled;
  }

  if (body.globalSkillRefs !== undefined) {
    const parsedGlobalSkillRefs = globalSkillRefsSchema.safeParse(
      body.globalSkillRefs,
    );
    if (!parsedGlobalSkillRefs.success) {
      return Response.json(
        { error: "Invalid globalSkillRefs value" },
        { status: 400 },
      );
    }
    updates.globalSkillRefs = parsedGlobalSkillRefs.data;
  }

  if (body.enabledModelIds !== undefined) {
    if (
      !Array.isArray(body.enabledModelIds) ||
      !body.enabledModelIds.every((id) => typeof id === "string")
    ) {
      return Response.json(
        { error: "Invalid enabledModelIds value" },
        { status: 400 },
      );
    }
    updates.enabledModelIds = body.enabledModelIds;
  }

  if (body.modelSystemPrompts !== undefined) {
    const parsedModelSystemPrompts = modelSystemPromptsSchema.safeParse(
      body.modelSystemPrompts,
    );
    if (!parsedModelSystemPrompts.success) {
      return Response.json(
        { error: "Invalid modelSystemPrompts value" },
        { status: 400 },
      );
    }
    updates.modelSystemPrompts = parsedModelSystemPrompts.data;
  }

  try {
    const preferences = await updateUserPreferences(session.user.id, updates);
    return Response.json({ preferences });
  } catch (error) {
    console.error("Failed to update preferences:", error);
    return Response.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
