/**
 * Plain-language copy reconciling the "External tools" field's "None
 * connected" state with the fact that Composio profiles may already exist
 * elsewhere in the account (#803 item 5, W4). Extracted as pure string
 * constants so the copy is locked by a test independent of React rendering.
 */

/** Shown in place of "None connected" when no profile is assigned to this agent. */
export const EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL = "None assigned to this role";

/**
 * Hint shown beneath the field (mirrors the existing "Built-in file editing
 * & commands are always on." hint pattern) — reconciles W4: "profiles exist"
 * is not "assigned to this agent."
 *
 * Verified (Codex P2-1 on PR #851): this page's editor (AgentEditor in
 * agents-section.tsx) only exposes a toolkit picker writing
 * composioToolkitSlugs — there is no profile-selector control here, so a
 * hint saying "assign one here" pointed at a recovery action that doesn't
 * exist on this page. The only UI that sets a per-role default profile is
 * the "Agent defaults" picker on Settings → Composio
 * (composio-section.tsx, defaultProfileId). This hint points there instead,
 * and names the action this page's own editor actually supports.
 */
export const EXTERNAL_TOOLS_NONE_ASSIGNED_HINT =
  "Pick tools directly below, or set a default profile in Settings → Composio's Chat role defaults.";
