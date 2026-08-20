# STORY-158 walk — 2026-08-20 (local, after #1390)

**Story:** STORY-158 / STORY-202 — Standalone session via the full New Session dialog.
**Ideal path:** 2 (open dialog, Start session).
**Actual path:** 2.
**Auth:** `GET /api/dev/test-auth?next=/sessions` (cookie-only bootstrap from #1390).
**Target:** `http://localhost:3000` — **not** Dev or Production.

This is a local proof that the unblocked bootstrap + reconnect short-circuit
lets the catalog story complete. It is **not** slice 6 (unattended cloud
session against Dev). That remains blocked on slice 5.

## Live environment probes (slice 5 still blocked)

| Target | `GET /api/dev/test-auth` | Meaning |
| --- | --- | --- |
| PR Preview `…c05212…vercel.app` | `404` JSON `{error:"Not found",errorKind:"not_found"}`, `x-matched-path: /api/dev/test-auth` | New route is deployed; flag is **off** |
| Dev `open-agents-env-dev-dennisons-projects.vercel.app` | HTML 404, `x-matched-path: /404`, deploy `dpl_4j7yWJeZCNtkPi5qGJjZUiNPL2C5` | Merge `f1f918b4` had **not** reached this URL yet |
| Production `open-agents.dev` | HTML 404, `x-matched-path: /404` | Route not in the last Production deploy (`a9e9e780`) — correct until a release |

This VM has no `VERCEL_TOKEN` and `vercel whoami` is logged out. The Dev env
flip was **not** performed and was **not** faked.

Operator command once logged in (Development environment only):

```bash
vercel env add OPEN_AGENTS_ENABLE_TEST_AUTH development \
  --scope dennisons-projects \
  --project open-agents \
  --value 1 \
  --yes
```

Do **not** add it to Production. Redeploy Dev after the var is set. Then
`GET https://open-agents-env-dev-dennisons-projects.vercel.app/api/dev/test-auth`
must return `200` + `Set-Cookie`, while `https://open-agents.dev/api/dev/test-auth`
must stay 404 (route absent until release) or JSON 404 (guard) if someone
mistakenly sets the flag there.

## Walk

Bootstrap: `agent-browser` opened `/api/dev/test-auth?next=/sessions` → 307 →
`/sessions` as `managed-runtime-demo`. No `GitHubReconnectGate`.

| Step | Action | Result |
| --- | --- | --- |
| 1 | Click sidebar **New session** | Dialog: Standalone tab, classic runtime checked, **Start session** |
| 2 | Click **Start session** | `/sessions/NyWcJQyHYwVjIULrG9VD0/chats/FC9-_NefwAEjv1iFUdHKf` (sidebar: Bengaluru; Active 3→4) |

Composer started disabled while the chat shell loaded — expected, not a extra
story step.

Screenshots: [walk-story-158/screenshots](walk-story-158/screenshots/).

## What this does not prove

- Dev test-auth (slice 5)
- An unattended `open_agents_start_session` cloud walk (slice 6)
- Production refusal of a live `OPEN_AGENTS_ENABLE_TEST_AUTH=1` (flag must
  never be set there; the code guard is covered by tests)
