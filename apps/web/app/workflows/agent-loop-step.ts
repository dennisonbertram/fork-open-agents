import { getWorkflowMetadata } from "workflow";
import { runAgentLoopStep } from "@/lib/agent-loops/chain";

export async function runAgentLoopStepWorkflow(input: { stepRunId: string }) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await runAgentLoopStep({ stepRunId: input.stepRunId, workflowRunId });
}
