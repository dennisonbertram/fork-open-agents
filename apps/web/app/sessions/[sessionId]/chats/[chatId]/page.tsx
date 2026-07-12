import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { DiffsProvider } from "@/components/diffs-provider";
import {
  attachTimelineToMessage,
  getChatResponseTimelineMap,
} from "@/lib/db/chat-response-timelines";
import {
  getChatById,
  getChatMessages,
  getChatSummariesBySessionId,
} from "@/lib/db/sessions";
import { listInferenceProfiles } from "@/lib/db/inference-profiles";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  buildSessionChatModelOptions,
  withMissingModelOption,
} from "@/lib/model-options";
import { getAllVariants } from "@/lib/model-variants";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import { getServerSession } from "@/lib/session/get-server-session";
import { getProductSurfaceExposurePolicy } from "@/lib/product-surfaces/config";
import { getCodeEditorDisabledReason } from "@/lib/managed-runtime/code-editor-gate";
import { getManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import { resolveManagedRuntimeProfile } from "@/lib/managed-runtime/profile-resolution";
import { getInitialModels } from "./get-initial-models";
import { hasSelectableModelOptions } from "./has-selectable-model-options";
import { ModelAvailabilityBanner } from "./model-availability-banner";
import { getInitialIsOnlyChatInSession } from "./only-chat-in-session";
import { SessionChatContent } from "./session-chat-content";
import { SessionChatProvider } from "./session-chat-context";

export const maxDuration = 120;

interface SessionChatPageProps {
  params: Promise<{ sessionId: string; chatId: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOptimisticChatId(chatId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    chatId,
  );
}

const OPTIMISTIC_CHAT_RETRY_DELAY_MS = 100;
const OPTIMISTIC_CHAT_RETRY_ATTEMPTS = 50;

async function getChatByIdWithRetry(
  chatId: string,
  sessionId: string,
): Promise<Awaited<ReturnType<typeof getChatById>>> {
  const maxAttempts = isOptimisticChatId(chatId)
    ? OPTIMISTIC_CHAT_RETRY_ATTEMPTS
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const chat = await getChatById(chatId);
    if (chat && chat.sessionId === sessionId) {
      return chat;
    }
    if (attempt < maxAttempts) {
      await sleep(OPTIMISTIC_CHAT_RETRY_DELAY_MS);
    }
  }
  return undefined;
}

export async function generateMetadata({
  params,
}: SessionChatPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionRecord = await getSessionByIdCached(sessionId);

  return {
    title: sessionRecord?.title ?? `Session ${sessionId}`,
    description: "Review session progress, chats, and outputs.",
  };
}

export default async function SessionChatPage({
  params,
}: SessionChatPageProps) {
  const { sessionId, chatId } = await params;
  const productSurfaceExposure = getProductSurfaceExposurePolicy();

  // Start independent fetches in parallel
  const sessionPromise = getServerSession();
  const sessionRecordPromise = getSessionByIdCached(sessionId);

  // Server-side auth check
  const session = await sessionPromise;
  if (!session?.user) {
    redirect("/");
  }

  // Fetch session record
  const sessionRecord = await sessionRecordPromise;
  if (!sessionRecord) {
    notFound();
  }

  // Check ownership
  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  // Fetch chat, messages, models, preferences, and runtime profile in parallel
  const [
    chat,
    dbMessages,
    initialModelsResult,
    rawPreferences,
    sessionChats,
    inferenceProfiles,
    runtimeProfile,
    responseTimelineMap,
  ] = await Promise.all([
    getChatByIdWithRetry(chatId, sessionId),
    getChatMessages(chatId),
    getInitialModels({ sessionId, chatId, surface: "desktop" }),
    getUserPreferences(session.user.id),
    getChatSummariesBySessionId(sessionId, session.user.id),
    listInferenceProfiles(session.user.id),
    // MR-1 forward-shim (#808): unwrap the resolution union, preserving the
    // pre-MR-2 fall-back-to-default behavior. MR-2 (#811) replaces this with
    // fail-closed handling of an unresolvable profile.
    resolveManagedRuntimeProfile({
      userId: session.user.id,
      sessionId,
      profileId: sessionRecord.managedRuntimeProfileId,
    }).then((resolution) =>
      resolution.ok ? resolution.profile : getManagedRuntimeProfile(),
    ),
    getChatResponseTimelineMap(chatId),
  ]);

  if (!chat) {
    if (isOptimisticChatId(chatId)) {
      redirect(`/sessions/${sessionId}`);
    }
    notFound();
  }

  const initialMessages = dbMessages.map((m) =>
    attachTimelineToMessage(
      m.parts as WebAgentUIMessage,
      responseTimelineMap.get(m.id),
    ),
  );

  // Compute generation duration for each assistant message:
  // duration = assistant.createdAt − preceding user.createdAt
  const messageDurationMap: Record<string, number> = {};
  // Also store the preceding user message's createdAt so that a currently-
  // streaming message can show a live timer relative to when the user sent it.
  const messageStartedAtMap: Record<string, string> = {};
  for (let i = 0; i < dbMessages.length; i++) {
    const m = dbMessages[i];
    if (m.role === "assistant" && i > 0) {
      const prev = dbMessages[i - 1];
      if (prev && prev.role === "user") {
        messageDurationMap[m.id] =
          m.createdAt.getTime() - prev.createdAt.getTime();
        messageStartedAtMap[m.id] = prev.createdAt.toISOString();
      }
    }
  }

  // Fallback for refresh-during-stream: the streaming assistant message may
  // not be in the maps above (not yet persisted or different ID). Use the
  // last user message's createdAt so the timer still starts from the right
  // moment.
  const lastUserMessage = dbMessages
    .toReversed()
    .find((m) => m.role === "user");
  const lastUserMessageSentAt = lastUserMessage
    ? lastUserMessage.createdAt.toISOString()
    : null;
  const codeEditorDisabledReason = getCodeEditorDisabledReason(runtimeProfile);
  const preferences = rawPreferences;
  const modelVariants = getAllVariants(preferences.modelVariants);
  const chatModelId = chat.modelId;
  const chatModelOptionId = getModelOptionSelectionId(
    chatModelId,
    chat.inferenceProfileId,
  );
  const sessionChatModelOptions = buildSessionChatModelOptions(
    initialModelsResult.models,
    modelVariants,
    inferenceProfiles,
  );
  const modelsAvailable = hasSelectableModelOptions(sessionChatModelOptions);
  const initialModelOptions = withMissingModelOption(
    sessionChatModelOptions,
    chatModelOptionId,
  );

  const initialIsOnlyChatInSession = getInitialIsOnlyChatInSession(
    sessionChats,
    chat.id,
  );

  return (
    <DiffsProvider>
      <SessionChatProvider
        session={sessionRecord}
        chat={{ ...chat, modelId: chatModelId }}
        initialMessages={initialMessages}
        initialModelOptions={initialModelOptions}
      >
        {!modelsAvailable && (
          <div className="px-4 pt-4">
            <ModelAvailabilityBanner
              errorKind={initialModelsResult.errorKind}
              hasModels={modelsAvailable}
              retryHref={`/sessions/${sessionId}/chats/${chat.id}`}
            />
          </div>
        )}
        <SessionChatContent
          harnessEnabled={
            productSurfaceExposure.verifiedBuild &&
            process.env.HARNESS_ENABLED === "true"
          }
          workflowCatalogExposed={productSurfaceExposure.workflowCatalog}
          initialIsOnlyChatInSession={initialIsOnlyChatInSession}
          messageDurationMap={messageDurationMap}
          messageStartedAtMap={messageStartedAtMap}
          lastUserMessageSentAt={lastUserMessageSentAt}
          codeEditorDisabledReason={codeEditorDisabledReason}
        />
      </SessionChatProvider>
    </DiffsProvider>
  );
}
