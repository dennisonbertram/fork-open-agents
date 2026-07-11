/**
 * Helpers for showing, in plain language, which Composio tools a specific chat
 * (sandbox) can actually use — so the per-chat tool selector shows the real
 * toolkits, not just an opaque profile name.
 */

/**
 * Disclaimer shown in the chat tool selector popover (#803 item 7, C4) —
 * the selector only shows what is *selected* for this chat, never a live
 * connection check. This static caption distinguishes "selected" from
 * "connected" without adding any per-item live-status behavior.
 */
export const SELECTED_NOT_CONNECTED_CAPTION =
  "Selected for this chat — connection status shown in Settings → Composio.";

/** Turn a toolkit slug ("github", "web_search") into a readable name ("Github", "Web search"). */
export function prettifyToolkitSlug(slug: string): string {
  const cleaned = slug.trim().replace(/[_-]+/g, " ").trim();
  if (!cleaned) {
    return slug;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Human summary of the toolkits a chat can use.
 * - [] -> "No tools"
 * - ["gmail"] -> "Gmail"
 * - ["gmail","web_search"] -> "Gmail, Web search"
 * - more than `max` -> "Gmail, Linear +2 more"
 */
export function summarizeChatTools(slugs: string[], max = 3): string {
  if (slugs.length === 0) {
    return "No tools";
  }
  const names = slugs.map(prettifyToolkitSlug);
  if (names.length <= max) {
    return names.join(", ");
  }
  const shown = names.slice(0, max).join(", ");
  return `${shown} +${names.length - max} more`;
}
