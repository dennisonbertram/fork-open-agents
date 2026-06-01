// Stub — implementation to be filled in during GREEN phase

export type ToolApprovalDecision = {
  requires: boolean;
  category: string | null;
  reason: string | null;
};

export function bashPolicy(_command: string): ToolApprovalDecision {
  throw new Error("not implemented");
}

export function gitPushPolicy(_command: string): ToolApprovalDecision {
  throw new Error("not implemented");
}

export function externalWritePolicy(_method: string): ToolApprovalDecision {
  throw new Error("not implemented");
}

export function classifyToolApproval(
  _toolName: string,
  _input: unknown,
): ToolApprovalDecision {
  throw new Error("not implemented");
}
