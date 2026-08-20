/**
 * Same-origin relative path for `GET /api/dev/test-auth?next=`.
 *
 * Rejects protocol-relative URLs, absolute URLs, and backslash / %5c
 * encodings that URL parsers treat as an authority separator
 * (`/%5c%5cevil.example` → `https://evil.example/`). After construction,
 * the resolved origin must still match the request origin.
 */
export function resolveSafeTestAuthNextPath(
  next: string | null,
  origin: string,
): string | null {
  if (!next) {
    return null;
  }
  if (next.includes("\\") || /%5c/i.test(next)) {
    return null;
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return null;
  }

  let target: URL;
  try {
    target = new URL(next, origin);
  } catch {
    return null;
  }

  let requestOrigin: URL;
  try {
    requestOrigin = new URL(origin);
  } catch {
    return null;
  }

  if (target.origin !== requestOrigin.origin) {
    return null;
  }

  return `${target.pathname}${target.search}${target.hash}`;
}
