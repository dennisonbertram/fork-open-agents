import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelAvailabilityBanner } from "./model-availability-banner";

describe("ModelAvailabilityBanner", () => {
  test("fetch-failed: renders blocking banner with settings link and retry", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind="fetch_failed"
        hasModels={false}
        retryHref="/sessions/session-1/chats/chat-1"
      />,
    );

    expect(html.toLowerCase()).toContain("check available models");
    expect(html).toContain('href="/settings/models"');
    expect(html.toLowerCase()).toContain("retry");
    expect(html).toContain('role="alert"');
  });

  test("fetch-failed: retry link points at the caller-provided concrete chat URL, not the parent directory", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind="fetch_failed"
        hasModels={false}
        retryHref="/sessions/session-1/chats/chat-1"
      />,
    );

    expect(html).toContain('href="/sessions/session-1/chats/chat-1"');
    expect(html).not.toContain('href="."');
  });

  test("fetch-failed: mobile retryHref points at the concrete /m/chat/<chatId> URL", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind="fetch_failed"
        hasModels={false}
        retryHref="/m/chat/chat-1"
      />,
    );

    expect(html).toContain('href="/m/chat/chat-1"');
  });

  test("empty-but-successful: renders distinct banner with settings link, no retry", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind={null}
        hasModels={false}
        retryHref="/sessions/session-1/chats/chat-1"
      />,
    );

    expect(html.toLowerCase()).toContain("no models are configured yet");
    expect(html).toContain('href="/settings/models"');
    expect(html.toLowerCase()).not.toContain("retry");
    expect(html).toContain('role="status"');
  });

  test("present-models: renders no banner", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind={null}
        hasModels={true}
        retryHref="/sessions/session-1/chats/chat-1"
      />,
    );

    expect(html).toBe("");
  });

  test("present-models with a stale errorKind still renders nothing", () => {
    const html = renderToStaticMarkup(
      <ModelAvailabilityBanner
        errorKind="fetch_failed"
        hasModels={true}
        retryHref="/sessions/session-1/chats/chat-1"
      />,
    );

    expect(html).toBe("");
  });
});
