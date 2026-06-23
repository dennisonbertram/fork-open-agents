const POSTGRES_JSONB_NUL_REPLACEMENT = "\\u0000";

function sanitizeJsonbString(value: string): string {
  return value.includes("\0")
    ? value.replaceAll("\0", POSTGRES_JSONB_NUL_REPLACEMENT)
    : value;
}

export function sanitizeJsonbValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeJsonbString(value);
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const sanitizedItem = sanitizeJsonbValue(item);
      if (sanitizedItem !== item) {
        changed = true;
      }
      return sanitizedItem;
    });

    return changed ? next : value;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitizedKey = sanitizeJsonbString(key);
    const sanitizedItem = sanitizeJsonbValue(item);
    if (sanitizedKey !== key || sanitizedItem !== item) {
      changed = true;
    }
    next[sanitizedKey] = sanitizedItem;
  }

  return changed ? next : value;
}
