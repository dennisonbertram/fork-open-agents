# API contract review

Findings from exercising the `apps/web` HTTP API against a running server, plus
static analysis of all 164 route files.

**How this was produced.** A local server on the dev Neon branch
(`ep-old-union`, never production) with `NODE_ENV=development`, which enables the
synthetic test identity in `apps/web/lib/session/test-auth.ts`. Every finding
below was reproduced with a real HTTP call and the observed response is quoted
verbatim. Static counts come from scripts in `scripts/api-exercise/`.

Reproduce with:

```bash
bun run --cwd apps/web db:migrate:apply
PORT=3111 bun run web
API_BASE_URL=http://localhost:3111 bun run scripts/api-exercise/auth-sweep.ts
API_BASE_URL=http://localhost:3111 bun run scripts/api-exercise/journeys-core.ts
bun run scripts/api-exercise/error-shape-census.ts
```

## Surface

| Measure | Value |
| ------- | ----- |
| Route files under `apps/web/app/api` | 164 |
| Method + path pairs | 230 |
| Parameterless routes probed live | 52 route/method pairs |
| Routes reachable without a session | 8 |
| Error responses (`Response.json` with status ≥ 400) | 462 |
| Distinct error body shapes | 62 |

The 8 routes reachable without a session are `/api/auth/info`, `/api/health`,
`/api/models`, `/api/harness/ready`, `/api/github/app/callback`,
`/api/github/app/install`, `/api/github/post-link`, and
`/api/dev/managed-runtime-demo`. All are intentionally public;
`/api/dev/managed-runtime-demo` is gated by `isTestAuthEnabled()` and returns 404
in production. **No unintended auth gap was found.**

## Finding 1 — error bodies are not a contract

462 error responses use **62 distinct body shapes**. The largest groups:

| Shape | Count |
| ----- | ----- |
| `{ error }` | 321 |
| `{ errorKind, message }` | 32 |
| `{ error, errorKind }` | 16 |
| `{ }` (empty body) | 11 |
| `{ details, error }` | 8 |
| `{ error, errorKind, message }` | 6 |
| `{ errorKind, errors, message }` | 5 |
| 55 further shapes | 1–3 each |

Two mutually incompatible conventions carry the human-readable string: `error`
and `message`. A frontend handler cannot read both without guessing, and 11
responses carry no body at all. Observed live, in one sweep of GET routes alone:
`{error}`, `{error, supportedSources}`, and `{errorKind, message}` all came back
from sibling endpoints.

Tracked as a design decision, not a mass rewrite — see the linked issue.

## Finding 2 — the same condition gets different status classes

All of these were re-verified after the fixes below landed.

| Condition | Route | Status |
| --------- | ----- | ------ |
| No usable GitHub token | `GET /api/github/user` | **500** → 401 (fixed, #1061) |
| No usable GitHub token | `GET /api/github/orgs` | **500** → 401 (fixed, #1061) |
| No usable GitHub token | `GET /api/github/connection-status` | 200 |
| No usable GitHub token | `GET /api/github/installations` | 200 |
| Bad GitHub credentials | `POST /api/sandbox` | **500** (uncaught `HttpError: Bad credentials`) |
| Duplicate profile name | `POST /api/inference-profiles` | **400** → 409 (fixed, #1059) |
| Session has no sandbox yet | `GET /api/sessions/[id]/diff` | **400** |

500 is the one class a client cannot act on. Three of these are ordinary
client/auth states, and one is a normal lifecycle state.

## Finding 3 — silent acceptance of unknown field names

```
PATCH /api/settings/preferences {"totallyUnknownKey":"whatever"} -> 200
PATCH /api/settings/preferences {"diffMode":"not-a-real-mode"}   -> 200
```

Neither key exists — the real field is `defaultDiffMode`, not `diffMode`. Both
were dropped and both reported success, so a client shipping a misspelled field
name saw a 200 and no effect.

**Correction to the first write-up of this finding.** It also claimed invalid
*values* on valid fields were accepted. That was never tested and is false:
`{"defaultDiffMode":"not-a-real-mode"}` already returned
`400 {"error":"Invalid diff mode"}` and `{"defaultSandboxType":"not-a-backend"}`
already returned `400 {"error":"Invalid sandbox type"}`. Per-field value
validation was correct all along; only unknown field *names* were swallowed.

Fixed in #1060 — unknown keys now return
`400 {"error":"Unknown preference field(s): ...","fields":[...]}`, verified live.

## Finding 4 — sandbox provisioning reports success it did not achieve

Creating a session for a private repo and provisioning a sandbox returns 200:

```
POST /api/sandbox  -> 200 {"currentBranch":"develop","mode":"vercel",...}
```

Three sources then disagree about the same sandbox:

| Source | Branch | Contents |
| ------ | ------ | -------- |
| `POST /api/sandbox` response | `develop` | — |
| Session record (`GET /api/sessions/[id]`) | `mr/ad358c87` | — |
| Actual sandbox (`GET /api/sessions/[id]/git/status`) | `master` | `files: []` |

The repository was never cloned, yet the API reported a ready workspace on a
branch that is not checked out. A UI consuming this shows the user a workspace
that does not exist.

## Finding 5 — REST shape inconsistency on inference profiles

| Operation | Inference profiles | Every other resource |
| --------- | ------------------ | -------------------- |
| Update | `PATCH /api/inference-profiles` (id in body) | `PATCH /api/{resource}/[id]` |
| Delete | `DELETE /api/inference-profiles` (id in body) | `DELETE /api/{resource}/[id]` |
| Read one | **does not exist** — returns the Next.js HTML 404 page | `GET /api/{resource}/[id]` |
| Sub-action | `POST /api/inference-profiles/[profileId]/test` | — |

The per-id segment already exists for `/test`, so the resource is half-converted.
`GET /api/inference-profiles/[id]` returning an HTML page rather than a JSON
error is its own client hazard.

## Journey results

See [core-journeys.md](core-journeys.md) for the step-by-step observed contract
of each journey, and `docs/ux-paths/catalog.md` for the full 134-story catalog
(149 of 164 route paths covered; the 15 uncovered are named there).
