# STORY-017 Walk Report: User Reviews Usage And Leaderboard

Walked: 2026-06-22
Target: `http://localhost:3002/settings/usage`
Browser: authenticated in-app browser tab
Status: pass

## Steps

1. Opened `/settings/usage`.
   - Result: usage page rendered total tokens, estimated cost, messages, tool calls, agent split, model breakdown, and usage insights.
   - Evidence: `snapshots/step-1-usage-page.txt`, `snapshots/step-3-usage-visible-text.txt`.
2. Inspected the usage chart accessibility tree.
   - Result: page exposed 289 buttons, with most focusable controls representing individual date bars.
   - Evidence: `snapshots/step-2-usage-page-summary.json`.
3. Selected the latest chart day.
   - Result: usage page changed to `Showing activity for Jun 22, 2026`, updated totals, and exposed `Clear filter`.
   - Evidence: `snapshots/step-4-usage-filtered-latest-day.json`.
4. Opened `/settings/leaderboard`.
   - Result: page rendered a clear no-domain empty state: `No leaderboard yet` and work-email-domain guidance.
   - Evidence: `snapshots/step-5-leaderboard-page.txt`, `snapshots/step-6-leaderboard-visible-text.json`.
5. Checked browser logs around the leaderboard route.
   - Result: no fresh route-specific errors appeared; log entries were expected dev analytics/HMR messages.
   - Evidence: `snapshots/step-7-leaderboard-browser-logs.json`.
6. Checked the signed-in user's public profile route.
   - Result: `/u/dennison-9116` rendered a private-profile state because public usage is disabled for the account.
   - Evidence: `snapshots/step-8-public-profile-user.json`, `snapshots/step-9-public-profile-route.txt`, `snapshots/step-10-public-profile-visible-text.json`.

## Findings

- `F-STORY-017-001`: Usage chart exposes too many individual date bars as focusable buttons.

## Notes

The core usage and leaderboard paths pass. The chart is functionally usable and has per-date labels, but the number of focusable date buttons makes keyboard and screen-reader navigation inefficient.
