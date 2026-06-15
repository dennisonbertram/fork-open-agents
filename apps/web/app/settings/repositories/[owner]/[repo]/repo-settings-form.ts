/**
 * Pure helpers + Zod schema shared by the client RepoSettingsSection and the
 * PATCH API route. No DB or React imports — fully unit-testable.
 *
 * Mirrors the pattern in background-agents-form.ts / preferences-helpers.ts.
 */
import { z } from "zod";

// ── Edit state ─────────────────────────────────────────────────────────────────

/**
 * Local edit state for the repo settings form.
 * null = "cleared to inherit" (will send null in PATCH to clear the override).
 */
export interface RepoEditState {
  fullClone: boolean | null;
  prewarmEnabled: boolean | null;
  runtimeMode: "classic" | "managed_runtime" | null;
  managedRuntimeProfileId: string | null;
  vcpus: number | null;
  autoCommitPush: boolean | null;
  autoCreatePr: boolean | null;
  defaultBranch: string | null;
  isNewBranch: boolean | null;
}

// ── vCPU options ───────────────────────────────────────────────────────────────

/**
 * The allowed vCPU values for sandbox allocation.
 * Matches the values exposed in the Vercel sandbox resource tiers.
 */
export const VCPU_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "1 vCPU" },
  { value: 2, label: "2 vCPUs" },
  { value: 4, label: "4 vCPUs" },
  { value: 8, label: "8 vCPUs" },
];

/** Set of valid vCPU values for validation. */
export const ALLOWED_VCPU_VALUES = new Set(VCPU_OPTIONS.map((o) => o.value));

// ── Runtime mode options ───────────────────────────────────────────────────────

export const RUNTIME_MODE_OPTIONS: Array<{
  value: "classic" | "managed_runtime";
  label: string;
}> = [
  { value: "classic", label: "Classic" },
  { value: "managed_runtime", label: "Managed runtime" },
];

// ── Zod schema ─────────────────────────────────────────────────────────────────

/**
 * Zod schema for the PATCH request body.
 * Every field is optional (absent = leave unchanged).
 * null = clear the override back to inherit.
 */
export const repoSettingsPatchSchema = z.object({
  fullClone: z.boolean().nullable().optional(),
  prewarmEnabled: z.boolean().nullable().optional(),
  runtimeMode: z
    .enum(["classic", "managed_runtime"])
    .nullable()
    .optional(),
  managedRuntimeProfileId: z.string().min(1).nullable().optional(),
  vcpus: z.number().int().positive().nullable().optional(),
  autoCommitPush: z.boolean().nullable().optional(),
  autoCreatePr: z.boolean().nullable().optional(),
  defaultBranch: z.string().min(1).nullable().optional(),
  isNewBranch: z.boolean().nullable().optional(),
});

export type RepoSettingsPatch = z.infer<typeof repoSettingsPatchSchema>;

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Build a PATCH body from the current edit state vs the base state.
 * - Only fields that differ from base are included.
 * - null = clear this field to inherit.
 * - Unchanged fields are omitted (undefined/absent).
 */
export function buildPatchBody(
  state: RepoEditState,
  base: RepoEditState,
): Partial<RepoEditState> {
  const patch: Partial<RepoEditState> = {};

  const keys = Object.keys(state) as Array<keyof RepoEditState>;
  for (const key of keys) {
    if (state[key] !== base[key]) {
      // Type-cast because we know the key exists in both
      (patch as Record<string, unknown>)[key] = state[key];
    }
  }

  return patch;
}

/**
 * Returns true when any field in state differs from the corresponding field in base.
 */
export function computeDirty(state: RepoEditState, base: RepoEditState): boolean {
  const keys = Object.keys(state) as Array<keyof RepoEditState>;
  return keys.some((key) => state[key] !== base[key]);
}
