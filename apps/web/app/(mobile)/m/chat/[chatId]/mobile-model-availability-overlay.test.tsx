import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileModelAvailabilityOverlay } from "./mobile-model-availability-overlay";

describe("MobileModelAvailabilityOverlay", () => {
  test("renders the banner inside a fixed, full-width overlay wrapper so it does not add to document height", () => {
    // Regression: MobileChatScreen's root is `h-dvh` (full viewport height).
    // Rendering the banner as a normal in-flow sibling before it pushes the
    // whole chat screen — including the composer — below the initial
    // viewport. The wrapper must be `fixed` so it overlays instead of
    // adding height.
    const html = renderToStaticMarkup(
      <MobileModelAvailabilityOverlay
        errorKind="fetch_failed"
        hasModels={false}
        retryHref="/m/chat/chat-1"
      />,
    );

    expect(html).toContain('class="fixed inset-x-0 top-0 z-50 px-4 pt-4"');
  });

  test("renders nothing but the wrapper's own markup when models are present (banner itself renders null)", () => {
    const html = renderToStaticMarkup(
      <MobileModelAvailabilityOverlay
        errorKind={null}
        hasModels={true}
        retryHref="/m/chat/chat-1"
      />,
    );

    expect(html).toContain('class="fixed inset-x-0 top-0 z-50 px-4 pt-4"');
    expect(html.toLowerCase()).not.toContain("no models are configured");
  });
});
