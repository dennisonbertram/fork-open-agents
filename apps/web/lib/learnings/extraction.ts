import { redactHarnessPayload } from "@/lib/harness/redaction";

// ---- Redaction verifier ----
// Runs AFTER redactHarnessPayload to catch residuals that the primary
// regex-based redaction missed (PEM blocks, high-entropy runs, known prefixes).

const PEM_PATTERN = /-----BEGIN\s+(?:RSA\s+)?(?:PRIVATE|PUBLIC)\s+KEY-----/i;

// Known token prefixes that indicate a leaked secret
const KNOWN_PREFIX_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{10,}|ghs_[A-Za-z0-9_]{10,}|gho_[A-Za-z0-9_]{10,}|ghu_[A-Za-z0-9_]{10,}|ghr_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})/;

// High-entropy run: a continuous alphanum string of 32+ chars that looks random
// (e.g. a raw secret that bypassed regex redaction)
const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9_/+]{32,}\b/g;

function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const ch of s) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  return Object.values(freq).reduce((acc, count) => {
    const p = count / s.length;
    return acc - p * Math.log2(p);
  }, 0);
}

const HIGH_ENTROPY_THRESHOLD = 4.5;

export function verifyRedaction(text: string): {
  status: "passed" | "failed" | "blocked";
  detector?: "pem" | "high_entropy" | "known_prefix";
} {
  // Check PEM block first
  if (PEM_PATTERN.test(text)) {
    return { status: "blocked", detector: "pem" };
  }

  // Check known token prefixes
  if (KNOWN_PREFIX_PATTERN.test(text)) {
    return { status: "failed", detector: "known_prefix" };
  }

  // Check high-entropy runs
  const matches = text.match(HIGH_ENTROPY_PATTERN);
  if (matches) {
    for (const match of matches) {
      if (shannonEntropy(match) >= HIGH_ENTROPY_THRESHOLD) {
        return { status: "failed", detector: "high_entropy" };
      }
    }
  }

  return { status: "passed" };
}

// ---- Safe event payload keys ----
// Candidate text must NOT use ARTIFACT_CONTENT_KEYS (content, body, stdout,
// stderr, etc.) because those are wholesale-redacted by redactHarnessPayload.
// Safe keys: candidate_text, learning_excerpt.

export type EventPayloadInput = {
  title: string;
  description?: string;
  solution?: string;
  prevention?: string;
  [key: string]: unknown;
};

export function toEventPayload(
  candidate: EventPayloadInput,
): Record<string, unknown> {
  const { title, description, solution, prevention } = candidate;
  return {
    candidate_text: title,
    learning_excerpt: [description, solution, prevention]
      .filter(Boolean)
      .join(" | "),
  };
}

// ---- Quality + actionability gate ----
// Applied to LLM-extracted candidates before redaction + persist.

export type ExtractionCandidate = {
  title: string;
  description: string;
  rootCause?: string;
  solution?: string;
  prevention?: string;
  type: string;
  scope: string;
  affectedPaths: string[];
  tags: string[];
  severity: string;
  confidence: string;
  actionable: boolean;
  qualityScore: number;
  reviewerSourced: boolean;
  excerpt?: string;
};

export function passesQualityGate(candidate: ExtractionCandidate): boolean {
  if (!candidate.actionable) return false;
  if (candidate.qualityScore < 3) return false;
  if (!candidate.title || candidate.title.trim().length < 5) return false;
  if (!candidate.description || candidate.description.trim().length < 10)
    return false;
  return true;
}

// ---- Redact and verify an excerpt ----
// Returns the redacted excerpt if safe, or null if it must be dropped.

export function redactAndVerifyExcerpt(
  excerpt: string | undefined,
): { safe: string } | { drop: true; detector?: string } {
  if (!excerpt) return { safe: "" };
  const redacted = redactHarnessPayload({ candidate_text: excerpt }) as {
    candidate_text: string;
  };
  const result = verifyRedaction(redacted.candidate_text);
  if (result.status !== "passed") {
    return { drop: true, detector: result.detector };
  }
  return { safe: redacted.candidate_text };
}
