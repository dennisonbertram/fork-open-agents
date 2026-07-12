export class AgentLoopSourceDeletedError extends Error {
  readonly kind = "source_deleted" as const;
  readonly runId: string;

  constructor(runId: string) {
    super(`Source Automation deleted for run ${runId}`);
    this.name = "AgentLoopSourceDeletedError";
    this.runId = runId;
  }
}
