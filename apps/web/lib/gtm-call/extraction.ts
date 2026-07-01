import { redactGtmText } from "@/lib/gtm/redaction";
import type { GtmCallBrief, GtmCallDebrief, GtmCallNextStep } from "./types";

const MAX_NOTES_LENGTH = 20_000;

function cleanLines(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .slice(0, 8);
}

function sentenceCandidates(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .slice(0, 12);
}

function matchingSentences(text: string, pattern: RegExp): string[] {
  return sentenceCandidates(text)
    .filter((sentence) => pattern.test(sentence))
    .map((sentence) => redactGtmText(sentence, 180) ?? "")
    .filter((sentence) => sentence.length > 0)
    .slice(0, 5);
}

function extractNextSteps(text: string): GtmCallNextStep[] {
  const matches = matchingSentences(
    text,
    /\b(next|follow up|todo|action|send|schedule|introduce|share)\b/i,
  );
  return matches.map((summary) => ({
    summary,
    owner: /\b(customer|they|buyer|prospect)\b/i.test(summary)
      ? "customer"
      : "founder",
  }));
}

function inferSentiment(text: string): GtmCallDebrief["sentiment"] {
  if (/\b(blocked|concern|risk|expensive|confusing|frustrated)\b/i.test(text)) {
    return "negative";
  }
  if (/\b(excited|great|useful|strong|ready|valuable)\b/i.test(text)) {
    return "positive";
  }
  return "neutral";
}

export function buildGtmCallBrief(input: {
  founderObjective: string;
  knownContext?: string[];
  openLoops?: string[];
  desiredOutcome?: string | null;
  sourceCount?: number;
}): GtmCallBrief {
  const context = cleanLines(input.knownContext);
  const openLoops = cleanLines(input.openLoops);
  const objective = redactGtmText(input.founderObjective, 220) ?? "";
  const desiredOutcome = redactGtmText(input.desiredOutcome ?? undefined, 180);

  return {
    objective,
    conciseBrief:
      context.length > 0
        ? context.slice(0, 3).join(" ")
        : "No prior GTM context is available yet. Use the call to validate fit, pain, timing, and next step.",
    risks:
      openLoops.length > 0
        ? openLoops.map((loop) => `Unresolved: ${loop}`)
        : ["Context is sparse; avoid inventing account facts."],
    openLoops,
    suggestedQuestions: [
      "What problem would make this worth adopting now?",
      "What would block rollout after a successful trial?",
      "Who else needs to trust the result before this moves forward?",
      "What evidence would make the next step obvious?",
    ],
    ...(desiredOutcome ? { desiredOutcome } : {}),
    sourceCount: input.sourceCount ?? context.length,
  };
}

export function buildGtmCallDebrief(input: {
  notes: string;
  attendees?: string[];
}): GtmCallDebrief {
  const notes = input.notes.replace(/\s+/g, " ").trim();
  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error("transcript_too_large");
  }

  const summary =
    redactGtmText(sentenceCandidates(notes).slice(0, 3).join(". "), 480) ??
    "No summary extracted.";
  const nextSteps = extractNextSteps(notes);
  const objections = matchingSentences(
    notes,
    /\b(concern|objection|blocked|risk|expensive|security|budget|legal)\b/i,
  );
  const productAsks = matchingSentences(
    notes,
    /\b(feature|request|wish|needs|integration|workflow|product)\b/i,
  );

  return {
    summary,
    sentiment: inferSentiment(notes),
    attendees: cleanLines(input.attendees),
    nextSteps,
    objections,
    productAsks,
    followUpDraft: {
      subject: "Follow-up and next steps",
      bodyPreview:
        redactGtmText(
          `Thanks for the conversation. I captured ${nextSteps.length} next step(s) and will follow up on the open questions.`,
          320,
        ) ?? "",
    },
    proposedActions: [
      {
        actionKind: "follow_up_draft",
        summary: "Create follow-up draft from approved debrief.",
        targetKind: "touchpoint",
      },
      {
        actionKind: "gtm_record_update",
        summary: "Apply approved call summary and extracted GTM signals.",
        targetKind: "account",
      },
    ],
  };
}
