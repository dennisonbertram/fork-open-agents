import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DEFAULT_MANAGED_RUNTIME_PROFILE_ID } from "@open-agents/sandbox/managed-runtime-profiles";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { splitModelSelection } from "@/lib/inference/model-option-id";
import { modelVariantsSchema, type ModelVariant } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import {
  normalizeModelSystemPrompts,
  type ModelSystemPrompts,
} from "@/lib/model-system-prompts";
import {
  normalizeGlobalSkillRefs,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";
import {
  type ComposioAgentDefaults,
  defaultComposioAgentDefaults,
  normalizeComposioAgentDefaults,
} from "@/lib/composio/types";
import { db } from "./client";
import { userPreferences, type UserPreferences } from "./schema";

export type DiffMode = "unified" | "split";

export interface UserPreferencesData {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  defaultInferenceProfileId: string | null;
  defaultSandboxType: SandboxType;
  defaultManagedRuntimeProfileId: string;
  defaultDiffMode: DiffMode;
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  alertsEnabled: boolean;
  alertSoundEnabled: boolean;
  publicUsageEnabled: boolean;
  globalSkillRefs: GlobalSkillRef[];
  modelVariants: ModelVariant[];
  enabledModelIds: string[];
  modelSystemPrompts: ModelSystemPrompts;
  composioAgentDefaults: ComposioAgentDefaults;
}

const DEFAULT_PREFERENCES: UserPreferencesData = {
  defaultModelId: APP_DEFAULT_MODEL_ID,
  defaultSubagentModelId: null,
  defaultInferenceProfileId: null,
  defaultSandboxType: "vercel",
  defaultManagedRuntimeProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
  defaultDiffMode: "unified",
  autoCommitPush: false,
  autoCreatePr: false,
  alertsEnabled: true,
  alertSoundEnabled: true,
  publicUsageEnabled: false,
  globalSkillRefs: [],
  modelVariants: [],
  enabledModelIds: [],
  modelSystemPrompts: {},
  composioAgentDefaults: defaultComposioAgentDefaults,
};

const VALID_SANDBOX_TYPES: SandboxType[] = ["vercel"];
const VALID_DIFF_MODES: DiffMode[] = ["unified", "split"];

function normalizeSandboxType(value: unknown): SandboxType {
  if (value === "hybrid") {
    return "vercel";
  }

  if (
    typeof value === "string" &&
    VALID_SANDBOX_TYPES.includes(value as SandboxType)
  ) {
    return value as SandboxType;
  }

  return DEFAULT_PREFERENCES.defaultSandboxType;
}

function normalizeDiffMode(value: unknown): DiffMode {
  if (
    typeof value === "string" &&
    VALID_DIFF_MODES.includes(value as DiffMode)
  ) {
    return value as DiffMode;
  }

  return DEFAULT_PREFERENCES.defaultDiffMode;
}

function normalizeEnabledModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function toUserPreferencesData(
  row?: Partial<
    Pick<
      UserPreferences,
      | "defaultModelId"
      | "defaultSubagentModelId"
      | "defaultInferenceProfileId"
      | "defaultSandboxType"
      | "defaultManagedRuntimeProfileId"
      | "defaultDiffMode"
      | "autoCommitPush"
      | "autoCreatePr"
      | "alertsEnabled"
      | "alertSoundEnabled"
      | "publicUsageEnabled"
      | "globalSkillRefs"
      | "modelVariants"
      | "enabledModelIds"
      | "modelSystemPrompts"
      | "composioAgentDefaults"
    >
  >,
): UserPreferencesData {
  const parsedModelVariants = modelVariantsSchema.safeParse(
    row?.modelVariants ?? [],
  );

  return {
    defaultModelId: row?.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
    defaultSubagentModelId: row?.defaultSubagentModelId ?? null,
    defaultInferenceProfileId: row?.defaultInferenceProfileId ?? null,
    defaultSandboxType: normalizeSandboxType(row?.defaultSandboxType),
    // Preserve the stored id verbatim — do NOT coerce a non-built-in
    // (user_default) id to the built-in default here. Write-path validation
    // (isKnownManagedRuntimeProfileReference) and resolution-time typed
    // failures enforce validity; the delete lifecycle resets dangling refs.
    defaultManagedRuntimeProfileId:
      row?.defaultManagedRuntimeProfileId ??
      DEFAULT_PREFERENCES.defaultManagedRuntimeProfileId,
    defaultDiffMode: normalizeDiffMode(row?.defaultDiffMode),
    autoCommitPush: row?.autoCommitPush ?? DEFAULT_PREFERENCES.autoCommitPush,
    autoCreatePr: row?.autoCreatePr ?? DEFAULT_PREFERENCES.autoCreatePr,
    alertsEnabled: row?.alertsEnabled ?? DEFAULT_PREFERENCES.alertsEnabled,
    alertSoundEnabled:
      row?.alertSoundEnabled ?? DEFAULT_PREFERENCES.alertSoundEnabled,
    publicUsageEnabled:
      row?.publicUsageEnabled ?? DEFAULT_PREFERENCES.publicUsageEnabled,
    globalSkillRefs: normalizeGlobalSkillRefs(row?.globalSkillRefs),
    modelVariants: parsedModelVariants.success ? parsedModelVariants.data : [],
    enabledModelIds: normalizeEnabledModelIds(row?.enabledModelIds),
    modelSystemPrompts: normalizeModelSystemPrompts(row?.modelSystemPrompts),
    composioAgentDefaults: normalizeComposioAgentDefaults(
      row?.composioAgentDefaults,
    ),
  };
}

/**
 * Get user preferences, creating default preferences if none exist
 */
export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesData> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return toUserPreferencesData(existing);
}

/**
 * Split a composite model option id across the two stored columns (#1123).
 *
 * The model pickers emit "user-profile:<inferenceProfileId>:<modelId>" for
 * models served by a user inference profile. Persisting that string whole into
 * `defaultModelId` left `defaultInferenceProfileId` NULL, so every chat created
 * from the preference handed an internal identifier to the AI Gateway. Split it
 * here — the single write funnel for both columns — exactly the way the chat
 * model-switch handler does. An explicitly supplied profile id still wins.
 */
function splitDefaultModelSelection(
  updates: Partial<UserPreferencesData>,
): Partial<UserPreferencesData> {
  if (updates.defaultModelId === undefined) {
    return updates;
  }

  const split = splitModelSelection(
    updates.defaultModelId,
    updates.defaultInferenceProfileId,
  );
  return {
    ...updates,
    defaultModelId: split.modelId,
    defaultInferenceProfileId: split.inferenceProfileId,
  };
}

/**
 * Update user preferences, creating if they don't exist
 */
export async function updateUserPreferences(
  userId: string,
  rawUpdates: Partial<UserPreferencesData>,
): Promise<UserPreferencesData> {
  const updates = splitDefaultModelSelection(rawUpdates);
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(userPreferences)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, userId))
      .returning();

    return toUserPreferencesData(updated);
  }

  // Create new preferences
  const [created] = await db
    .insert(userPreferences)
    .values({
      id: nanoid(),
      userId,
      defaultModelId:
        updates.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
      defaultSubagentModelId: updates.defaultSubagentModelId ?? null,
      defaultInferenceProfileId: updates.defaultInferenceProfileId ?? null,
      defaultSandboxType:
        updates.defaultSandboxType ?? DEFAULT_PREFERENCES.defaultSandboxType,
      defaultManagedRuntimeProfileId:
        updates.defaultManagedRuntimeProfileId ??
        DEFAULT_PREFERENCES.defaultManagedRuntimeProfileId,
      defaultDiffMode:
        updates.defaultDiffMode ?? DEFAULT_PREFERENCES.defaultDiffMode,
      autoCommitPush:
        updates.autoCommitPush ?? DEFAULT_PREFERENCES.autoCommitPush,
      autoCreatePr: updates.autoCreatePr ?? DEFAULT_PREFERENCES.autoCreatePr,
      alertsEnabled: updates.alertsEnabled ?? DEFAULT_PREFERENCES.alertsEnabled,
      alertSoundEnabled:
        updates.alertSoundEnabled ?? DEFAULT_PREFERENCES.alertSoundEnabled,
      publicUsageEnabled:
        updates.publicUsageEnabled ?? DEFAULT_PREFERENCES.publicUsageEnabled,
      globalSkillRefs:
        updates.globalSkillRefs ?? DEFAULT_PREFERENCES.globalSkillRefs,
      modelVariants: updates.modelVariants ?? DEFAULT_PREFERENCES.modelVariants,
      enabledModelIds:
        updates.enabledModelIds ?? DEFAULT_PREFERENCES.enabledModelIds,
      modelSystemPrompts:
        updates.modelSystemPrompts ?? DEFAULT_PREFERENCES.modelSystemPrompts,
      composioAgentDefaults:
        updates.composioAgentDefaults ??
        DEFAULT_PREFERENCES.composioAgentDefaults,
    })
    .returning();

  return toUserPreferencesData(created);
}
