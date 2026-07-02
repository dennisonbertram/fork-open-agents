import {
  ModelAvailabilityBanner,
  type ModelAvailabilityBannerProps,
} from "@/app/sessions/[sessionId]/chats/[chatId]/model-availability-banner";

/**
 * Wraps `ModelAvailabilityBanner` for the mobile chat route as a `fixed`
 * overlay rather than an in-flow sibling.
 *
 * `MobileChatScreen`'s root is `h-dvh` (a full viewport-height flex column).
 * Rendering the banner as a normal sibling before it adds banner height to
 * the document, pushing `MobileChatScreen` (and its composer) below the
 * initial viewport. Fixed-positioning the banner keeps document height
 * unchanged so the full-screen chat layout still fits the viewport.
 */
export function MobileModelAvailabilityOverlay(
  props: ModelAvailabilityBannerProps,
) {
  return (
    <div className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
      <ModelAvailabilityBanner {...props} />
    </div>
  );
}
