import { clearSessionPrewarmRunId } from "@/lib/db/sessions";
import { prewarmSessionSandbox } from "@/lib/sandbox/prewarm";

async function runPrewarm(
  sessionId: string,
  userId: string,
): Promise<{ status: "prewarmed" | "skipped" | "failed"; reason?: string }> {
  "use step";
  return prewarmSessionSandbox({ sessionId, userId });
}

async function releasePrewarmLease(
  sessionId: string,
  runId: string,
): Promise<void> {
  "use step";
  await clearSessionPrewarmRunId(sessionId, runId);
}

export async function sandboxPrewarmWorkflow(
  sessionId: string,
  userId: string,
  runId: string,
) {
  "use workflow";

  let status: "prewarmed" | "skipped" | "failed" = "skipped";
  try {
    const result = await runPrewarm(sessionId, userId);
    status = result.status;
  } finally {
    await releasePrewarmLease(sessionId, runId);
  }

  return { status };
}
