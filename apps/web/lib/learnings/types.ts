import { z } from "zod";

// ---- Enum schemas ----

export const learningTypeSchema = z.enum([
  "bug",
  "convention",
  "architecture",
  "design",
  "workflow",
  "anti_pattern",
]);
export type LearningType = z.infer<typeof learningTypeSchema>;

export const learningScopeSchema = z.enum(["file", "module", "repo"]);
export type LearningScope = z.infer<typeof learningScopeSchema>;

export const learningConfidenceSchema = z.enum([
  "proven",
  "high",
  "medium",
  "low",
  "speculative",
]);
export type LearningConfidence = z.infer<typeof learningConfidenceSchema>;

export const learningStatusSchema = z.enum([
  "active",
  "consolidation_review",
  "archived",
  "superseded",
]);
export type LearningStatus = z.infer<typeof learningStatusSchema>;

// ---- Extracted candidate (structured LLM output) ----

export const extractedLearningCandidateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  rootCause: z.string().max(1000).optional(),
  solution: z.string().max(1000).optional(),
  prevention: z.string().max(1000).optional(),
  type: learningTypeSchema,
  scope: learningScopeSchema.default("repo"),
  affectedPaths: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  severity: z
    .enum(["critical", "high", "medium", "low", "info"])
    .default("info"),
  confidence: learningConfidenceSchema.default("medium"),
  actionable: z.boolean().default(true),
  qualityScore: z.number().min(0).max(5).default(3),
  reviewerSourced: z.boolean().default(false),
  excerpt: z.string().max(500).optional(),
});

export type ExtractedLearningCandidate = z.infer<
  typeof extractedLearningCandidateSchema
>;

// ---- DB row types (mirrors schema.ts) ----

export type RepoLearningRow = {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  installationId: number | null;
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
  dedupSignature: string;
  supersedesLearningId: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  sourcePrNumber: number | null;
  sourcePrUrl: string | null;
  committedFilePath: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RepoLearningExtractionRunRow = {
  id: string;
  userId: string;
  backgroundAgentRunId: string | null;
  repoOwner: string;
  repoName: string;
  prNumber: number | null;
  triggerKind: string;
  candidatesExtracted: number;
  accepted: number;
  merged: number;
  rejected: number;
  errorKind: string | null;
  createdAt: Date;
};

// ---- Store interface ----

export type FindForDedupResult = Array<
  Pick<
    RepoLearningRow,
    | "id"
    | "title"
    | "rootCause"
    | "solution"
    | "affectedPaths"
    | "prevention"
    | "dedupSignature"
  >
>;

export interface LearningsStore {
  findForDedup(params: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }): Promise<FindForDedupResult>;

  createLearning(
    learning: Omit<RepoLearningRow, "createdAt" | "updatedAt">,
  ): Promise<RepoLearningRow>;

  updateLearning(
    id: string,
    updates: Partial<
      Pick<
        RepoLearningRow,
        | "description"
        | "solution"
        | "prevention"
        | "confidence"
        | "status"
        | "updatedAt"
      >
    >,
  ): Promise<RepoLearningRow>;

  recordExtractionRun(
    run: Omit<RepoLearningExtractionRunRow, "createdAt">,
  ): Promise<RepoLearningExtractionRunRow>;
}
