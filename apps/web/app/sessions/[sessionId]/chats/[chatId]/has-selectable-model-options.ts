import type { ModelOption } from "@/lib/model-options";

/**
 * Whether the chat has at least one selectable model option available.
 *
 * Chat pages must gate the `ModelAvailabilityBanner` "no models" state on the
 * full set of options a user can pick from — gateway catalog models *and*
 * user inference profiles (see `buildSessionChatModelOptions`) — not just
 * the gateway catalog's model count. A user with a usable own-key inference
 * profile still has selectable models even when the gateway catalog fetch
 * fails or returns an empty list.
 */
export function hasSelectableModelOptions(
  sessionChatModelOptions: readonly ModelOption[],
): boolean {
  return sessionChatModelOptions.length > 0;
}
