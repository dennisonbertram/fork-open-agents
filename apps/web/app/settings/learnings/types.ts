import type {
  LearningConfidence,
  LearningScope,
  LearningStatus,
  LearningType,
} from "@/lib/learnings/types";

export type LearningEvidence = {
  id: string;
  kind:
    | "pr_url"
    | "review_comment"
    | "file_excerpt"
    | "command_output"
    | "test_failure";
  ref: string;
  excerpt: string | null;
};

export type LearningFeedItem = {
  id: string;
  repoOwner: string;
  repoName: string;
  type: LearningType;
  scope: LearningScope;
  title: string;
  description: string;
  rootCause: string | null;
  solution: string | null;
  prevention: string | null;
  affectedPaths: string[];
  tags: string[];
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: LearningConfidence;
  status: LearningStatus;
  sourcePrNumber: number | null;
  sourcePrUrl: string | null;
  committedFilePath: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: LearningEvidence[];
};

export type LearningsVerdict = {
  status: "ready" | "action-needed" | "unavailable" | "error";
  headline: string;
  detail?: string;
  errorKind?: string;
};

export type LearningsResponse = {
  enabled: boolean;
  agentId?: string;
  verdict: LearningsVerdict;
  missingEvents?: string[];
  learnings: LearningFeedItem[];
};

export const learningTypeLabels: Record<LearningType, string> = {
  bug: "Bug",
  convention: "Convention",
  architecture: "Architecture",
  design: "Design",
  workflow: "Workflow",
  anti_pattern: "Anti-pattern",
};

export const confidenceLabels: Record<LearningConfidence, string> = {
  proven: "Proven",
  high: "High",
  medium: "Medium",
  low: "Low",
  speculative: "Speculative",
};

export const statusLabels: Record<LearningStatus, string> = {
  active: "Active",
  consolidation_review: "Review",
  archived: "Archived",
  superseded: "Superseded",
};
