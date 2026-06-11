import "server-only";

export type StepOutcome = "success" | "failure" | "true" | "false";

export type StepExecutionResult = {
  outcome: StepOutcome;
  errorKind?: string;
  errorMessage?: string;
};

export async function executeAgentLoopStep(_params: {
  stepRunId: string;
  workflowRunId: string;
}): Promise<StepExecutionResult> {
  throw new Error("not implemented");
}
