const SECRET_PATTERNS = [
  /\b[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*=([^\s]+)/gi,
  /\b[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*=([^\s]+)/gi,
  /\b[A-Za-z0-9_]*KEY[A-Za-z0-9_]*=([^\s]+)/gi,
  /\b(cookie|authorization):\s*[^\n\r]+/gi,
  /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bgh[psu]_[A-Za-z0-9_]{20,}\b/g,
  /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
];

export function redactOpsText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[redacted]"),
    value,
  );
}

export function assertNoSecretLikeText(value: string): void {
  const redacted = redactOpsText(value);
  if (redacted !== value) {
    throw new Error("Refusing to print secret-like output.");
  }
}
