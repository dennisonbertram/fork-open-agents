# STORY-002 Walk Report: Authenticated User Moves Through Settings Sections

Walked: 2026-06-21
Target: `http://localhost:3002/settings/*`
Browser: authenticated in-app browser tab
Status: pass with one logged non-fixed finding

## Steps

1. Started at `/settings/models`.
   - Result: settings rail and Models content were visible.
   - Evidence: `snapshots/step-1-models-start.txt`.
2. Clicked Preferences.
   - Result: Preferences page loaded with the settings rail intact.
   - Evidence: `snapshots/step-2-preferences.txt`.
3. Clicked Connections.
   - Result: Connections page loaded with Vercel/GitHub connection content.
   - Evidence: `snapshots/step-3-connections.txt`.
4. Clicked Models.
   - Result: Models page loaded.
   - Evidence: `snapshots/step-4-models.txt`.
5. Clicked MCP servers.
   - Result: initial snapshot caught a transient compile/navigation state, then the next route navigation recovered cleanly.
   - Evidence: `snapshots/step-5-mcp.txt`, `snapshots/step-5-mcp-recheck.txt`.
6. Clicked Usage.
   - Result: Usage page loaded with metrics and a large clickable chart.
   - Evidence: `snapshots/step-6-usage.txt`.
7. Checked console errors after each route.
   - Result: no browser console errors were recorded.

## Findings

- `F-STORY-002-001`: Usage chart exposes a very large number of individual day buttons in the accessibility tree. This may be too noisy for keyboard and screen-reader users. It was logged for later design/accessibility review, not quick-fixed in this pass.
