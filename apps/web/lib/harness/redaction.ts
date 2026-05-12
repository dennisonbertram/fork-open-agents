const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|credential)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_SHAPED_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;
const ENV_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=([^\s]+)/g;

const ARTIFACT_CONTENT_KEYS = new Set([
  "artifact",
  "artifact_content",
  "artifactContent",
  "content",
  "stdout",
  "stderr",
  "body",
  "request_body",
  "response_body",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactString(value: string): string {
  let redacted = value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(TOKEN_SHAPED_PATTERN, "[REDACTED_TOKEN]")
    .replace(ENV_ASSIGNMENT_PATTERN, (match) => {
      const [name] = match.split("=");
      return `${name}=[REDACTED]`;
    });

  try {
    const url = new URL(redacted);
    if (url.username || url.password || url.search || url.hash) {
      redacted = `${url.origin}${url.pathname}`;
    }
  } catch {
    // Not a URL; keep the regex redactions above.
  }

  return redacted;
}

export function redactHarnessValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    if (ARTIFACT_CONTENT_KEYS.has(key)) {
      return "[REDACTED_ARTIFACT_CONTENT]";
    }
    return redactString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactHarnessValue(item));
  }

  if (!isRecord(value)) {
    return "[REDACTED_UNSUPPORTED_VALUE]";
  }

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = redactHarnessValue(entryValue, entryKey);
  }
  return result;
}

export function redactHarnessPayload<T>(payload: T): T {
  return redactHarnessValue(payload) as T;
}
