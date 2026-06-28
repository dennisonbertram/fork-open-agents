"use client";

import { ArrowDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefCallback,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScrollPosition = "start" | "first-anchor" | "last-anchor" | "end";

type MessageScrollerContextValue = {
  atStart: boolean;
  atEnd: boolean;
  autoScroll: boolean;
  contentRef: RefCallback<HTMLDivElement>;
  defaultScrollPosition: ScrollPosition;
  registerItem: (
    messageId: string,
    node: HTMLDivElement | null,
    options?: { role?: string; scrollAnchor: boolean },
  ) => void;
  scrollPreviousItemPeek: number;
  scrollToEnd: (behavior?: ScrollBehavior) => boolean;
  scrollToMessage: (messageId: string, behavior?: ScrollBehavior) => boolean;
  scrollToStart: (behavior?: ScrollBehavior) => boolean;
  viewportRef: RefCallback<HTMLDivElement>;
};

const MessageScrollerContext =
  createContext<MessageScrollerContextValue | null>(null);

function useMessageScrollerContext() {
  const context = useContext(MessageScrollerContext);
  if (!context) {
    throw new Error(
      "MessageScroller components must be used within MessageScrollerProvider",
    );
  }
  return context;
}

type RegisteredItem = {
  node: HTMLDivElement;
  role?: string;
  scrollAnchor: boolean;
};

export function MessageScrollerProvider({
  autoScroll = true,
  defaultScrollPosition = "last-anchor",
  scrollPreviousItemPeek = 48,
  children,
}: {
  autoScroll?: boolean;
  defaultScrollPosition?: ScrollPosition;
  scrollPreviousItemPeek?: number;
  children: ReactNode;
}) {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const contentElementRef = useRef<HTMLDivElement | null>(null);
  const itemMapRef = useRef(new Map<string, RegisteredItem>());
  const itemOrderRef = useRef<string[]>([]);
  const previousLastItemIdRef = useRef<string | null>(null);
  const hasMountedScrollRef = useRef(false);
  const isAtEndRef = useRef(true);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateScrollState = useCallback(() => {
    const viewport = viewportElementRef.current;
    if (!viewport) {
      return;
    }
    const nextAtStart = viewport.scrollTop < 8;
    const nextAtEnd =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96;
    isAtEndRef.current = nextAtEnd;
    setAtStart(nextAtStart);
    setAtEnd(nextAtEnd);
  }, []);

  const scrollToStart = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportElementRef.current;
    if (!viewport) {
      return false;
    }
    viewport.scrollTo({ top: 0, behavior });
    return true;
  }, []);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportElementRef.current;
    if (!viewport) {
      return false;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    return true;
  }, []);

  const scrollToMessage = useCallback(
    (messageId: string, behavior: ScrollBehavior = "smooth") => {
      const viewport = viewportElementRef.current;
      const item = itemMapRef.current.get(messageId);
      if (!(viewport && item)) {
        return false;
      }
      viewport.scrollTo({
        top: Math.max(0, item.node.offsetTop - scrollPreviousItemPeek),
        behavior,
      });
      return true;
    },
    [scrollPreviousItemPeek],
  );

  const getAnchoredItemIds = useCallback(
    () =>
      itemOrderRef.current.filter(
        (messageId) => itemMapRef.current.get(messageId)?.scrollAnchor,
      ),
    [],
  );

  const applyDefaultScrollPosition = useCallback(() => {
    const anchorIds = getAnchoredItemIds();
    if (defaultScrollPosition === "start") {
      scrollToStart("auto");
      return;
    }
    if (defaultScrollPosition === "first-anchor" && anchorIds[0]) {
      scrollToMessage(anchorIds[0], "auto");
      return;
    }
    if (defaultScrollPosition === "last-anchor" && anchorIds.at(-1)) {
      scrollToMessage(anchorIds.at(-1) as string, "auto");
      return;
    }
    scrollToEnd("auto");
  }, [
    defaultScrollPosition,
    getAnchoredItemIds,
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
  ]);

  const handleContentChange = useCallback(() => {
    const itemIds = itemOrderRef.current;
    const lastItemId = itemIds.at(-1) ?? null;
    const previousLastItemId = previousLastItemIdRef.current;

    if (!hasMountedScrollRef.current) {
      hasMountedScrollRef.current = true;
      previousLastItemIdRef.current = lastItemId;
      requestAnimationFrame(() => {
        applyDefaultScrollPosition();
        updateScrollState();
      });
      return;
    }

    const hasNewLastItem = Boolean(
      lastItemId && previousLastItemId && lastItemId !== previousLastItemId,
    );
    previousLastItemIdRef.current = lastItemId;

    if (!(autoScroll && isAtEndRef.current)) {
      return;
    }

    requestAnimationFrame(() => {
      const lastItem = lastItemId ? itemMapRef.current.get(lastItemId) : null;
      if (hasNewLastItem && lastItem?.scrollAnchor && lastItemId) {
        scrollToMessage(lastItemId, "smooth");
        return;
      }
      scrollToEnd("smooth");
    });
  }, [
    applyDefaultScrollPosition,
    autoScroll,
    scrollToEnd,
    scrollToMessage,
    updateScrollState,
  ]);

  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = viewportElementRef.current;
      previous?.removeEventListener("scroll", updateScrollState);
      viewportElementRef.current = node;
      if (node) {
        node.addEventListener("scroll", updateScrollState, { passive: true });
        updateScrollState();
      }
    },
    [updateScrollState],
  );

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    contentElementRef.current = node;
  }, []);

  const registerItem = useCallback(
    (
      messageId: string,
      node: HTMLDivElement | null,
      options?: { role?: string; scrollAnchor: boolean },
    ) => {
      if (node) {
        itemMapRef.current.set(messageId, {
          node,
          role: options?.role,
          scrollAnchor: options?.scrollAnchor ?? false,
        });
      } else {
        itemMapRef.current.delete(messageId);
      }
      itemOrderRef.current = Array.from(itemMapRef.current.keys());
      handleContentChange();
    },
    [handleContentChange],
  );

  useEffect(() => {
    const viewport = viewportElementRef.current;
    const content = contentElementRef.current;
    if (!(viewport && content)) {
      return;
    }

    const resizeObserver = new ResizeObserver(handleContentChange);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    return () => resizeObserver.disconnect();
  }, [handleContentChange]);

  const value = useMemo<MessageScrollerContextValue>(
    () => ({
      atStart,
      atEnd,
      autoScroll,
      contentRef,
      defaultScrollPosition,
      registerItem,
      scrollPreviousItemPeek,
      scrollToEnd,
      scrollToMessage,
      scrollToStart,
      viewportRef,
    }),
    [
      atStart,
      atEnd,
      autoScroll,
      contentRef,
      defaultScrollPosition,
      registerItem,
      scrollPreviousItemPeek,
      scrollToEnd,
      scrollToMessage,
      scrollToStart,
      viewportRef,
    ],
  );

  return (
    <MessageScrollerContext.Provider value={value}>
      {children}
    </MessageScrollerContext.Provider>
  );
}

export function useMessageScroller() {
  const { scrollToEnd, scrollToMessage, scrollToStart } =
    useMessageScrollerContext();

  return {
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
  };
}

export function useMessageScrollerScrollable() {
  const { atStart, atEnd } = useMessageScrollerContext();

  return {
    start: !atStart,
    end: !atEnd,
  };
}

export function MessageScroller({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn("relative flex min-h-0 flex-1 overflow-hidden", className)}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<"div">) {
  const { viewportRef } = useMessageScrollerContext();

  return (
    <div
      data-slot="message-scroller-viewport"
      ref={viewportRef}
      className={cn(
        "scroll-fade-y h-full min-h-0 flex-1 overflow-y-auto",
        className,
      )}
      {...props}
    />
  );
}

export function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<"div">) {
  const { contentRef } = useMessageScrollerContext();

  return (
    <div
      data-slot="message-scroller-content"
      ref={contentRef}
      className={className}
      {...props}
    />
  );
}

export function MessageScrollerItem({
  className,
  messageId,
  role,
  scrollAnchor,
  ...props
}: ComponentProps<"div"> & {
  messageId: string;
  role?: string;
  scrollAnchor?: boolean;
}) {
  const { registerItem } = useMessageScrollerContext();
  const isScrollAnchor = scrollAnchor ?? role === "user";

  const itemRef = useCallback(
    (node: HTMLDivElement | null) => {
      registerItem(messageId, node, { role, scrollAnchor: isScrollAnchor });
    },
    [isScrollAnchor, messageId, registerItem, role],
  );

  return (
    <div
      data-message-id={messageId}
      data-message-role={role}
      data-scroll-anchor={isScrollAnchor ? "" : undefined}
      data-slot="message-scroller-item"
      ref={itemRef}
      className={className}
      {...props}
    />
  );
}

export function MessageScrollerButton({
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const { atEnd, scrollToEnd } = useMessageScrollerContext();

  if (atEnd) {
    return null;
  }

  return (
    <Button
      aria-label="Scroll to latest message"
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary text-secondary-foreground shadow-sm hover:bg-accent",
        className,
      )}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) {
          scrollToEnd();
        }
      }}
    >
      {children ?? <ArrowDown className="h-4 w-4" />}
    </Button>
  );
}

export { useMessageScrollerContext };
