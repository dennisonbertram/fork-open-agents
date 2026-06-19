import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { getChatById, getChatMessages } from "@/lib/db/sessions";
import { listInferenceProfiles } from "@/lib/db/inference-profiles";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  buildSessionChatModelOptions,
  withMissingModelOption,
} from "@/lib/model-options";
import { getAllVariants } from "@/lib/model-variants";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionChatProvider } from "@/app/sessions/[sessionId]/chats/[chatId]/session-chat-context";
import { MobileChatScreen } from "@/components/mobile/chat/mobile-chat-screen";

interface MobileChatPageProps {
  params: Promise<{ chatId: string }>;
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

/**
 * Retry-aware chat lookup. Mirrors the desktop getChatByIdWithRetry so
 * optimistically-created chat IDs (routed immediately after POST /sessions)
 * have time to land in the DB before we 404.
 */
async function getChatByIdWithRetry(
  chatId: string,
  sessionId?: string,
): Promise<Awaited<ReturnType<typeof getChatById>>> {
  const maxAttempts = isOptimisticChatId(chatId)
    ? OPTIMISTIC_CHAT_RETRY_ATTEMPTS
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const chat = await getChatById(chatId);
    if (chat && (sessionId === undefined || chat.sessionId === sessionId)) {
      return chat;
    }
    if (attempt < maxAttempts) {
      await sleep(OPTIMISTIC_CHAT_RETRY_DELAY_MS);
    }
  }
  return undefined;
}

async function getInitialModels() {
  try {
    return await fetchAvailableLanguageModelsWithContext();
  } catch {
    return [];
  }
}

/**
 * /m/chat/[chatId] — Mobile chat view.
 *
 * The mobile route only has chatId (not sessionId+chatId like the desktop
 * route). We look up the chat first to resolve the sessionId, verify
 * ownership, then boot the SessionChatProvider with initial messages and
 * model options — mirroring the desktop SessionChatPage pattern.
 */
export default async function MobileChatPage({ params }: MobileChatPageProps) {
  const { chatId } = await params;

  // Auth check first
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  // Step 1: resolve chatId -> sessionId. Retry for optimistic chat IDs so a
  // freshly-created chat (routed here right after POST /sessions) has time to
  // land in the DB before we 404.
  const chatInitial = await getChatByIdWithRetry(chatId);
  if (!chatInitial) {
    if (isOptimisticChatId(chatId)) {
      redirect("/m");
    }
    notFound();
  }

  const sessionId = chatInitial.sessionId;

  // Step 2: load session record for ownership check
  const sessionRecord = await getSessionByIdCached(sessionId);
  if (!sessionRecord) {
    notFound();
  }

  // Ownership check
  if (sessionRecord.userId !== session.user.id) {
    redirect("/m");
  }

  // Step 3: parallel fetch — retry-aware chat + messages + models + prefs
  const [chat, dbMessages, initialModels, rawPreferences, inferenceProfiles] =
    await Promise.all([
      getChatByIdWithRetry(chatId, sessionId),
      getChatMessages(chatId),
      getInitialModels(),
      getUserPreferences(session.user.id),
      listInferenceProfiles(session.user.id),
    ]);

  if (!chat) {
    if (isOptimisticChatId(chatId)) {
      redirect("/m");
    }
    notFound();
  }

  // Step 4: build model options (same pipeline as desktop)
  const initialMessages = dbMessages.map((m) => m.parts as WebAgentUIMessage);
  const modelVariants = getAllVariants(rawPreferences.modelVariants);
  const chatModelOptionId = getModelOptionSelectionId(
    chat.modelId,
    chat.inferenceProfileId,
  );
  const initialModelOptions = withMissingModelOption(
    buildSessionChatModelOptions(
      initialModels,
      modelVariants,
      inferenceProfiles,
    ),
    chatModelOptionId,
  );

  return (
    <SessionChatProvider
      session={sessionRecord}
      chat={chat}
      initialMessages={initialMessages}
      initialModelOptions={initialModelOptions}
    >
      <MobileChatScreen
        chatId={chatId}
        sessionId={sessionId}
        sessionTitle={sessionRecord.title}
        repoOwner={sessionRecord.repoOwner ?? null}
        repoName={sessionRecord.repoName ?? null}
        branch={sessionRecord.branch ?? null}
        cloneUrl={sessionRecord.cloneUrl ?? null}
      />
    </SessionChatProvider>
  );
}
