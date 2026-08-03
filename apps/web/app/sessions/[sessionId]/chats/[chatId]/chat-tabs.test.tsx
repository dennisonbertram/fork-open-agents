import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let layoutValue: Record<string, unknown> = {};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ sessionId: "session-1" }),
}));

mock.module("@/app/sessions/[sessionId]/session-layout-context", () => ({
  useSessionLayout: () => layoutValue,
}));

mock.module("./git-panel-context", () => ({
  useGitPanel: () => ({
    activeView: "chat",
    setActiveView: () => undefined,
    focusedDiffFile: null,
    setFocusedDiffFile: () => undefined,
    changesTabDismissed: true,
    setChangesTabDismissed: () => undefined,
    focusedFilePath: null,
    setFocusedFilePath: () => undefined,
    fileTabDismissed: true,
    setFileTabDismissed: () => undefined,
  }),
}));

mock.module("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const { ChatTabs } = await import("./chat-tabs");

function renderTabs(value: Record<string, unknown>) {
  layoutValue = {
    chats: [],
    chatsLoading: false,
    chatsError: null,
    createChat: () => ({
      chat: { id: "chat-1" },
      persisted: Promise.resolve(),
    }),
    switchChat: () => undefined,
    deleteChat: async () => undefined,
    renameChat: async () => undefined,
    retryChats: () => undefined,
    ...value,
  };
  return renderToStaticMarkup(<ChatTabs activeChatId="" />);
}

describe("ChatTabs chat list failure state", () => {
  test("renders a load-failure state with retry when the chat list fetch failed", () => {
    const markup = renderTabs({ chatsError: new Error("boom") });

    expect(markup).toContain("Couldn&#x27;t load chats");
    expect(markup).toContain("Retry");
  });

  test("keeps stale chat tabs and pins the failure outside the scrollable strip", () => {
    // SWR keeps `data` when a revalidation fails, so cached chats and an error
    // arrive together. The chats must stay, but the failure must not be pushed
    // off-screen to the right of the horizontally scrolling tab strip.
    const markup = renderTabs({
      chatsError: new Error("boom"),
      chats: [
        { id: "chat-1", title: "Alpha" },
        { id: "chat-2", title: "Beta" },
      ],
    });

    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
    expect(markup).toContain("Couldn&#x27;t load chats");
    // The new-chat "+" button is the last element inside the scroll strip, so
    // the failure rendering after it means it sits outside the strip.
    expect(markup.indexOf("Couldn&#x27;t load chats")).toBeGreaterThan(
      markup.indexOf("lucide-plus"),
    );
  });

  test("renders no failure state for a genuinely empty chat list", () => {
    const markup = renderTabs({ chatsError: null });

    expect(markup).not.toContain("Couldn&#x27;t load chats");
    expect(markup).not.toContain("Retry");
  });
});
