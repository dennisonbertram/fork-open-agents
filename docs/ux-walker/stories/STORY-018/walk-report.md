# STORY-018 Walk Report: User Shares A Chat And Opens The Public View

Walked: 2026-06-22
Target: `http://localhost:3002/sessions/mF8hLjVC-wpSKuRtjRnho/chats/TXPxfLToApEx1IH7Jrbng`
Browser: authenticated in-app browser tab plus anonymous HTTP fetch
Status: pass

## Steps

1. Opened an existing repo chat.
   - Result: chat loaded with readable messages and a clearly labeled `Share chat` header control.
   - Evidence: `snapshots/step-1-chat-with-share-control.txt`.
2. Opened share controls.
   - Result: dialog showed the pre-share state with `Create share link`.
   - Evidence: `snapshots/step-2-share-dialog.txt`.
3. Created a share link.
   - Result: dialog changed to link-management state with `Copy link`, `Revoke link`, and `Close`.
   - Evidence: `snapshots/step-3-share-link-created.txt`, `snapshots/step-4-share-dialog-page-info.json`.
4. Opened `/shared/-S0MKpadTzy6` while authenticated as the owner.
   - Result: shared transcript rendered with repo metadata, model metadata, messages, and an owner-only `Open session` banner.
   - Evidence: `snapshots/step-5-shared-public-view.txt`, `snapshots/step-6-shared-public-view-details.json`.
5. Fetched the shared route anonymously without browser cookies.
   - Result: public transcript was readable and did not include `Open session`, share dialog controls, or the private chat composer.
   - Evidence: `snapshots/step-7-anonymous-shared-public-view.json`.
6. Revoked the share link by deleting the local share row after evidence capture.
   - Result: `/shared/-S0MKpadTzy6` returned a standard 404.
   - Evidence: `snapshots/step-8-revoked-share-unavailable.json`.
7. Checked browser logs.
   - Result: no fresh story-specific console errors; recent logs were expected development analytics/HMR messages.
   - Evidence: `snapshots/step-9-browser-logs.json`.

## Findings

None.

## Notes

The share link was intentionally revoked after verification so the real chat is not left publicly available.
