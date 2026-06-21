import type { ModelMessage } from "ai";
import { z } from "zod";

const MAX_TEXT_LENGTH = 2_000;
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|bearer\s+[A-Za-z0-9._-]{20,}|(?:api[_-]?key|token|secret|password)\s*=\s*[^,\s]+)/i;

export const delegatedWorkerCompletionPacketStatusSchema = z.enum([
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

export const delegatedWorkerCompletionPacketValidationStatusSchema = z.enum([
  "valid",
  "invalid",
  "missing",
  "partial",
]);

const boundedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine((value) => !SECRET_PATTERN.test(value), {
    message: "display text must not contain token-shaped secrets",
  });

const evidenceRefSchema = z.object({
  kind: z.enum([
    "task_output",
    "runtime",
    "workspace",
    "usage",
    "completion_packet",
  ]),
  ref: boundedTextSchema,
});

export const delegatedWorkerCompletionPacketSchema = z
  .object({
    version: z.literal(1),
    status: delegatedWorkerCompletionPacketStatusSchema,
    workerId: z.string().min(1),
    workerType: z.string().min(1),
    workspaceMode: z.enum(["shared", "isolated"]).optional(),
    appliedToParentWorkspace: z.boolean(),
    summary: boundedTextSchema,
    scope: z.array(boundedTextSchema).max(20).default([]),
    changedFiles: z.array(boundedTextSchema).max(50).default([]),
    verification: z.array(boundedTextSchema).max(20).default([]),
    blockers: z.array(boundedTextSchema).max(20).default([]),
    integrationInstructions: z.array(boundedTextSchema).max(20).default([]),
    artifacts: z.array(evidenceRefSchema).max(20).default([]),
    recoveryInstructions: z.array(boundedTextSchema).max(20).default([]),
    createdAt: z.number().int().nonnegative(),
  })
  .superRefine((packet, ctx) => {
    if (packet.status === "completed" && packet.verification.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["verification"],
        message: "completed packets require verification evidence",
      });
    }

    if (
      packet.workspaceMode === "isolated" &&
      packet.integrationInstructions.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["integrationInstructions"],
        message: "isolated packets require integration instructions",
      });
    }

    if (
      packet.workspaceMode === "shared" &&
      packet.status === "completed" &&
      packet.appliedToParentWorkspace !== true
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["appliedToParentWorkspace"],
        message: "completed shared packets must be applied to parent workspace",
      });
    }

    if (packet.status !== "completed" && packet.blockers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "blocked, failed, and cancelled packets require blockers",
      });
    }
  });

export type DelegatedWorkerCompletionPacket = z.infer<
  typeof delegatedWorkerCompletionPacketSchema
>;

export type DelegatedWorkerCompletionPacketValidation = {
  status: z.infer<typeof delegatedWorkerCompletionPacketValidationStatusSchema>;
  reasonCode: string;
  reason: string;
  createdAt: number;
};

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function textFromMessages(messages: ModelMessage[] | undefined): string {
  const content = messages?.findLast(
    (message) => message.role === "assistant",
  )?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  return "";
}

function compact(value: string, fallback: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, MAX_TEXT_LENGTH);
}

function validation(
  status: DelegatedWorkerCompletionPacketValidation["status"],
  reasonCode: string,
  reason: string,
  createdAt: number,
): DelegatedWorkerCompletionPacketValidation {
  return { status, reasonCode, reason, createdAt };
}

export function validateDelegatedWorkerCompletionPacket(
  packet: unknown,
  createdAt = Date.now(),
): {
  packet?: DelegatedWorkerCompletionPacket;
  validation: DelegatedWorkerCompletionPacketValidation;
} {
  const parsed = delegatedWorkerCompletionPacketSchema.safeParse(packet);
  if (!parsed.success) {
    return {
      validation: validation(
        "invalid",
        "worker_completion_packet_invalid",
        parsed.error.issues[0]?.message ?? "Completion packet is invalid.",
        createdAt,
      ),
    };
  }

  return {
    packet: parsed.data,
    validation: validation(
      "valid",
      "worker_completion_packet_validated",
      "Completion packet validated.",
      createdAt,
    ),
  };
}

export function buildDelegatedWorkerCompletionPacket(params: {
  status: "completed" | "blocked" | "failed" | "cancelled";
  reasonCode: string;
  workerId: string;
  workerType: string;
  workspaceMode?: "shared" | "isolated";
  finalMessages?: ModelMessage[];
  taskTitle?: string;
  toolCallCount?: number;
  evidenceRefs?: Array<{ kind: string; ref: string }>;
  createdAt?: number;
}): {
  packet?: DelegatedWorkerCompletionPacket;
  validation: DelegatedWorkerCompletionPacketValidation;
} {
  const createdAt = params.createdAt ?? Date.now();
  const completed = params.status === "completed";
  const isolated = params.workspaceMode === "isolated";
  const shared = params.workspaceMode === "shared";
  const summary = compact(
    textFromMessages(params.finalMessages),
    completed
      ? `Worker completed: ${params.taskTitle ?? params.workerType}.`
      : `Worker ${params.status}: ${params.reasonCode}.`,
  );
  const artifacts = [
    ...(params.evidenceRefs ?? []),
    { kind: "completion_packet", ref: "tool-task.output.completionPacket" },
  ].filter(
    (item): item is { kind: string; ref: string } =>
      typeof item.ref === "string" && item.ref.length > 0,
  );
  const packet = {
    version: 1,
    status: params.status,
    workerId: params.workerId,
    workerType: params.workerType,
    workspaceMode: params.workspaceMode,
    appliedToParentWorkspace: shared && completed,
    summary,
    scope: [params.taskTitle ?? params.workerType],
    changedFiles: [],
    verification: completed
      ? [
          `Worker reached terminal completed state: ${params.reasonCode}.`,
          `Observed ${params.toolCallCount ?? 0} delegated tool calls.`,
        ]
      : [],
    blockers: completed ? [] : [`${params.status}: ${params.reasonCode}`],
    integrationInstructions: isolated
      ? [
          "Review child workspace artifacts before applying changes to the parent workspace.",
          "Do not assume isolated child changes mutated the parent workspace.",
        ]
      : shared
        ? ["Changes, if any, were applied in the shared parent workspace."]
        : [],
    artifacts,
    recoveryInstructions: completed
      ? []
      : [
          "Inspect worker lifecycle events and rerun after the blocker is fixed.",
        ],
    createdAt,
  };

  return validateDelegatedWorkerCompletionPacket(packet, createdAt);
}
