# STORY-013 Walk Report: User Registers An MCP Server

Walked: 2026-06-22
Target: `http://localhost:3002/settings/mcp`
Browser: authenticated in-app browser tab
Status: pass

## Steps

1. Opened `/settings/mcp`.
   - Result: MCP servers page rendered with the registered-server empty state and Add server action.
   - Evidence: `snapshots/step-1-mcp-settings-empty.txt`.
2. Opened Add server.
   - Result: inline editor rendered Name, URL, Transport, Auth headers, Register, and Cancel.
   - Evidence: `snapshots/step-2-add-server-form.txt`.
3. Entered an invalid `ftp://` URL and tried to register.
   - Result: form stayed open and showed the allowed URL formats: `https://`, `http://localhost`, or `http://127.0.0.1`.
   - Evidence: `snapshots/step-3-invalid-url-validation.txt`.
4. Added a local HTTP URL and an Authorization header.
   - Result: header row accepted name/value input and the temporary server registered successfully.
   - Evidence: `snapshots/step-4-valid-form-with-header.txt` and `snapshots/step-5-server-created.txt`.
5. Opened the saved server for editing.
   - Result: server fields were editable, header key remained visible, and header value was write-only/blank with explanatory copy.
   - Evidence: `snapshots/step-6-edit-existing-server.txt`.
6. Disabled and re-enabled a temporary server.
   - Result: the switch label changed from `Disable ...` to `Enable ...` when disabled, then back to `Disable ...` when re-enabled.
   - Evidence: `snapshots/step-7-server-disabled-settled.txt` and `snapshots/step-8-server-reenabled-settled.txt`.
7. Deleted the temporary servers.
   - Result: inline delete confirmation appeared, Confirm removed the server, and the empty state returned.
   - Evidence: `snapshots/step-9-delete-confirmation.txt`, `snapshots/step-10-server-deleted-empty.txt`, `snapshots/step-9b-delete-toggle-confirmation.txt`, and `snapshots/step-11-toggle-server-cleanup.txt`.

## Findings

None.

## Notes

The console evidence contains Fast Refresh and a prior hydration mismatch from live code edits in another chat tab during this run. No MCP-specific console or network failure appeared during create, validation, toggle, or delete.
