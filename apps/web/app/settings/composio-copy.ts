/**
 * Plain-language copy for the Composio settings surfaces (#803, epic #796
 * T7). Extracted as pure string constants so the copy is locked by tests
 * independent of React rendering — this is a copy-only change, no behavior.
 */

/** "Tool profiles" section description (item 2). */
export const TOOL_PROFILES_DESCRIPTION =
  "Named bundles of external tools (Gmail, Slack, Linear, and more). Assign a profile to an agent below so background agents and loops use those tools automatically — or pick tools directly in a chat.";

/** Empty "Tool profiles" state copy (item 3). */
export const EMPTY_TOOL_PROFILES_TEXT =
  "No tool profiles yet. A profile is a named bundle of external tools (like Gmail or Slack) you can hand to an agent or pick in a chat — create one to get started.";

/** "Bring your own auth" disclosure title (item 4). */
export const BRING_YOUR_OWN_AUTH_TITLE =
  "Use your own login credentials (advanced)";

/** One-line explainer directly beneath the "Bring your own auth" title (item 4). */
export const BRING_YOUR_OWN_AUTH_EXPLAINER =
  "Skip Composio's shared connection and authenticate this app with your own account instead.";
