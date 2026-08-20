# Learnings (repo-wide)

Short cross-cutting notes. Detailed entries live in
[`docs/agents/lessons-learned.md`](agents/lessons-learned.md).

## 2026-08-20 — UX catalog walk

- First live browser pass of `docs/ux-paths/browser/catalog.md` is worth
  repeating: it contradicted static critique F-025 and filed four defects
  (#1384–#1387). Report: `docs/ux-paths/browser/walk-2026-08-20.md`.
- Cloud self-walk of the same catalog is **not** ready: Playwright browser
  tools exist and auto-approve unattended, but there is no authenticated
  target (sandbox cannot host the app+DB; deployed test-auth is not safely
  enabled; browser tools cannot set cookies). Plan:
  `docs/plans/cloud-ux-walk.md`.
- Never enable `OPEN_AGENTS_ENABLE_TEST_AUTH` on Production. On Dev/Preview it
  also requires Sign out to clear the cookie (#1386).
