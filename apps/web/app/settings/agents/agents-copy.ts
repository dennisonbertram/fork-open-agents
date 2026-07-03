/**
 * Plain-language copy reconciling the "External tools" field's "None
 * connected" state with the fact that Composio profiles may already exist
 * elsewhere in the account (#803 item 5, W4). Extracted as pure string
 * constants so the copy is locked by a test independent of React rendering.
 */

/** Shown in place of "None connected" when no profile is assigned to this agent. */
export const EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL = "None assigned to this agent";

/**
 * Hint shown beneath the field (mirrors the existing "Built-in file editing
 * & commands are always on." hint pattern) — reconciles W4: "profiles exist"
 * is not "assigned to this agent."
 */
export const EXTERNAL_TOOLS_NONE_ASSIGNED_HINT =
  "Tool profiles you've created in Settings → Composio aren't used until you assign one here.";
