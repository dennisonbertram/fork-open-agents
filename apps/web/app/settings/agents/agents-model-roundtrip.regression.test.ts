/**
 * Regression tests for #1157 (Settings -> Agents editor round-trip):
 *
 * GET /api/settings/agents returns a profile-bound role's model as a bare
 * `modelId` plus a separate `inferenceProfileId`. `AgentRosterRow` (built by
 * `buildAgentRoster`) dropped `inferenceProfileId`, so `AgentEditor` had no
 * way to know a role's model came from an inference profile and always
 * initialized its Model <Select> from the bare id. Any Save from that state
 * -- even one that never touched the Model field -- sent the bare id through
 * `splitAgentPatchModel`, which parses it as a plain gateway id and writes
 * `inferenceProfileId: null`, silently dropping the role's own-key routing.
 *
 * Fix: `AgentRosterRow` now carries `inferenceProfileId`, and the editor
 * recomposes the exact "user-profile:<profileId>:<modelId>" composite the
 * picker already renders for that option (via the same
 * `getModelOptionSelectionId` helper `buildModelOptions` uses to build the
 * picker's own option ids) as its initial Model value. Chosen over having
 * the mapper accept a separate explicit `inferenceProfileId` field because
 * it requires zero changes to the write path (`splitAgentPatchModel` already
 * splits composites correctly -- see BT-M-014a) and keeps a single source of
 * truth (the composite id) for "which model + which profile" instead of two
 * fields that could disagree.
 *
 * BT-RT-001/002 prove the data plumbing (buildAgentRoster ->
 * AgentRosterRow.inferenceProfileId). BT-RT-003 proves the actual failure
 * mode end to end: recompose the editor's initial value, save it UNCHANGED,
 * and assert inferenceProfileId survives. BT-RT-004 is a source-content
 * tripwire (same pattern as REG-WI1-006 in
 * agents-section-inherit-select.regression.test.tsx) so the component
 * wiring itself -- not just the pure functions -- can't silently regress.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgentRoster } from "./agents-roster";
import { agentPatchSchema, splitAgentPatchModel } from "@/app/api/settings/agents/agents-api-mapper";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

const basePrefs = {
  defaultModelId: "anthropic/claude-opus-4-5",
  defaultSubagentModelId: null as string | null,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

const noComposioDefaults: ComposioAgentDefaults = {
  main: { defaultProfileId: null, allowChatOverride: true },
  explorer: { defaultProfileId: null, allowChatOverride: false },
  executor: { defaultProfileId: null, allowChatOverride: false },
  design: { defaultProfileId: null, allowChatOverride: false },
};

const runtimeProfiles: ManagedRuntimeProfile[] = [];

describe("buildAgentRoster threads inferenceProfileId (#1157)", () => {
  test("BT-RT-001: a profile-bound user_default row's inferenceProfileId flows onto the matching roster row", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "executor",
          modelId: "anthropic/claude-opus-4",
          inferenceProfileId: "profile-abc",
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    const executorRow = rows.find((r) => r.key === "executor");
    expect(executorRow?.model).toBe("anthropic/claude-opus-4");
    expect(executorRow?.inferenceProfileId).toBe("profile-abc");
  });

  test("BT-RT-002: a role with no inference profile carries a null inferenceProfileId", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "executor",
          modelId: "openai/gpt-4o",
          inferenceProfileId: null,
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    });

    expect(rows.find((r) => r.key === "executor")?.inferenceProfileId).toBeNull();
  });
});

describe("Settings -> Agents editor round-trip: GET -> editor -> PATCH (#1157)", () => {
  test("BT-RT-003: saving a profile-bound role WITHOUT touching the model field must NOT null out inferenceProfileId", () => {
    // 1. GET: a profile-bound row, as buildAgentRoster produces it today.
    const [row] = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "explorer",
          modelId: "anthropic/claude-opus-4",
          inferenceProfileId: "profile-abc",
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
        },
      ],
    }).filter((r) => r.key === "explorer");

    // 2. Editor: AgentEditor must initialize its Model <Select> state with
    // this exact composite -- the same helper buildModelOptions uses to
    // build the picker's own option ids -- so the picker shows the
    // profile-bound option selected AND an untouched Save round-trips it.
    const editorInitialModelId = getModelOptionSelectionId(
      row.model,
      row.inferenceProfileId,
    );
    expect(editorInitialModelId).toBe(
      "user-profile:profile-abc:anthropic/claude-opus-4",
    );

    // 3. Save WITHOUT touching the model field: AgentEditor sends
    // `modelId: modelId.trim() || null` verbatim.
    const patchInput = agentPatchSchema.parse({
      role: "explorer",
      modelId: editorInitialModelId.trim() || null,
    });
    const dbPatch = splitAgentPatchModel(patchInput);

    // The whole point: an unrelated-field-only save (simulated here as a
    // model-untouched save) must preserve the role's own-key routing, not
    // silently null it out.
    expect(dbPatch.inferenceProfileId).toBe("profile-abc");
    expect(dbPatch.modelId).toBe("anthropic/claude-opus-4");
  });

  test("BT-RT-004: agents-section.tsx composes the editor's initial Model value via getModelOptionSelectionId, not the bare row.model", () => {
    const source = readFileSync(
      join(import.meta.dir, "agents-section.tsx"),
      "utf8",
    );

    expect(source).toContain("getModelOptionSelectionId(row.model");
    // The bare `row.model ?? ""` initializer is the exact regression this
    // guards against -- it must not remain the Model <Select>'s seed.
    expect(source).not.toContain('useState<string>(row.model ?? "")');
  });
});
