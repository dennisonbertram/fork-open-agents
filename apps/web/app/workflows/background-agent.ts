import { getWorkflowMetadata } from "workflow";

async function executeBackgroundAgentRunStep(input: {
  runId: string;
  workflowRunId: string;
}) {
  "use step";
  const { executeBackgroundAgentRun } =
    await import("@/lib/background-agents/executor");
  await executeBackgroundAgentRun(input);
}

export async function runBackgroundAgentWorkflow(input: { runId: string }) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  await executeBackgroundAgentRunStep({
    runId: input.runId,
    workflowRunId,
  });
}
