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
 *
 * Usage:
 *  import { redactBrowserText, capBrowserText } from "./redact";
 */

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_SHAPED_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;
const ENV_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=([^\s]+)/g;

/** Maximum characters allowed in browser_extract output. */
const EXTRACT_TEXT_CAP = 10_000;

/** Maximum byte size for a screenshot that will be streamed inline (~3 MB). */
export const SCREENSHOT_BYTE_CAP = 3 * 1024 * 1024;

/**
 * Redact credential-shaped strings from browser extracted text.
 *
 * Matches the redaction logic in apps/web/lib/harness/redaction.ts
 * for consistency across the system.
 */
export function redactBrowserText(text: string): string {
  return text
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(TOKEN_SHAPED_PATTERN, "[REDACTED_TOKEN]")
    .replace(ENV_ASSIGNMENT_PATTERN, (match) => {
      const eqIdx = match.indexOf("=");
      const name = match.slice(0, eqIdx);
      return `${name}=[REDACTED]`;
    });
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
