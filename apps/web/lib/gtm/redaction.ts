import { createHash } from "node:crypto";

const MAX_STRING_LENGTH = 240;
const MAX_OBJECT_KEYS = 16;
const MAX_ARRAY_ITEMS = 12;
const MAX_DEPTH = 4;

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|authorization|body|cookie|credential|email|note|password|phone|prompt|secret|session[_-]?token|stderr|stdout|token|transcript)/i;

const SENSITIVE_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|gh[pousr]_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|(api[_-]?key|password|secret|token)=\S+)/i;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function redactGtmText(
  value: string | null | undefined,
  maxLength = MAX_STRING_LENGTH,
): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }

  const redacted = SENSITIVE_VALUE_PATTERN.test(trimmed)
    ? `[redacted:${stableHash(trimmed)}]`
    : trimmed;

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function redactGtmPayload(value: unknown): Record<string, unknown> {
  const redact = (rawValue: unknown, depth: number): unknown => {
    if (
      rawValue === null ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      return rawValue;
    }

    if (typeof rawValue === "string") {
      return redactGtmText(rawValue) ?? "";
    }

    if (depth >= MAX_DEPTH) {
      return "[truncated]";
    }

    if (Array.isArray(rawValue)) {
      return rawValue
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redact(item, depth + 1));
    }

    if (typeof rawValue !== "object" || rawValue === undefined) {
      return undefined;
    }

    const entries: Array<[string, unknown]> = [];
    for (const [key, nestedValue] of Object.entries(rawValue)) {
      if (entries.length >= MAX_OBJECT_KEYS) {
        break;
      }

      if (SENSITIVE_KEY_PATTERN.test(key)) {
        const marker =
          typeof nestedValue === "string" && nestedValue.length > 0
            ? `[redacted:${stableHash(nestedValue)}]`
            : "[redacted]";
        entries.push([key, marker]);
        continue;
      }

      entries.push([key, redact(nestedValue, depth + 1)]);
    }

    return Object.fromEntries(entries);
  };

  const redacted = redact(value, 0);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}
