import { getWorkflowMetadata } from "workflow";

async function runAgentLoopStepStep(input: {
  stepRunId: string;
  workflowRunId: string;
}) {
  "use step";
  const { runAgentLoopStep } = await import("@/lib/agent-loops/chain");
  await runAgentLoopStep(input);
}

export async function runAgentLoopStepWorkflow(input: { stepRunId: string }) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  await runAgentLoopStepStep({ stepRunId: input.stepRunId, workflowRunId });
}
