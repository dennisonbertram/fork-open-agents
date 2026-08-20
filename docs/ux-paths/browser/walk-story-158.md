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

This VM has no `VERCEL_TOKEN` and `vercel whoami` is logged out. The hosted
Dev env flip cannot be performed from here.

### Operator action 2026-08-20 22:52 local — wrong Vercel target

The logged-in laptop ran:

```bash
vercel env add OPEN_AGENTS_ENABLE_TEST_AUTH development \
  --scope dennisons-projects \
  --project open-agents \
  --value 1 \
  --yes
```

CLI 56.5.0 reported: added, project `dennisons-projects/open-agents`,
environments **Development**, type non-sensitive.

That is Vercel’s built-in `development` scope (the source for `vercel env
pull` / `vercel dev`). It is **not** the custom environment named `dev`
that serves
`https://open-agents-env-dev-dennisons-projects.vercel.app`
([setup notes](../../deployment/vercel-open-agents-setup.md)).

Reprobe at 2026-08-20 20:54 UTC, after that add:

| Target | `GET /api/dev/test-auth` | Meaning |
| --- | --- | --- |
| Dev `open-agents-env-dev-…vercel.app` | HTML 404, `x-matched-path: /404`, still `dpl_4j7yWJeZCNtkPi5qGJjZUiNPL2C5` | Flag is not on this target; this deploy still lacks the route |
| Production `open-agents.dev` | HTML 404, `x-matched-path: /404` | Unchanged. Do **not** add the flag here |
| PR Preview `…c05212…` | JSON 404, `x-matched-path: /api/dev/test-auth` | Route live, flag still off (correct) |

`development` may stay set — it helps local `vercel dev`. It does not arm
the stable Dev URL.

Correct next commands (logged-in laptop, **custom `dev` only**):

```bash
vercel target list --scope dennisons-projects --project open-agents

vercel env add OPEN_AGENTS_ENABLE_TEST_AUTH dev \
  --scope dennisons-projects \
  --project open-agents \
  --value 1 \
  --yes

# New deploy from current develop (f1f918b4 or later). Do not
# vercel redeploy the existing dpl_4j7yWJe… URL — that is the old build.
cd ~/develop && git checkout develop && git pull
vercel deploy --target=dev \
  --scope dennisons-projects \
  --project open-agents \
  --yes
```

Do **not** add it to Production. After the `dev` deploy finishes:

- `GET https://open-agents-env-dev-dennisons-projects.vercel.app/api/dev/test-auth`
  must return `200` + `Set-Cookie`
- `https://open-agents.dev/api/dev/test-auth` must stay 404 (route absent
  until a release) or JSON 404 (guard) if the flag is ever set there by
  mistake

### Operator action 2026-08-20 ~21:17 UTC — target list only

The laptop printed `vercel target list` successfully:

```text
Target Name   Branch Tracking               Type          Updated
Production    main                          Production    -
Preview       All unassigned git branches   Preview       -
Development   Accessible via CLI            Development   -
dev           develop                       Preview       80d
```

That confirms the custom `dev` environment exists, tracks `develop`, and
is typed as Preview (`VERCEL_ENV` will be `preview` there — the
production hard-guard does not fire). **Updated: 80d** means branch
tracking has not deployed this target in ~80 days, which is why merging
#1390 to `develop` did not move `open-agents-env-dev-…`.

The paste then shows a second `Vercel CLI 56.5.0` banner and stops. There
is no `✓ Added` for `dev`, no `git pull` output, and no
`vercel deploy --target=dev` URL. Reprobe at 2026-08-20 21:20 UTC:

| Target | Result |
| --- | --- |
| Dev `open-agents-env-dev-…` | Still HTML 404, `dpl_4j7yWJeZCNtkPi5qGJjZUiNPL2C5`, cache HIT |
| GitHub deployments | Newest is Preview `1e231064` (#1391), not a `dev` deploy |
| Production | Still HTML 404 |

Run the remaining commands **one at a time** and paste the full output
of each. A multi-command paste can stop after `target list`.

```bash
vercel env ls dev --scope dennisons-projects --project open-agents
```

Look for `OPEN_AGENTS_ENABLE_TEST_AUTH`. If it is missing:

```bash
vercel env add OPEN_AGENTS_ENABLE_TEST_AUTH dev \
  --scope dennisons-projects \
  --project open-agents \
  --value 1 \
  --yes \
  --no-sensitive
```

If the CLI says the name already exists, add the `dev` target on the
existing row in the Vercel dashboard (Project → Settings → Environment
Variables) instead of creating a second name. Then, only after `✓ Added`
or a dashboard save:

```bash
cd ~/develop && git checkout develop && git pull
vercel deploy --target=dev \
  --scope dennisons-projects \
  --project open-agents \
  --yes
```

Wait for that deploy to finish (minutes, not seconds). The command must
print a deployment URL. Then this agent can probe again.

### Operator action 2026-08-20 ~21:25 UTC — flag is on `dev`

`vercel env ls dev` shows:

```text
OPEN_AGENTS_ENABLE_TEST_AUTH        Encrypted           dev                                         7m ago
```

The flag is on the custom `dev` environment only (not Production). That
closes the env-var half of slice 5. Reprobe at 21:25 UTC: Dev is still
HTML 404 on `dpl_4j7yWJeZCNtkPi5qGJjZUiNPL2C5`. Adding a var does not
update a live deployment.

Remaining command (from `~/dev/open-agents` on `develop`, after a clean
`git pull` so the upload is `f1f918b4` or later, not a dirty tree):

```bash
vercel deploy --target=dev \
  --scope dennisons-projects \
  --project open-agents \
  --yes
```

Wait until it prints a deployment URL. Do not `vercel redeploy` the
existing `dpl_4j7yWJe…` URL.

### Operator action 2026-08-20 ~21:33 UTC — pull blocked on local kanban

`~/dev/open-agents` was on `develop` at `36f2caf3` and `git pull` aborted:

```text
error: Your local changes to the following files would be overwritten by merge:
	kanban.json
```

`origin/develop` is `f1f918b4`. Stash the local kanban (and anything
else dirty), pull, then deploy **before** `stash pop` so the upload is
clean:

```bash
cd ~/dev/open-agents
git stash push -m "local kanban before dev deploy" -- kanban.json
git pull origin develop
git status -sb
# expect: ## develop...origin/develop
vercel deploy --target=dev \
  --scope dennisons-projects \
  --project open-agents \
  --yes
```

`git checkout -- kanban.json` is fine instead of stash if that local
edit is disposable. Do not commit the laptop kanban onto `develop` just
to unblock the pull.

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
