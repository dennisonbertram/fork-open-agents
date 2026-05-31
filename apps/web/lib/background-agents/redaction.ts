const SECRET_KEY_PATTERN =
  /(token|secret|password|authorization|signature|api[_-]?key|private[_-]?key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{20,}/g, "[REDACTED]")
    .replace(
      /(api[_-]?key|token|secret|password)=([^\s"'`]+)/gi,
      "$1=[REDACTED]",
    );
}

export function redactBackgroundAgentPayload(
  value: unknown,
): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const redact = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.slice(0, 50).map(redact);
    }

    if (typeof input === "string") {
      return redactString(input);
    }

    if (!isRecord(input)) {
      return input;
    }

    return Object.fromEntries(
      Object.entries(input).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(entry),
      ]),
    );
  };

  return redact(value) as Record<string, unknown>;
}
