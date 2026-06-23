export type MessageRowMemoProps = {
  groupedMessage: unknown;
  sessionId: string;
  chatId: string;
  durationMs: number | null;
  startedAt: string | null;
  streamdownComponents: unknown;
  hasMessageActionInFlight: boolean;
  resendingMessageId: string | null;
  deletingMessageId: string | null;
  copiedAssistantMessageId: string | null;
  forkingAssistantMessageId: string | null;
  modelOptions: unknown;
  onResendUserMessage: unknown;
  onDeleteUserMessage: unknown;
  onCopyAssistantMessage: unknown;
  onForkAssistantMessage: unknown;
  onApproveTool: unknown;
  onDenyTool: unknown;
  onApproveAllToolsForSession: unknown;
  onManagedRuntimeProfileOutput: unknown;
  onOpenVerifiedBuildPanel: unknown;
  onOpenRuntimePanel: unknown;
};

export function areMessageRowPropsEqual(
  previous: MessageRowMemoProps,
  next: MessageRowMemoProps,
) {
  return (
    previous.groupedMessage === next.groupedMessage &&
    previous.sessionId === next.sessionId &&
    previous.chatId === next.chatId &&
    previous.durationMs === next.durationMs &&
    previous.startedAt === next.startedAt &&
    previous.streamdownComponents === next.streamdownComponents &&
    previous.hasMessageActionInFlight === next.hasMessageActionInFlight &&
    previous.resendingMessageId === next.resendingMessageId &&
    previous.deletingMessageId === next.deletingMessageId &&
    previous.copiedAssistantMessageId === next.copiedAssistantMessageId &&
    previous.forkingAssistantMessageId === next.forkingAssistantMessageId &&
    previous.modelOptions === next.modelOptions &&
    previous.onResendUserMessage === next.onResendUserMessage &&
    previous.onDeleteUserMessage === next.onDeleteUserMessage &&
    previous.onCopyAssistantMessage === next.onCopyAssistantMessage &&
    previous.onForkAssistantMessage === next.onForkAssistantMessage &&
    previous.onApproveTool === next.onApproveTool &&
    previous.onDenyTool === next.onDenyTool &&
    previous.onApproveAllToolsForSession === next.onApproveAllToolsForSession &&
    previous.onManagedRuntimeProfileOutput ===
      next.onManagedRuntimeProfileOutput &&
    previous.onOpenVerifiedBuildPanel === next.onOpenVerifiedBuildPanel &&
    previous.onOpenRuntimePanel === next.onOpenRuntimePanel
  );
}
