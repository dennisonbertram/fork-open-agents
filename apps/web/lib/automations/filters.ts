import {
  automationKinds,
  automationNativeStatuses,
  type AutomationFilters,
  type AutomationKind,
  type AutomationNativeStatus,
} from "./types";

export type AutomationFilterParseResult =
  | { ok: true; filters: AutomationFilters }
  | { ok: false; errorKind: "invalid_filters" };

function oneValue(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) return undefined;
  const value = values[0]?.trim();
  return value || undefined;
}

function parseRepository(value: string | undefined) {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  const owner = value.slice(0, separator).trim();
  const name = value.slice(separator + 1).trim();
  if (!(owner && name) || name.includes("/")) return null;
  return { owner, name };
}

export function parseAutomationFilters(
  params: URLSearchParams,
): AutomationFilterParseResult {
  for (const key of ["repository", "kind", "state"]) {
    if (params.getAll(key).length > 1) {
      return { ok: false, errorKind: "invalid_filters" };
    }
  }

  const repository = parseRepository(oneValue(params, "repository"));
  if (repository === null) {
    return { ok: false, errorKind: "invalid_filters" };
  }

  const kind = oneValue(params, "kind")?.toLowerCase();
  if (kind && !automationKinds.includes(kind as AutomationKind)) {
    return { ok: false, errorKind: "invalid_filters" };
  }

  const state = oneValue(params, "state")?.toLowerCase();
  if (
    state &&
    !automationNativeStatuses.includes(state as AutomationNativeStatus)
  ) {
    return { ok: false, errorKind: "invalid_filters" };
  }

  return {
    ok: true,
    filters: {
      ...(repository ? { repository } : {}),
      ...(kind ? { kind: kind as AutomationKind } : {}),
      ...(state ? { state: state as AutomationNativeStatus } : {}),
    },
  };
}
