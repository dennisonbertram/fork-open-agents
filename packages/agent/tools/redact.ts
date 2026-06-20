/**
 * Text redaction helpers for browser tool output (browser_extract, browser_screenshot).
 *
 * Implements the same redaction patterns as apps/web/lib/harness/redaction.ts
 * for use inside packages/agent (cross-package import boundary).
 *
 * Patterns covered:
 *  - Bearer tokens (Authorization headers, inline text)
 *  - sk-  shaped API keys (OpenAI, Anthropic, etc.)
 *  - gh_  shaped GitHub tokens (ghp_, gho_, ghu_, ghr_, ghs_, ghat_)
 *  - xox  shaped Slack tokens (xoxb-, xoxa-, etc.)
 *  - ENV_VAR=value assignments where var name suggests a secret
 *  - URL userinfo (username:password@ in URLs) — MUST-2
 *  - URL secret-bearing query params (?token=, ?api_key=, etc.) — MUST-2
 *
 * IMPLEMENTATION NOTE: All regex patterns are constructed inside each function
 * call rather than as module-level constants. Bun's transpiler/runtime has a
 * quirk where module-level /g flag regex constants share lastIndex state across
 * calls in ways that silently skip replacements. Constructing fresh RegExp
 * instances per call is the safe, correct approach and has negligible cost.
 *
 * Usage:
 *  import { redactBrowserText, capBrowserText } from "./redact";
 */

/** Maximum characters allowed in browser_extract output. */
const EXTRACT_TEXT_CAP = 10_000;

/**
 * Maximum byte size for a screenshot that will be streamed inline (~3 MB raw).
 *
 * NOTE on base64 overhead: the streamed payload is a data-URL (base64-encoded),
 * which is approximately 33% larger than the raw PNG bytes (~1.33× overhead).
 * A 3 MB raw cap therefore produces an effective encoded payload of roughly
 * ceil(3 MB / 3) × 4 ≈ 4 MB in the data-URL. This is a known nominal-vs-effective
 * gap documented here; the raw byte cap is the authoritative limit.
 */
export const SCREENSHOT_BYTE_CAP = 3 * 1024 * 1024;

/**
 * Redact credential-shaped strings from browser extracted text.
 *
 * Matches the redaction logic in apps/web/lib/harness/redaction.ts
 * for consistency across the system.
 *
 * Also strips:
 *  - URL userinfo (user:pass@host) from bare and embedded URLs (MUST-2)
 *  - URL query strings containing secret-bearing params (?token=, ?api_key=, etc.)
 */
export function redactBrowserText(text: string): string {
  // Construct fresh patterns per call — module-level /g regex share lastIndex
  // state in Bun's runtime which silently breaks replacements.
  const bearerPattern = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
  const tokenShapedPattern =
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;
  const envAssignmentPattern =
    /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=([^\s]+)/g;

  // 1. Standard token/key redactions
  let result = text
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(tokenShapedPattern, "[REDACTED_TOKEN]")
    .replace(envAssignmentPattern, (match) => {
      const eqIdx = match.indexOf("=");
      const name = match.slice(0, eqIdx);
      return `${name}=[REDACTED]`;
    });

  // 2. URL credential stripping — matches harness redaction.ts:redactString.
  //
  // Case A: entire string is a bare http(s) URL — parse and strip userinfo/query/hash.
  // Only attempt if the string starts with http:// or https:// to avoid false positives
  // where Bun's permissive URL parser treats arbitrary strings as valid URLs.
  if (/^https?:\/\//i.test(result)) {
    try {
      const url = new URL(result);
      if (url.username || url.password || url.search || url.hash) {
        return `${url.origin}${url.pathname}`;
      }
      return result;
    } catch {
      // Not a valid URL — fall through to Case B
    }
  }

  // Case B: text contains embedded https?:// URLs — split on URL tokens,
  // redact credentials from each token, then rejoin.
  // Uses split+capture-group so URL tokens (odd indices) are preserved.
  const parts = result.split(/(https?:\/\/[^\s"'<>]+)/);
  result = parts
    .map((part, i) => {
      if (i % 2 !== 1) return part; // even indices = non-URL text
      try {
        const url = new URL(part);
        if (url.username || url.password || url.search || url.hash) {
          return `${url.origin}${url.pathname}`;
        }
        return part;
      } catch {
        return part;
      }
    })
    .join("");

  return result;
}

/**
 * Cap browser extracted text to EXTRACT_TEXT_CAP characters.
 * Appends a truncation marker so the model knows output was trimmed.
 */
export function capBrowserText(text: string): string {
  if (text.length <= EXTRACT_TEXT_CAP) {
    return text;
  }
  return text.slice(0, EXTRACT_TEXT_CAP) + " [TRUNCATED]";
}
