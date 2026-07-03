/**
 * Pure helper: returns true when a Select has ≤1 real option and should be
 * replaced with a static read-only line.
 */
export function shouldCollapseSingleOption(
  options: Array<{ id: string; name: string }>,
): boolean {
  return options.length <= 1;
}

// ---------------------------------------------------------------------------
// MR-4 (#812): runtime profile option grouping (Built-in / Yours)
// ---------------------------------------------------------------------------

export interface RuntimeProfileOptionLike {
  id: string;
  displayName: string;
  source: "built_in" | "user_default";
}

export interface RuntimeProfileOptionGroup {
  label: string;
  options: Array<{ id: string; name: string }>;
}

/**
 * Groups the merged GET /api/settings/runtime-profiles response into
 * "Built-in" and "Yours" sections for the Preferences default-profile picker
 * (Decision D1 / issue #812 section 5). Only non-empty groups are returned
 * so a user with no saved profiles doesn't see an empty "Yours" heading.
 */
export function groupRuntimeProfileOptions(
  profiles: RuntimeProfileOptionLike[],
): RuntimeProfileOptionGroup[] {
  const builtIn = profiles.filter((p) => p.source === "built_in");
  const userDefault = profiles.filter((p) => p.source === "user_default");

  const groups: RuntimeProfileOptionGroup[] = [];
  if (builtIn.length > 0) {
    groups.push({
      label: "Built-in",
      options: builtIn.map((p) => ({ id: p.id, name: p.displayName })),
    });
  }
  if (userDefault.length > 0) {
    groups.push({
      label: "Yours",
      options: userDefault.map((p) => ({ id: p.id, name: p.displayName })),
    });
  }
  return groups;
}

export function getSingleOptionPickerState(
  options: Array<{ id: string; name: string }>,
): { label: string; status: string } | null {
  if (!shouldCollapseSingleOption(options)) {
    return null;
  }

  const option = options[0];

  return {
    label: option?.name ?? "None",
    status: option ? "Only available option" : "No options available",
  };
}
