import { getWorkflowMetadata } from "workflow";
import { executeBackgroundAgentRun } from "@/lib/background-agents/executor";

export async function runBackgroundAgentWorkflow(input: { runId: string }) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  await executeBackgroundAgentRun({
    runId: input.runId,
    workflowRunId,
  });
}
