const DEFAULT_MAX_STRING_LENGTH = 240;
const DEFAULT_MAX_OBJECT_KEYS = 12;
const DEFAULT_MAX_ARRAY_ITEMS = 20;
const DEFAULT_MAX_DEPTH = 4;

const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|cookie|credential|password|secret|session[_-]?token|stderr|stdout|token)/i;

const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|gh[pousr]_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|(api[_-]?key|password|secret|token)=\S+)/i;

export function redactText(
  value: string | null | undefined,
  maxLength = DEFAULT_MAX_STRING_LENGTH,
): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }

  const redacted = SECRET_VALUE_PATTERN.test(trimmed) ? "[redacted]" : trimmed;
  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function redactMetadata(
  value: Record<string, unknown> | null | undefined,
  maxKeys = DEFAULT_MAX_OBJECT_KEYS,
): Record<string, string | number | boolean | null> | undefined {
  if (!value) {
    return undefined;
  }

  const entries: Array<[string, string | number | boolean | null]> = [];
  for (const [key, rawValue] of Object.entries(value)) {
    if (entries.length >= maxKeys) {
      break;
    }

    if (SECRET_KEY_PATTERN.test(key)) {
      entries.push([key, "[redacted]"]);
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      entries.push([
        key,
        typeof rawValue === "string" ? (redactText(rawValue) ?? "") : rawValue,
      ]);
    }
  }

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function redactJsonValue(
  value: unknown,
  options: {
    maxDepth?: number;
    maxObjectKeys?: number;
    maxArrayItems?: number;
    maxStringLength?: number;
  } = {},
): unknown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxObjectKeys = options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS;
  const maxArrayItems = options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;

  function redact(rawValue: unknown, depth: number): unknown {
    if (
      rawValue === null ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      return rawValue;
    }

    if (typeof rawValue === "string") {
      return redactText(rawValue, maxStringLength) ?? "";
    }

    if (depth >= maxDepth) {
      return "[truncated]";
    }

    if (Array.isArray(rawValue)) {
      return rawValue
        .slice(0, maxArrayItems)
        .map((item) => redact(item, depth + 1));
    }

    if (typeof rawValue !== "object" || rawValue === undefined) {
      return undefined;
    }

    const entries: Array<[string, unknown]> = [];
    for (const [key, nestedValue] of Object.entries(rawValue)) {
      if (entries.length >= maxObjectKeys) {
        break;
      }

      if (SECRET_KEY_PATTERN.test(key)) {
        entries.push([key, "[redacted]"]);
        continue;
      }

      entries.push([key, redact(nestedValue, depth + 1)]);
    }

    return Object.fromEntries(entries);
  }

  return redact(value, 0);
}
