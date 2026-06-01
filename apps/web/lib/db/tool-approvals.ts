// Stub — implementation to be filled in during GREEN phase
import "server-only";

export type ToolApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export interface ToolApprovalRecord {
  id: string;
  approvalId: string;
  toolName: string;
  toolCallId: string;
  category: string | null;
  reason: string | null;
  sessionId: string | null;
  chatId: string | null;
  userId: string | null;
  decision: ToolApprovalDecision;
  consumed: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParkToolApprovalInput {
  id: string;
  approvalId: string;
  toolName: string;
  toolCallId: string;
  category?: string | null;
  reason?: string | null;
  sessionId?: string | null;
  chatId?: string | null;
  userId?: string | null;
  expiresAt?: Date | null;
}

export async function parkToolApproval(
  _input: ParkToolApprovalInput,
): Promise<ToolApprovalRecord | null> {
  throw new Error("not implemented");
}

export async function getToolApproval(
  _approvalId: string,
): Promise<ToolApprovalRecord | null> {
  throw new Error("not implemented");
}

export async function consumeToolApproval(
  _approvalId: string,
  _decision: "approved" | "denied" | "expired",
): Promise<ToolApprovalRecord | null> {
  throw new Error("not implemented");
}
