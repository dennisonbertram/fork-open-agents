import { createHash } from "node:crypto";
import { redactGtmText } from "@/lib/gtm/redaction";
import type {
  GtmActivationSeverity,
  GtmActivationSignalCandidate,
  GtmActivationSignalType,
  GtmActivationSourceInput,
} from "./types";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function buildCandidate(
  input: GtmActivationSourceInput,
  signalType: GtmActivationSignalType,
  severity: GtmActivationSeverity,
  summary: string,
  suggestedIntervention: string,
): GtmActivationSignalCandidate {
  const redactedSummary = redactGtmText(summary, 240) ?? summary;
  const title = `[Activation] ${signalType.replaceAll("_", " ")} for ${input.targetUserHash}`;
  const body = [
    redactedSummary,
    "",
    `Suggested intervention: ${suggestedIntervention}`,
    `Target user ref: ${input.targetUserHash}`,
    `Evidence count: ${input.evidenceRefs?.length ?? 0}`,
  ].join("\n");

  return {
    signalType,
    severity,
    targetUserHash: input.targetUserHash,
    summary: redactedSummary,
    suggestedIntervention,
    draftIssue: {
      title,
      body,
    },
    evidenceRefs: input.evidenceRefs ?? [],
    dedupSignature: stableHash(
      `${input.targetUserHash}:${signalType}:${redactedSummary}`,
    ),
  };
}

export function classifyGtmActivationSignals(
  inputs: GtmActivationSourceInput[],
): GtmActivationSignalCandidate[] {
  const candidates: GtmActivationSignalCandidate[] = [];

  for (const input of inputs) {
    const targetUserHash = input.targetUserHash.trim();
    if (!targetUserHash) {
      continue;
    }

    const source = { ...input, targetUserHash };

    if (source.githubInstalled === false) {
      candidates.push(
        buildCandidate(
          source,
          "github_not_installed",
          "medium",
          "Signed up but has not installed GitHub yet.",
          "Offer setup help and inspect GitHub app onboarding friction.",
        ),
      );
    }

    if (source.githubInstalled === true && (source.sessionCount ?? 0) === 0) {
      candidates.push(
        buildCandidate(
          source,
          "no_first_session",
          "medium",
          "Installed GitHub but has not started a first useful session.",
          "Send a starter workflow suggestion and inspect first-session UX.",
        ),
      );
    }

    if ((source.failureCount ?? 0) >= 3) {
      candidates.push(
        buildCandidate(
          source,
          "repeated_session_failure",
          "high",
          `${source.failureCount} session failures suggest activation is blocked.`,
          "Review failed sessions and prepare a targeted rescue note.",
        ),
      );
    }

    if (source.objectionText?.trim()) {
      candidates.push(
        buildCandidate(
          source,
          "explicit_objection",
          "high",
          `User objection: ${source.objectionText}`,
          "Cluster the objection and decide whether support or product follow-up is needed.",
        ),
      );
    }

    if (source.featureRequestText?.trim()) {
      candidates.push(
        buildCandidate(
          source,
          "product_request",
          "medium",
          `Product request: ${source.featureRequestText}`,
          "Draft a private product issue for operator approval.",
        ),
      );
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.dedupSignature)) {
      return false;
    }
    seen.add(candidate.dedupSignature);
    return true;
  });
}
