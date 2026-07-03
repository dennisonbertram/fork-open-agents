import { z } from "zod";

export const COMPOSIO_AGENT_KEYS = [
  "main",
  "explorer",
  "executor",
  "design",
] as const;

export type ComposioAgentKey = (typeof COMPOSIO_AGENT_KEYS)[number];

export type ComposioAgentDefaults = Record<
  ComposioAgentKey,
  {
    defaultProfileId: string | null;
    allowChatOverride: boolean;
  }
>;

export type ChatComposioSelection = {
  mainProfileId: string | null;
  agentProfileOverrides?: Partial<Record<ComposioAgentKey, string | null>>;
  /** When non-empty, bypasses profile resolution entirely (one-wins). */
  directToolkitSlugs?: string[];
};

export type RepositoryComposioSettingsValues = {
  inheritGlobalDefaults: boolean;
  allowedProfileIds: string[];
  blockedToolkitSlugs: string[];
  agentDefaults: Partial<ComposioAgentDefaults>;
  /**
   * Active Composio toolkits for this repo (subset of globally-connected
   * toolkits), applied to every chat on the repo. NULL = never configured
   * (GitHub default-on applies at resolution); an array = explicit choice.
   */
  selectedToolkitSlugs: string[] | null;
};

export type ComposioToolProfileValues = {
  name: string;
  toolkitSlugs: string[];
  authConfigIdsByToolkit: Record<string, string | null>;
  connectedAccountIdsByToolkit: Record<string, string[]>;
  workbenchEnabled: boolean;
  allowInChatConnectionManagement: boolean;
};

export type ComposioToolProfileSummary = ComposioToolProfileValues & {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

export const defaultComposioAgentDefaults: ComposioAgentDefaults = {
  main: {
    defaultProfileId: null,
    allowChatOverride: true,
  },
  explorer: {
    defaultProfileId: null,
    allowChatOverride: false,
  },
  executor: {
    defaultProfileId: null,
    allowChatOverride: false,
  },
  design: {
    defaultProfileId: null,
    allowChatOverride: false,
  },
};

export const defaultChatComposioSelection: ChatComposioSelection = {
  mainProfileId: null,
};

const rawStringRecordSchema = z.record(z.string(), z.unknown());

export const composioToolProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  toolkitSlugs: z.array(z.string()).default([]),
  authConfigIdsByToolkit: rawStringRecordSchema.default({}),
  connectedAccountIdsByToolkit: rawStringRecordSchema.default({}),
  workbenchEnabled: z.boolean().default(false),
  allowInChatConnectionManagement: z.boolean().default(false),
});

export const composioToolProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    toolkitSlugs: z.array(z.string()).optional(),
    authConfigIdsByToolkit: rawStringRecordSchema.optional(),
    connectedAccountIdsByToolkit: rawStringRecordSchema.optional(),
    workbenchEnabled: z.boolean().optional(),
    allowInChatConnectionManagement: z.boolean().optional(),
  })
  .strict();

const composioAgentDefaultInputSchema = z.object({
  defaultProfileId: z.string().min(1).nullable().default(null),
  allowChatOverride: z.boolean().default(false),
});

export const composioAgentDefaultsInputSchema = z
  .object({
    main: composioAgentDefaultInputSchema.optional(),
    explorer: composioAgentDefaultInputSchema.optional(),
    executor: composioAgentDefaultInputSchema.optional(),
    design: composioAgentDefaultInputSchema.optional(),
  })
  .strict();

const composioAgentProfileOverridesInputSchema = z
  .object({
    main: z.string().min(1).nullable().optional(),
    explorer: z.string().min(1).nullable().optional(),
    executor: z.string().min(1).nullable().optional(),
    design: z.string().min(1).nullable().optional(),
  })
  .strict();

export const chatComposioSelectionInputSchema = z
  .object({
    mainProfileId: z.string().min(1).nullable().default(null),
    agentProfileOverrides: composioAgentProfileOverridesInputSchema.optional(),
    directToolkitSlugs: z.array(z.string()).optional(),
  })
  .strict();

export const repositoryComposioSettingsInputSchema = z
  .object({
    inheritGlobalDefaults: z.boolean().default(true),
    allowedProfileIds: z.array(z.string().trim().min(1)).default([]),
    blockedToolkitSlugs: z.array(z.string()).default([]),
    agentDefaults: composioAgentDefaultsInputSchema.partial().default({}),
    // null = never configured (GitHub default-on); array = explicit choice.
    selectedToolkitSlugs: z.array(z.string()).nullable().default(null),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeComposioToolkitSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeComposioToolkitSlugs(values: string[]): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const slug = normalizeComposioToolkitSlug(value);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }

  return slugs;
}

function normalizeAuthConfigMap(
  value: Record<string, unknown> | undefined,
  allowedToolkits: Set<string>,
): Record<string, string | null> {
  const next: Record<string, string | null> = {};

  for (const [rawToolkit, rawAuthConfigId] of Object.entries(value ?? {})) {
    const toolkit = normalizeComposioToolkitSlug(rawToolkit);
    if (!toolkit || !allowedToolkits.has(toolkit)) {
      continue;
    }

    if (rawAuthConfigId === null) {
      next[toolkit] = null;
      continue;
    }

    if (typeof rawAuthConfigId !== "string") {
      continue;
    }

    const authConfigId = rawAuthConfigId.trim();
    if (authConfigId.length > 0) {
      next[toolkit] = authConfigId;
    }
  }

  return next;
}

function normalizeConnectedAccountMap(
  value: Record<string, unknown> | undefined,
  allowedToolkits: Set<string>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};

  for (const [rawToolkit, rawConnectedAccountIds] of Object.entries(
    value ?? {},
  )) {
    const toolkit = normalizeComposioToolkitSlug(rawToolkit);
    if (!toolkit || !allowedToolkits.has(toolkit)) {
      continue;
    }

    const ids = Array.isArray(rawConnectedAccountIds)
      ? rawConnectedAccountIds
      : typeof rawConnectedAccountIds === "string"
        ? rawConnectedAccountIds.split(",")
        : [];
    const normalizedIds = ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (normalizedIds.length > 0) {
      next[toolkit] = Array.from(new Set(normalizedIds));
    }
  }

  return next;
}

export function normalizeComposioToolProfileValues(
  input: unknown,
): ComposioToolProfileValues {
  const parsed = composioToolProfileInputSchema.parse(input);
  const toolkitSlugs = normalizeComposioToolkitSlugs(parsed.toolkitSlugs);

  if (toolkitSlugs.length === 0) {
    throw new Error("At least one toolkit slug is required");
  }

  const allowedToolkits = new Set(toolkitSlugs);

  return {
    name: parsed.name,
    toolkitSlugs,
    authConfigIdsByToolkit: normalizeAuthConfigMap(
      parsed.authConfigIdsByToolkit,
      allowedToolkits,
    ),
    connectedAccountIdsByToolkit: normalizeConnectedAccountMap(
      parsed.connectedAccountIdsByToolkit,
      allowedToolkits,
    ),
    workbenchEnabled: parsed.workbenchEnabled,
    allowInChatConnectionManagement: parsed.allowInChatConnectionManagement,
  };
}

export function normalizeComposioToolProfilePatch(
  current: ComposioToolProfileValues,
  patch: unknown,
): ComposioToolProfileValues {
  const parsed = composioToolProfilePatchSchema.parse(patch);
  return normalizeComposioToolProfileValues({
    ...current,
    ...parsed,
    authConfigIdsByToolkit:
      parsed.authConfigIdsByToolkit ?? current.authConfigIdsByToolkit,
    connectedAccountIdsByToolkit:
      parsed.connectedAccountIdsByToolkit ??
      current.connectedAccountIdsByToolkit,
  });
}

export function normalizeComposioAgentDefaults(
  value: unknown,
): ComposioAgentDefaults {
  const parsed = composioAgentDefaultsInputSchema.safeParse(value);
  const input = parsed.success ? parsed.data : {};

  return COMPOSIO_AGENT_KEYS.reduce<ComposioAgentDefaults>(
    (defaults, key) => ({
      ...defaults,
      [key]: {
        defaultProfileId:
          input[key]?.defaultProfileId ??
          defaultComposioAgentDefaults[key].defaultProfileId,
        allowChatOverride:
          input[key]?.allowChatOverride ??
          defaultComposioAgentDefaults[key].allowChatOverride,
      },
    }),
    { ...defaultComposioAgentDefaults },
  );
}

export function normalizeChatComposioSelection(
  value: unknown,
): ChatComposioSelection {
  const parsed = chatComposioSelectionInputSchema.safeParse(value);
  if (!parsed.success) {
    return defaultChatComposioSelection;
  }

  const overrides = isRecord(parsed.data.agentProfileOverrides)
    ? parsed.data.agentProfileOverrides
    : undefined;

  // One-wins rule: normalize the direct list; if non-empty it wins over the profile.
  const directSlugs = normalizeComposioToolkitSlugs(
    parsed.data.directToolkitSlugs ?? [],
  );

  if (directSlugs.length > 0) {
    return {
      mainProfileId: null,
      ...(overrides ? { agentProfileOverrides: overrides } : {}),
      directToolkitSlugs: directSlugs,
    };
  }

  const mainProfileId = parsed.data.mainProfileId ?? null;

  // Explicit "off" sentinel (#799, finding G1): the caller sent a non-null,
  // empty directToolkitSlugs array with no profile fallback target
  // (mainProfileId null). This is the compact selector's "Off" click
  // (mainProfileId: null, directToolkitSlugs: []) and must survive
  // normalization distinctly from "directToolkitSlugs never provided at
  // all" — otherwise resolveComposioSlugsForChatMain can never see the
  // difference and the explicit off is silently re-enabled by agent-row/repo
  // defaults downstream.
  //
  // When mainProfileId IS set, an empty directToolkitSlugs array is treated
  // as "no override" and the profile is retained (existing behavior,
  // BT-S0-005) — a saved profile selection is not itself an "off" signal.
  const hasExplicitEmptyDirectSlugs =
    Array.isArray(parsed.data.directToolkitSlugs) &&
    parsed.data.directToolkitSlugs.length === 0 &&
    directSlugs.length === 0;

  if (hasExplicitEmptyDirectSlugs && mainProfileId === null) {
    return {
      mainProfileId: null,
      ...(overrides ? { agentProfileOverrides: overrides } : {}),
      directToolkitSlugs: [],
    };
  }

  return {
    mainProfileId,
    ...(overrides ? { agentProfileOverrides: overrides } : {}),
  };
}

export function normalizeRepositoryComposioSettings(
  value: unknown,
): RepositoryComposioSettingsValues {
  const parsed = repositoryComposioSettingsInputSchema.parse(value);

  return {
    inheritGlobalDefaults: parsed.inheritGlobalDefaults,
    allowedProfileIds: Array.from(new Set(parsed.allowedProfileIds)),
    blockedToolkitSlugs: normalizeComposioToolkitSlugs(
      parsed.blockedToolkitSlugs,
    ),
    agentDefaults: parsed.agentDefaults,
    // Preserve null (never configured) vs an explicit, normalized array.
    selectedToolkitSlugs:
      parsed.selectedToolkitSlugs === null
        ? null
        : normalizeComposioToolkitSlugs(parsed.selectedToolkitSlugs),
  };
}

export function getComposioProfileConfigHashInput(
  profile: ComposioToolProfileValues,
): Record<string, unknown> {
  return {
    toolkitSlugs: profile.toolkitSlugs,
    authConfigIdsByToolkit: profile.authConfigIdsByToolkit,
    connectedAccountIdsByToolkit: profile.connectedAccountIdsByToolkit,
    workbenchEnabled: profile.workbenchEnabled,
    allowInChatConnectionManagement: profile.allowInChatConnectionManagement,
  };
}
