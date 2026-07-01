import { redactGtmText } from "@/lib/gtm/redaction";
import type {
  AccountBriefDraft,
  GtmCitedClaim,
  GtmRejectedClaim,
  GtmResearchBriefInput,
  GtmResearchClaimInput,
  GtmResearchSignalKind,
  GtmSignalCandidate,
} from "./types";

function sanitizeList(
  items: string[] | undefined,
  maxLength: number,
): string[] {
  const redacted: string[] = [];
  for (const item of items ?? []) {
    const value = redactGtmText(item, maxLength);
    if (value) {
      redacted.push(value);
    }
  }
  return redacted;
}

function hasCitation(claim: GtmResearchClaimInput): boolean {
  return (claim.evidenceRefs ?? []).length > 0;
}

function allowsPrivateFact(claim: GtmResearchClaimInput): boolean {
  return (claim.evidenceRefs ?? []).some((ref) =>
    ["crm", "manual", "call"].includes(ref.sourceType),
  );
}

export function inferSignalKind(text: string): GtmResearchSignalKind {
  const lower = text.toLowerCase();
  if (lower.includes("hiring") || lower.includes("job post")) {
    return "hiring";
  }
  if (lower.includes("funding") || lower.includes("raised")) {
    return "funding";
  }
  if (lower.includes("objection") || lower.includes("concern")) {
    return "objection";
  }
  if (lower.includes("timing") || lower.includes("deadline")) {
    return "timing";
  }
  if (lower.includes("tech stack") || lower.includes("uses ")) {
    return "tech_stack";
  }
  if (lower.includes("trigger") || lower.includes("launch")) {
    return "trigger";
  }
  if (lower.includes("role") || lower.includes("founder")) {
    return "contact_role";
  }
  if (lower.includes("pain") || lower.includes("problem")) {
    return "pain";
  }
  return "fit";
}

function signalFromClaim(claim: GtmCitedClaim): GtmSignalCandidate {
  return {
    kind: inferSignalKind(claim.text),
    summary: claim.text,
    confidence: "medium",
    evidenceRefs: claim.evidenceRefs,
    status: "draft",
  };
}

export function buildAccountBriefDraft(
  input: GtmResearchBriefInput,
): AccountBriefDraft {
  const citedFacts: GtmCitedClaim[] = [];
  const unknownClaims: GtmRejectedClaim[] = [];

  for (const claim of input.claims) {
    const text = redactGtmText(claim.text, 500);
    if (!text) {
      continue;
    }

    if (!hasCitation(claim)) {
      unknownClaims.push({ text, reason: "missing_required_citation" });
      continue;
    }

    if (claim.privateFact && !allowsPrivateFact(claim)) {
      unknownClaims.push({ text, reason: "private_fact_unverified" });
      continue;
    }

    citedFacts.push({
      text,
      evidenceRefs: claim.evidenceRefs ?? [],
    });
  }

  return {
    accountName: redactGtmText(input.accountName ?? undefined, 160),
    contactName: redactGtmText(input.contactName ?? undefined, 160),
    citedFacts,
    unknownClaims,
    openQuestions: sanitizeList(input.openQuestions, 240),
    nextSteps: sanitizeList(input.nextSteps, 240),
    signalCandidates: citedFacts.map(signalFromClaim),
  };
}
