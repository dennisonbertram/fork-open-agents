import type { SandboxState } from "@open-agents/sandbox";
import type { WebAgentUIMessage } from "@/app/types";

type ChatPostFinishModule = typeof import("./chat-post-finish-impl");

export type ClaimActiveStreamResult =
  import("./chat-post-finish-impl").ClaimActiveStreamResult;

export async function persistUserMessage(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";
  const { persistUserMessage: persist } =
    await import("./chat-post-finish-impl");
  return persist(chatId, message);
}

export async function persistAssistantMessageWithToolResults(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";
  const { persistAssistantMessageWithToolResults: persist } =
    await import("./chat-post-finish-impl");
  return persist(chatId, message);
}

export async function persistAssistantMessage(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";
  const { persistAssistantMessage: persist } =
    await import("./chat-post-finish-impl");
  return persist(chatId, message);
}

export async function refreshLifecycleActivity(
  sessionId: string,
): Promise<void> {
  "use step";
  const { refreshLifecycleActivity: refresh } =
    await import("./chat-post-finish-impl");
  return refresh(sessionId);
}

export async function persistSandboxState(
  sessionId: string,
  sandboxState: SandboxState,
): Promise<void> {
  "use step";
  const { persistSandboxState: persist } =
    await import("./chat-post-finish-impl");
  return persist(sessionId, sandboxState);
}

export async function clearActiveStream(
  chatId: string,
  workflowRunId: string,
): Promise<void> {
  "use step";
  const { clearActiveStream: clear } = await import("./chat-post-finish-impl");
  return clear(chatId, workflowRunId);
}

export async function claimActiveStream(
  chatId: string,
  workflowRunId: string,
): Promise<ClaimActiveStreamResult> {
  "use step";
  const { claimActiveStream: claim } = await import("./chat-post-finish-impl");
  return claim(chatId, workflowRunId);
}

export async function recordWorkflowUsage(
  ...args: Parameters<ChatPostFinishModule["recordWorkflowUsage"]>
): ReturnType<ChatPostFinishModule["recordWorkflowUsage"]> {
  "use step";
  const { recordWorkflowUsage: record } =
    await import("./chat-post-finish-impl");
  return record(...args);
}

export async function refreshDiffCache(
  sessionId: string,
  sandboxState: SandboxState,
): Promise<void> {
  "use step";
  const { refreshDiffCache: refresh } = await import("./chat-post-finish-impl");
  return refresh(sessionId, sandboxState);
}

export async function closeStream(
  writer: Parameters<ChatPostFinishModule["closeStream"]>[0],
): Promise<void> {
  "use step";
  const { closeStream: close } = await import("./chat-post-finish-impl");
  return close(writer);
}

export async function sendFinish(
  writer: Parameters<ChatPostFinishModule["sendFinish"]>[0],
): Promise<void> {
  "use step";
  const { sendFinish: finish } = await import("./chat-post-finish-impl");
  return finish(writer);
}

export async function hasAutoCommitChangesStep(
  params: Parameters<ChatPostFinishModule["hasAutoCommitChangesStep"]>[0],
): ReturnType<ChatPostFinishModule["hasAutoCommitChangesStep"]> {
  "use step";
  const { hasAutoCommitChangesStep: hasChanges } =
    await import("./chat-post-finish-impl");
  return hasChanges(params);
}

export async function runAutoCommitStep(
  params: Parameters<ChatPostFinishModule["runAutoCommitStep"]>[0],
): ReturnType<ChatPostFinishModule["runAutoCommitStep"]> {
  "use step";
  const { runAutoCommitStep: commit } = await import("./chat-post-finish-impl");
  return commit(params);
}

export async function runAutoCreatePrStep(
  params: Parameters<ChatPostFinishModule["runAutoCreatePrStep"]>[0],
): ReturnType<ChatPostFinishModule["runAutoCreatePrStep"]> {
  "use step";
  const { runAutoCreatePrStep: createPr } =
    await import("./chat-post-finish-impl");
  return createPr(params);
}
