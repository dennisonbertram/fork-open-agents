import "server-only";

import { start } from "workflow/api";
import { sandboxPrewarmWorkflow } from "@/app/workflows/sandbox-prewarm";
import {
  claimSessionPrewarmRunId,
  clearSessionPrewarmRunId,
} from "@/lib/db/sessions";
import { prewarmSessionSandbox } from "./prewarm";

interface KickSandboxPrewarmInput {
  sessionId: string;
  userId: string;
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

function createPrewarmRunId(): string {
  return `prewarm:${Date.now()}:${crypto.randomUUID()}`;
}

async function startPrewarmRun(
  sessionId: string,
  userId: string,
  runId: string,
): Promise<void> {
  try {
    const run = await start(sandboxPrewarmWorkflow, [sessionId, userId, runId]);
    console.log(
      `[Prewarm] Started workflow run ${run.runId} for session ${sessionId} (lease=${runId}).`,
    );
  } catch (error) {
    console.error(
      `[Prewarm] Failed to start workflow run for session ${sessionId}; using inline fallback:`,
      error,
    );

    // Release the lease if we still own it (clearSessionPrewarmRunId uses a conditional WHERE).
    await clearSessionPrewarmRunId(sessionId, runId);

    await prewarmSessionSandbox({ sessionId, userId });
  }
}

export function kickSandboxPrewarmWorkflow(
  input: KickSandboxPrewarmInput,
): void {
  const run = async () => {
    const runId = createPrewarmRunId();
    const claimed = await claimSessionPrewarmRunId(input.sessionId, runId);
    if (!claimed) {
      return;
    }

    await startPrewarmRun(input.sessionId, input.userId, runId);
  };

  if (input.scheduleBackgroundWork) {
    input.scheduleBackgroundWork(run);
    return;
  }

  void run();
}
