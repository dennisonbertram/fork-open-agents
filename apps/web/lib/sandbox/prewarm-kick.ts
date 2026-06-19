import "server-only";

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
    await prewarmSessionSandbox({ sessionId, userId });
  } catch (error) {
    console.error(`[Prewarm] Failed for session ${sessionId}:`, error);
  } finally {
    await clearSessionPrewarmRunId(sessionId, runId);
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
