# STORY-012 Walk Report: User Configures Composio Tools

Walked: 2026-06-22
Target: `http://localhost:3002/settings/composio` and repo chat tool selector
Browser: authenticated in-app browser tab
Status: pass after quick fix

## Steps

1. Opened `/settings/composio`.
   - Result: Composio settings rendered with connected status, GitHub connected, suggestions, the saved Email profile, and agent default controls.
   - Evidence: `snapshots/step-1-composio-settings.txt`.
2. Searched for `github` in the tool catalog.
   - Result: GitHub showed as connected, DeepWiki appeared as no-auth, and setup links remained available.
   - Evidence: `snapshots/step-2-search-github.txt`.
3. Opened the saved Email profile.
   - Result: the profile editor showed Gmail selected with a `not connected` warning.
   - Evidence: `snapshots/step-3-edit-profile.txt`.
4. Searched for `github` inside the profile editor.
   - Result: profile search showed connected GitHub and no-auth DeepWiki options.
   - Evidence: `snapshots/step-4-profile-search-github.txt`.
5. Canceled profile editing.
   - Result: returned to the Composio settings page without changing the saved profile.
   - Evidence: `snapshots/step-5-profile-cancel.txt`.
6. Opened the compact tool selector in a repo chat.
   - Result: the saved Email profile appeared selectable even though Gmail was disconnected.
   - Evidence: `snapshots/step-6-chat-tool-selector.txt`.
7. Applied quick fix for profile availability in the chat selector.
   - Result: the chat selector disabled Email and showed `Tool not connected: gmail.`
   - Evidence: `snapshots/step-8-chat-tool-selector-after-disconnected-fix.txt`.

## Findings

- `F-STORY-012-001`: Saved Composio profiles needed disconnected-tool availability checks at chat selection time.

## Notes

The settings page already showed toolkit connection state correctly. The gap was the compact point-of-use selector, where stale saved profile options could be selected without surfacing the missing connected account.
