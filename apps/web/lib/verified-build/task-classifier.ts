import type { HarnessMode } from "@/lib/harness/types";

export type VerifiedBuildChatMode = "chat" | "investigation" | HarnessMode;

export type TaskClassification = {
  mode: VerifiedBuildChatMode;
  reasonCode: string;
  confidence: number;
  summary: string;
};

const MUTATION_PATTERNS = [
  /\b(implement|fix|refactor|migrate|write|change|update|edit|add|remove|delete)\b/i,
  /\b(test|typecheck|lint|ci|build|deploy|open\s+pr|pull request|commit|push)\b/i,
  /\b(auth|billing|permission|secret|credential|database|migration|provider)\b/i,
];

const DIRECT_MUTATION_PATTERN =
  /\b(implement|fix|refactor|migrate|write|change|update|edit|add|remove|delete|run|deploy|open\s+pr|commit|push)\b/i;

const INVESTIGATION_PATTERNS = [
  /\b(look into|investigate|debug why|why|review|plan|scope|audit)\b/i,
  /\b(read|inspect|explore|analyze|summarize)\b/i,
];

const CHAT_PATTERNS = [
  /\b(explain|brainstorm|strategy|discuss|what is|how would|compare)\b/i,
  /\b(no code|do not change|without changing|plan only|strategy only)\b/i,
];

function extractText(
  messages: Array<{ role?: string; parts?: unknown[] }>,
): string {
  const latestUserMessage = [...messages]
    .toReversed()
    .find((message) => message.role === "user");
  const parts = latestUserMessage?.parts ?? [];
  return parts
    .map((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

export function classifyVerifiedBuildTask(
  messages: Array<{ role?: string; parts?: unknown[] }>,
): TaskClassification {
  const text = extractText(messages);
  const summary = text.length > 240 ? `${text.slice(0, 237)}...` : text;
  const chatMatch = CHAT_PATTERNS.some((pattern) => pattern.test(text));
  const mutationMatch = MUTATION_PATTERNS.some((pattern) => pattern.test(text));
  const investigationMatch = INVESTIGATION_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
  const directMutationMatch = DIRECT_MUTATION_PATTERN.test(text);

  if (investigationMatch && !directMutationMatch && !chatMatch) {
    return {
      mode: "investigation",
      reasonCode: "read_only_investigation",
      confidence: 0.72,
      summary,
    };
  }

  if (
    mutationMatch &&
    !/\b(no code|do not change|plan only|strategy only)\b/i.test(text)
  ) {
    return {
      mode: "verified_build",
      reasonCode: "mutating_software_work",
      confidence: 0.86,
      summary,
    };
  }

  return {
    mode: "chat",
    reasonCode: chatMatch ? "discussion_only" : "default_chat",
    confidence: chatMatch ? 0.78 : 0.55,
    summary,
  };
}
