import { describe, expect, test } from "bun:test";
import type { ModelVariant } from "@/lib/model-variants";
import {
  RECOMMENDED_MODEL_IDS,
  buildModelOptions,
  buildRecommendedModelOptions,
  filterAndSortModelOptions,
  getDefaultModelOptionId,
  groupByProvider,
  withMissingModelOption,
} from "./model-options";
import type { AvailableModel } from "./models";

function createModel(input: {
  id: string;
  name?: string;
  description?: string | null;
  contextWindow?: number;
}): AvailableModel {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    context_window: input.contextWindow,
    modelType: "language",
  } as unknown as AvailableModel;
}

describe("model options", () => {
  test("buildModelOptions includes base models and variants", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "openai/gpt-5",
        name: "GPT-5",
        description: "Base model",
        contextWindow: 400_000,
      }),
    ];

    const variants: ModelVariant[] = [
      {
        id: "variant:gpt-5-medium",
        name: "GPT-5 Medium Reasoning",
        baseModelId: "openai/gpt-5",
        providerOptions: { reasoningEffort: "medium" },
      },
    ];

    const options = buildModelOptions(models, variants);

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      id: "openai/gpt-5",
      label: "GPT-5",
      shortLabel: "GPT-5",
      description: "Base model",
      isVariant: false,
      contextWindow: 400_000,
      provider: "openai",
      source: "catalog",
    });
    expect(options[1]).toMatchObject({
      id: "variant:gpt-5-medium",
      label: "GPT-5 Medium Reasoning",
      shortLabel: "GPT-5 Medium Reasoning",
      description: "Variant of GPT-5",
      isVariant: true,
      contextWindow: 400_000,
      provider: "openai",
      source: "catalog",
      baseModelId: "openai/gpt-5",
    });
  });

  test("buildModelOptions strips provider prefix for shortLabel", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
      }),
    ];

    const options = buildModelOptions(models, []);

    expect(options[0].shortLabel).toBe("Opus 4.6");
    expect(options[0].label).toBe("Claude Opus 4.6");
  });

  test("buildModelOptions prepends user Anthropic profile options", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "anthropic/claude-opus-4.6",
        name: "Claude Opus 4.6",
        contextWindow: 200_000,
      }),
      createModel({ id: "openai/gpt-5", name: "GPT-5" }),
    ];

    const options = buildModelOptions(
      models,
      [],
      [
        {
          id: "profile-1",
          name: "Personal Anthropic",
          provider: "anthropic",
          baseUrl: "https://platformproxy.example.com/v1",
          keyLast4: "abcd",
          keyFingerprint: "fingerprint",
          status: "verified",
          lastTestedAt: null,
          lastTestMessage: null,
          enabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    );

    expect(options[0]).toMatchObject({
      id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
      label: "Claude Opus 4.6",
      shortLabel: "Opus 4.6",
      description: "Direct Anthropic via Personal Anthropic",
      isVariant: false,
      contextWindow: 200_000,
      provider: "user",
      source: "user",
      baseModelId: "anthropic/claude-opus-4.6",
      inferenceProfileId: "profile-1",
      secondaryLabel: "Personal Anthropic",
    });
    expect(options.map((option) => option.id)).toEqual([
      "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
      "anthropic/claude-opus-4.6",
      "openai/gpt-5",
    ]);
  });

  test("groupByProvider puts user, anthropic, and openai first, preserves insertion order", () => {
    const options = [
      {
        id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
        label: "Claude Opus 4.6",
        shortLabel: "Opus 4.6",
        isVariant: false,
        provider: "user",
      },
      {
        id: "google/gemini-2.5",
        label: "Gemini 2.5",
        shortLabel: "2.5",
        isVariant: false,
        provider: "google",
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
      {
        id: "variant:opus-custom",
        label: "Opus Custom",
        shortLabel: "Opus Custom",
        isVariant: true,
        provider: "anthropic",
      },
      {
        id: "anthropic/claude-opus-4.6",
        label: "Claude Opus 4.6",
        shortLabel: "Opus 4.6",
        isVariant: false,
        provider: "anthropic",
      },
    ];

    const groups = groupByProvider(options);

    expect(groups.map((g) => g.provider)).toEqual([
      "user",
      "anthropic",
      "openai",
      "google",
    ]);
    // Within anthropic: preserves original order (variant first, base second)
    expect(groups[1].options[0].id).toBe("variant:opus-custom");
    expect(groups[1].options[1].id).toBe("anthropic/claude-opus-4.6");
  });

  test("withMissingModelOption appends missing variant option", () => {
    const result = withMissingModelOption([], "variant:removed");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "variant:removed",
      label: "removed (missing)",
      shortLabel: "removed (missing)",
      description: "Variant no longer exists",
      isVariant: true,
      contextWindow: undefined,
      provider: "unknown",
    });
  });

  test("withMissingModelOption does not append non-variant ids", () => {
    const original = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(withMissingModelOption(original, "openai/unknown-model")).toBe(
      original,
    );
  });

  test("withMissingModelOption appends missing user profile option", () => {
    const result = withMissingModelOption(
      [],
      "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
    );

    expect(result).toEqual([
      {
        id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
        label: "anthropic/claude-opus-4.6 (missing profile)",
        shortLabel: "anthropic/claude-opus-4.6 (missing profile)",
        description: "Inference profile no longer exists",
        isVariant: false,
        contextWindow: undefined,
        provider: "user",
        source: "user",
        baseModelId: "anthropic/claude-opus-4.6",
        inferenceProfileId: "profile-1",
      },
    ]);
  });

  test("withMissingModelOption returns original list when id already exists", () => {
    const original = [
      {
        id: "variant:existing",
        label: "Existing Variant",
        shortLabel: "Existing Variant",
        isVariant: true,
        provider: "openai",
      },
    ];

    expect(withMissingModelOption(original, "variant:existing")).toBe(original);
  });

  test("getDefaultModelOptionId prefers repository default model when present", () => {
    const options = [
      {
        id: "openai/gpt-5.4",
        label: "GPT-5.4",
        shortLabel: "GPT-5.4",
        isVariant: false,
        provider: "anthropic",
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5.4");
  });

  test("getDefaultModelOptionId falls back to first option when default is missing", () => {
    const options = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        shortLabel: "GPT-5",
        isVariant: false,
        provider: "openai",
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5");
  });
});

describe("filterAndSortModelOptions", () => {
  const allOptions = [
    {
      id: "anthropic/claude-opus-4",
      label: "Claude Opus 4",
      shortLabel: "Opus 4",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "anthropic/claude-sonnet-4",
      label: "Claude Sonnet 4",
      shortLabel: "Sonnet 4",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "openai/gpt-5",
      label: "GPT-5",
      shortLabel: "GPT-5",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "openai/gpt-4.1",
      label: "GPT-4.1",
      shortLabel: "GPT-4.1",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "google/gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      shortLabel: "2.5 Pro",
      isVariant: false,
      provider: "google",
    },
    {
      id: "user-profile:profile-1:anthropic%2Fclaude-opus-4",
      label: "Claude Opus 4",
      shortLabel: "Opus 4",
      isVariant: false,
      provider: "user",
      secondaryLabel: "My Key",
    },
  ];

  // BT-001: provider filter restricts to that provider's models
  test("BT-001: filters by provider when providerFilter is set", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "anthropic",
      sort: "name",
      search: "",
    });
    expect(result.every((o) => o.provider === "anthropic")).toBe(true);
    expect(result).toHaveLength(2);
  });

  // BT-002: 'all' provider filter returns all options
  test("BT-002: providerFilter 'all' returns all options (unsorted beyond sort)", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "all",
      sort: "name",
      search: "",
    });
    expect(result).toHaveLength(allOptions.length);
  });

  // BT-003: sort by name A-Z
  test("BT-003: sorts options by name A-Z when sort=name", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "all",
      sort: "name",
      search: "",
    });
    const labels = result.map((o) => o.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });

  // BT-004: sort by provider groups providers alphabetically then by name within group
  test("BT-004: sorts options by provider then name when sort=provider", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "all",
      sort: "provider",
      search: "",
    });
    // Should be grouped: anthropic options come before google before openai before user
    // (priority providers: user, anthropic, openai come first; then alphabetical)
    const providers = result.map((o) => o.provider);
    // user is priority first, then anthropic, then openai, then google
    expect(providers.indexOf("user")).toBeLessThan(
      providers.indexOf("anthropic"),
    );
    expect(providers.indexOf("anthropic")).toBeLessThan(
      providers.indexOf("google"),
    );
  });

  // BT-005: search filter matches label case-insensitively
  test("BT-005: search filters by label case-insensitively", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "all",
      sort: "name",
      search: "opus",
    });
    expect(result.every((o) => o.label.toLowerCase().includes("opus"))).toBe(
      true,
    );
    expect(result.length).toBeGreaterThan(0);
  });

  // BT-006: empty search returns all (only filter/sort applies)
  test("BT-006: empty search string returns all options after provider filter", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "openai",
      sort: "name",
      search: "",
    });
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.provider === "openai")).toBe(true);
  });

  // BT-007: user provider filter works for user-key options
  test("BT-007: providerFilter=user returns only user-key models", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "user",
      sort: "name",
      search: "",
    });
    expect(result.every((o) => o.provider === "user")).toBe(true);
    expect(result).toHaveLength(1);
  });

  // BT-008: combined provider filter + search
  test("BT-008: applies both provider filter and search simultaneously", () => {
    const result = filterAndSortModelOptions(allOptions, {
      providerFilter: "anthropic",
      sort: "name",
      search: "sonnet",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("anthropic/claude-sonnet-4");
  });
});

describe("filterAndSortModelOptions — regression", () => {
  const options = [
    {
      id: "openai/gpt-5",
      label: "GPT-5",
      shortLabel: "GPT-5",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "anthropic/claude-opus-4",
      label: "Claude Opus 4",
      shortLabel: "Opus 4",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "google/gemini-2.5",
      label: "Gemini 2.5",
      shortLabel: "2.5",
      isVariant: false,
      provider: "google",
    },
  ];

  test("REG-001: does not mutate the original options array", () => {
    const original = [...options];
    filterAndSortModelOptions(options, {
      providerFilter: "all",
      sort: "name",
      search: "",
    });
    expect(options).toEqual(original);
  });

  test("REG-002: returns empty array (not null/undefined) when no models match", () => {
    const result = filterAndSortModelOptions(options, {
      providerFilter: "all",
      sort: "name",
      search: "zzz-no-match",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("REG-003: search is case-insensitive in both directions", () => {
    const upper = filterAndSortModelOptions(options, {
      providerFilter: "all",
      sort: "name",
      search: "GPT",
    });
    const lower = filterAndSortModelOptions(options, {
      providerFilter: "all",
      sort: "name",
      search: "gpt",
    });
    expect(upper).toHaveLength(lower.length);
    expect(upper.map((o) => o.id)).toEqual(lower.map((o) => o.id));
  });

  test("REG-004: provider sort keeps all models (no models lost on sort)", () => {
    const result = filterAndSortModelOptions(options, {
      providerFilter: "all",
      sort: "provider",
      search: "",
    });
    expect(result).toHaveLength(options.length);
    const ids = new Set(result.map((o) => o.id));
    for (const o of options) {
      expect(ids.has(o.id)).toBe(true);
    }
  });

  test("REG-005: providerFilter with unknown provider returns empty list (not all models)", () => {
    const result = filterAndSortModelOptions(options, {
      providerFilter: "mistral",
      sort: "name",
      search: "",
    });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RECOMMENDED_MODEL_IDS constant
// ---------------------------------------------------------------------------
describe("RECOMMENDED_MODEL_IDS", () => {
  // BT-REC-001: constant is an array with at least 6 and at most 10 entries
  test("BT-REC-001: is a non-empty array of 6–10 model IDs", () => {
    expect(Array.isArray(RECOMMENDED_MODEL_IDS)).toBe(true);
    expect(RECOMMENDED_MODEL_IDS.length).toBeGreaterThanOrEqual(6);
    expect(RECOMMENDED_MODEL_IDS.length).toBeLessThanOrEqual(10);
  });

  // BT-REC-002: includes the APP_DEFAULT_MODEL_ID
  test("BT-REC-002: includes openai/gpt-5.4 (APP_DEFAULT_MODEL_ID)", () => {
    expect(RECOMMENDED_MODEL_IDS).toContain("openai/gpt-5.4");
  });

  // BT-REC-003: spans at least anthropic, openai, and google providers
  test("BT-REC-003: spans anthropic, openai, and google providers", () => {
    const ids = RECOMMENDED_MODEL_IDS as readonly string[];
    expect(ids.some((id) => id.startsWith("anthropic/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("openai/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("google/"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildRecommendedModelOptions
// ---------------------------------------------------------------------------
describe("buildRecommendedModelOptions", () => {
  const allOptions = [
    {
      id: "openai/gpt-5.4",
      label: "GPT-5.4",
      shortLabel: "GPT-5.4",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "openai/gpt-5.4-nano",
      label: "GPT-5.4 Nano",
      shortLabel: "GPT-5.4 Nano",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "anthropic/claude-haiku-4.5",
      label: "Claude Haiku 4.5",
      shortLabel: "Haiku 4.5",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      shortLabel: "2.5 Flash",
      isVariant: false,
      provider: "google",
    },
    // NOT in RECOMMENDED_MODEL_IDS — should be excluded
    {
      id: "openai/gpt-4o",
      label: "GPT-4o",
      shortLabel: "GPT-4o",
      isVariant: false,
      provider: "openai",
    },
    {
      id: "anthropic/claude-opus-4.6",
      label: "Claude Opus 4.6",
      shortLabel: "Opus 4.6",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "anthropic/claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      shortLabel: "Sonnet 4.6",
      isVariant: false,
      provider: "anthropic",
    },
    {
      id: "google/gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      shortLabel: "2.0 Flash",
      isVariant: false,
      provider: "google",
    },
    {
      id: "openai/gpt-5.5",
      label: "GPT-5.5",
      shortLabel: "GPT-5.5",
      isVariant: false,
      provider: "openai",
    },
  ];

  // BT-REC-010: returns only models whose ID is in RECOMMENDED_MODEL_IDS
  test("BT-REC-010: filters full catalog to only recommended model IDs", () => {
    const result = buildRecommendedModelOptions(allOptions);
    const resultIds = result.map((o) => o.id);
    // All returned ids must be in RECOMMENDED_MODEL_IDS
    for (const id of resultIds) {
      expect(RECOMMENDED_MODEL_IDS as readonly string[]).toContain(id);
    }
    // openai/gpt-4o is NOT in recommended — must not appear
    expect(resultIds).not.toContain("openai/gpt-4o");
  });

  // BT-REC-011: graceful empty — empty catalog returns empty result
  test("BT-REC-011: returns empty array when given an empty catalog", () => {
    const result = buildRecommendedModelOptions([]);
    expect(result).toEqual([]);
  });

  // BT-REC-012: does not include user-source options (those are always shown)
  test("BT-REC-012: does not filter out user-source options from the result", () => {
    const withUserOption = [
      ...allOptions,
      {
        id: "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
        label: "Claude Opus 4.6",
        shortLabel: "Opus 4.6",
        isVariant: false,
        provider: "user",
        source: "user" as const,
      },
    ];
    const result = buildRecommendedModelOptions(withUserOption);
    const resultIds = result.map((o) => o.id);
    // User-source options should always pass through
    expect(resultIds).toContain(
      "user-profile:profile-1:anthropic%2Fclaude-opus-4.6",
    );
  });

  // BT-REC-013: models not in live catalog are silently omitted (no dead IDs)
  test("BT-REC-013: RECOMMENDED IDs absent from the catalog are silently omitted", () => {
    // catalog has only one recommended model
    const smallCatalog = [
      {
        id: "openai/gpt-5.4",
        label: "GPT-5.4",
        shortLabel: "GPT-5.4",
        isVariant: false,
        provider: "openai",
      },
    ];
    const result = buildRecommendedModelOptions(smallCatalog);
    // Only the one real model should be returned, no phantom entries
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai/gpt-5.4");
  });
});

// ---------------------------------------------------------------------------
// filterAndSortModelOptions — cost sort extension (Slice 3)
// ---------------------------------------------------------------------------
describe("filterAndSortModelOptions — cost sort", () => {
  const cheapModel = {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    shortLabel: "2.0 Flash",
    isVariant: false,
    provider: "google",
    cost: { input: 0.1, output: 0.4 },
  };
  const midModel = {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    shortLabel: "Haiku 4.5",
    isVariant: false,
    provider: "anthropic",
    cost: { input: 1, output: 5 },
  };
  const expensiveModel = {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    shortLabel: "GPT-5.5",
    isVariant: false,
    provider: "openai",
    cost: { input: 5, output: 30 },
  };
  const noCostModel = {
    id: "unknown/mystery",
    label: "Mystery Model",
    shortLabel: "Mystery",
    isVariant: false,
    provider: "unknown",
    // no cost field
  };

  const seeded = [expensiveModel, noCostModel, cheapModel, midModel];

  // BT-SORT-001: cost-asc puts cheapest input price first
  test("BT-SORT-001: cost-asc returns cheapest model first", () => {
    const result = filterAndSortModelOptions(seeded, {
      providerFilter: "all",
      sort: "cost-asc",
      search: "",
    });
    expect(result[0].id).toBe("google/gemini-2.0-flash");
    expect(result[1].id).toBe("anthropic/claude-haiku-4.5");
    expect(result[2].id).toBe("openai/gpt-5.5");
  });

  // BT-SORT-002: cost-desc puts most expensive first
  test("BT-SORT-002: cost-desc returns most expensive model first", () => {
    const result = filterAndSortModelOptions(seeded, {
      providerFilter: "all",
      sort: "cost-desc",
      search: "",
    });
    expect(result[0].id).toBe("openai/gpt-5.5");
    expect(result[1].id).toBe("anthropic/claude-haiku-4.5");
    expect(result[2].id).toBe("google/gemini-2.0-flash");
  });

  // BT-SORT-003: models without cost data sink to the bottom on both cost sorts
  test("BT-SORT-003: models without cost data sort last on cost-asc", () => {
    const result = filterAndSortModelOptions(seeded, {
      providerFilter: "all",
      sort: "cost-asc",
      search: "",
    });
    expect(result[result.length - 1].id).toBe("unknown/mystery");
  });

  test("BT-SORT-003b: models without cost data sort last on cost-desc", () => {
    const result = filterAndSortModelOptions(seeded, {
      providerFilter: "all",
      sort: "cost-desc",
      search: "",
    });
    expect(result[result.length - 1].id).toBe("unknown/mystery");
  });
});
