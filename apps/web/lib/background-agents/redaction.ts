const SECRET_KEY_PATTERN =
  /(token|secret|password|authorization|signature|api[_-]?key|private[_-]?key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
