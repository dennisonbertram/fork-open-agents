# API Brief: Repos, GitHub Integration, Vercel Integration (for native iOS plan)

Scope: every route under `apps/web/app/api/repos`, `/api/github`, `/api/vercel`, plus `/api/generate-pr` and `/api/models`. All paths below are relative to `/Users/dennison/develop/open-agents` unless absolute.

Researched June 2026 from actual route code (not docs). All routes are Next.js App Router route handlers.

---

## 0. Cross-cutting auth model (everything below depends on this)

- All user-facing routes authenticate via the better-auth **session cookie**, read in `getServerSession()` (`apps/web/lib/session/get-server-session.ts:17-46`). It calls `auth.api.getSession({ headers })` and also honors a test-auth cookie (`getTestAuthSessionFromCookieHeader`, gated by `OPEN_AGENTS_ENABLE_TEST_AUTH`). There is **no bearer-token API auth** — a native app must carry the better-auth session cookie (or the product must grow a token scheme).
- Two auth helper styles exist:
  - `getServerSession()` directly → routes return `401 {"error":"Not authenticated"}` or `{"error":"GitHub not connected"}` when absent.
  - `requireAuthenticatedUser()` (`apps/web/app/api/sessions/_lib/session-context.ts:65-79`) → `{ok:false, response}` with `401 {"error":"Not authenticated"}`. Used by the repo dashboard route.
- Provider tokens (GitHub OAuth user token, Vercel OAuth token) are stored encrypted in better-auth's `accounts` table (`encryptOAuthTokens: true`, `apps/web/lib/auth/config.ts:89`) and fetched server-side via `auth.api.getAccessToken({ body: { providerId, userId } })` with auto-refresh:
  - GitHub: `getUserGitHubToken` (`apps/web/lib/github/token.ts:8-27`).
  - Vercel: `getUserVercelToken` / `getUserVercelAuthInfo` (`apps/web/lib/vercel/token.ts:27-73`).
- Social providers configured in `apps/web/lib/auth/config.ts:97-111`: `vercel` (sign-in; scopes `openid email profile`) and `github` (repo access; linked account). Account linking trusted providers: `["vercel","github"]`, `allowDifferentEmails: true` (`config.ts:90-94`).
- The iOS app never sees raw GitHub/Vercel tokens; every route proxies the provider API server-side.

---

## 1. `/api/repos/[owner]/[repo]/dashboard` — repo dashboard aggregate

File: `apps/web/app/api/repos/[owner]/[repo]/dashboard/route.ts`

- **GET** only. Auth: `requireAuthenticatedUser()` (route.ts:36-39). Path params `owner`, `repo` (route.ts:42).
- Aggregates **five data sources in parallel with `Promise.allSettled`** (failure isolation; route.ts:64-86):
  1. `getRepoDashboardData({userId, owner, repo})` — GitHub PRs / issues / actions windows (`apps/web/lib/github/repo-dashboard.ts:415-444`), via the user's OAuth Octokit (`getUserOctokit`, `apps/web/lib/github/client.ts:31-37`).
  2. `listRepoBackgroundAgents` — this user's background agents for the repo (with triggers) (`apps/web/lib/background-agents/store.ts:256-268`).
  3. `listBackgroundAgentRuns` (limit 20) (`store.ts:570-591`).
  4. `getBackgroundAgentReadinessWithGitHubAppMetadata()` — env-driven readiness checks (`apps/web/lib/background-agents/readiness.ts:157-173`).
  5. `getBackgroundAgentRepoReadiness({requiredUserPermission:"read"})` — verifies user token + GitHub App installation coverage for this repo (`apps/web/lib/background-agents/repo-readiness.ts`).
- **Response 200** JSON (route.ts:211-219):
  ```json
  {
    "prSummary":   { "ok": true, "prs": PrItem[] } | { "ok": false, "errorKind": DashboardErrorKind },
    "issueSummary":{ "ok": true, "totalOpen": n, "recent": IssueItem[] } | { "ok": false, "errorKind": ... },
    "actionsSummary": { "ok": true, "latestStatus": "passing|failing|pending", "recentRuns": ActionRunItem[] } | { "ok": false, ... },
    "agents": BackgroundAgentWithTriggers[],
    "runs": BackgroundAgentRun[],
    "readiness": { "enabled": bool, "ready": bool, "missing": string[], "checks": BackgroundAgentReadinessCheck[] },
    "repoReadiness": BackgroundAgentRepoReadiness | null
  }
  ```
- Item shapes (`repo-dashboard.ts:19-95`):
  - `PrItem`: `{number, title, isDraft, author: string|null, baseBranch, updatedAt, checksStatus: "passing"|"failing"|"pending"|"unknown", url}` (max 20, check-run rollup per PR head SHA).
  - `IssueItem`: `{number, title, labels: string[], updatedAt, url}` (max 20; `totalOpen` from a Search API call, fallback to `recent.length`).
  - `ActionRunItem`: `{runId, name, conclusion: string|null, status, createdAt, url}` (max 10).
- `DashboardErrorKind` taxonomy (`repo-dashboard.ts:7-15`): `github_not_connected | repo_access_denied | installation_missing | app_no_access | provider_rate_limited | provider_unavailable | invalid_repo | unknown_dashboard_failure`.
- Override rule (route.ts:112-123): if repo readiness denies for `no_installation` → all three windows forced to `errorKind:"installation_missing"`; `app_no_access` → `"app_no_access"` (so OAuth-token data is never presented as App-verified).
- `BackgroundAgentRepoReadiness` (`repo-readiness.ts:12-22`): `{ready, repoOwner, repoName, requiredUserPermission: "read"|"write", reason: "no_user_token"|"user_no_access"|"user_no_write"|"no_installation"|"app_no_access"|"github_error"|null, message, installationId, repositoryId, defaultBranch}`.
- `BackgroundAgentReadinessCheck` ids (`readiness.ts:8-19`): `feature_flag, auth_database, vercel_oauth, github_oauth, github_app, github_app_webhooks, sandbox_runtime, inference_gateway, repo_allowlist, cron_secret, webhook_secret`; each `{id, label, status: "ready"|"missing"|"disabled", detail, missing: string[]}`.
- **Errors**: `401` not authed; `500 {"error":"Dashboard data unavailable","errorKind":"unknown_dashboard_failure"}` (route.ts:239-242). Partial provider failures are NOT errors — they appear inside the windows as `ok:false`.
- Note: the web page `apps/web/app/repos/[owner]/[repo]/page.tsx` renders this data **server-side** by calling the same libs directly; nothing in the web client currently fetches this API route over HTTP, so it is effectively an unconsumed JSON twin — ideal for iOS, but unproven against real client traffic.

---

## 2. GitHub App connection flow (end-to-end, browser-based)

The flow has **two distinct GitHub integrations** chained together:
1. **GitHub OAuth account link** (better-auth social provider `github`) — gives the server a user OAuth token (repo listing, branches, PR reads use this).
2. **GitHub App installation** (`NEXT_PUBLIC_GITHUB_APP_SLUG` app) — gives repo-scoped installation tokens used for pushes/webhooks (minted server-side via `mintInstallationToken`, `apps/web/lib/github/app.ts:91-139`).

### Step-by-step from a browser

1. **User must already be signed in** (Vercel OAuth via better-auth; session cookie present). All GitHub endpoints 401/redirect to `/` otherwise.
2. **Link GitHub account**: client calls `authClient.linkSocial({provider:"github", callbackURL:"/api/github/post-link?next=<dest>"})` (`apps/web/app/get-started/get-started-flow.tsx:361-364`, `apps/web/app/settings/accounts-section.tsx:117-119` with `GITHUB_OAUTH_CALLBACK = "/api/github/post-link?next=/settings/connections"` at line 51). better-auth redirects the browser to GitHub's OAuth authorize page; GitHub redirects back to `{ORIGIN}/api/auth/callback/github` (better-auth handles token exchange and stores the encrypted token); better-auth then redirects to the `callbackURL`.
3. **`GET /api/github/post-link?next=...`** (`apps/web/app/api/github/post-link/route.ts:13-64`):
   - No session → redirect `/`.
   - No GitHub token → redirect `next` with `?github=link_failed`.
   - Calls `syncUserInstallations(userId, token, username)` — pages `GET https://api.github.com/user/installations` with the **user token**, upserts rows into `github_installations`, deletes rows not in the list (`apps/web/lib/github/sync.ts:147-174`). Personal-account installs from other users are filtered out (`sync.ts:86-98`).
   - If count > 0 (or existing DB rows): redirect `next` with `?github=account_connected`. Otherwise redirect to `/api/github/app/install?next=<next>` to chain into App install.
4. **`GET /api/github/app/install?next=&target_id=&reconnect=`** (`apps/web/app/api/github/app/install/route.ts:37-126`):
   - No session → redirect `/`. `next` sanitized via `sanitizeInternalRedirect` (default `/get-started`).
   - No `NEXT_PUBLIC_GITHUB_APP_SLUG` env → redirect `next?github=app_not_configured`.
   - Generates an arctic `state` value, stores two **httpOnly, sameSite=lax, 15-min cookies**: `github_app_install_redirect_to` (=next) and `github_app_install_state` (route.ts:14-35). NOTE: the state cookie is set but the callback never validates it (see Open Questions).
   - Redirect targets on github.com:
     - `target_id=<numeric githubId>` given → `https://github.com/apps/{slug}/installations/new/permissions?state=...&target_id=...` (direct install for that account/org; used by settings org rows, `accounts-section.tsx:90-97`).
     - `reconnect=1` → same URL with the user's personal `target_id` from the accounts table (`getGitHubAccountId`, `apps/web/lib/github/users.ts:78-87`).
     - No GitHub account linked → redirect `/get-started?github=not_linked&next=...` (browser flow restarts at step 2).
     - Zero installations after a best-effort sync → `https://github.com/apps/{slug}/installations/new/permissions?state=...` (install page).
     - Has installations already → `https://github.com/apps/{slug}/installations/select_target?state=...` (account picker).
5. **User completes the install on github.com**, GitHub redirects to the App's **Setup URL** = `{ORIGIN}/api/github/app/callback?installation_id=<n>&setup_action=<install|update|request>&state=...` (documented in `apps/web/.env.example:13-14`).
6. **`GET /api/github/app/callback`** (`apps/web/app/api/github/app/callback/route.ts:34-92`):
   - Reads `github_app_install_redirect_to` cookie for destination (default `/get-started`); requires session (else redirect `/`).
   - No user GitHub token → redirect with `?github=not_linked`.
   - Runs `syncUserInstallations` again (the durable DB write — `github_installations` rows are the end state).
   - Result query param on the redirect: `setup_action=request` → `github=request_sent` (org admin approval pending); synced>0 → `github=app_installed`; no `installation_id` param → `github=no_action&missing_installation_id=1`; else `github=pending_sync`.
   - Clears the three install cookies (`github_app_install_redirect_to`, `github_app_install_state`, `github_reconnect`).
7. **Webhooks keep DB fresh**: `installation` / `installation_repositories` events upsert/delete `github_installations` rows for *all* users with that installation (`apps/web/app/api/github/webhook/route.ts:241-289`).

### DB end state

`github_installations` table (`apps/web/lib/db/schema.ts:126-156`): `{id (nanoid), userId, installationId (int), accountLogin, accountType: "User"|"Organization", repositorySelection: "all"|"selected", installationUrl, createdAt, updatedAt}` with unique indexes on (userId, installationId) and (userId, accountLogin). Per-user rows — the same GitHub installation appears once per linked user.

### iOS implications

- The whole flow is **redirect/cookie-driven and same-origin**: state and destination live in cookies on the web origin; the GitHub App's Setup URL is fixed to the web origin. A native app must run this in an authenticated web context (e.g., `ASWebAuthenticationSession`/SFSafariViewController sharing the better-auth session cookie) and detect the terminal redirect (`?github=app_installed|account_connected|request_sent|...`) — or simply poll `/api/github/connection-status` after returning from the browser.
- `linkSocial` is a better-auth client API (POST `/api/auth/link-social`) that returns a provider authorize URL; an iOS client can call the better-auth REST endpoints directly to obtain the GitHub authorize URL, then open it in a browser session.

---

## 3. Other `/api/github/*` routes

### `GET /api/github/installations`
`apps/web/app/api/github/installations/route.ts:6-35`. Auth: session, else `401 {"error":"Not authenticated"}`. Returns DB rows (no GitHub call):
`[{installationId:number, accountLogin, accountType, repositorySelection:"all"|"selected", installationUrl: string|null}]`. `installationUrl` = `https://github.com/apps/{slug}/installations/{id}` when slug env is set (`apps/web/lib/github/urls.ts:69-80`). `500 {"error":"Failed to fetch installations"}` on DB error.

### `GET /api/github/installations/repos?installation_id=<n>&query=<substr>&limit=<n>`
`apps/web/app/api/github/installations/repos/route.ts:20-82`. Auth: session (401). Validation: `installation_id` required (`400 {"error":"installation_id is required"}`); installation must belong to user (`403 {"error":"Installation not found"}`); user GitHub token required (`401 {"error":"GitHub not connected"}`).
Proxies `GET https://api.github.com/user/installations/{id}/repositories` with the **user token** (GitHub computes app∩user repo intersection), filters by owner (= installation accountLogin) and name substring, sorts by `updated_at` desc, limit default 50 / clamp 1–100, max 20 pages of 50 (`apps/web/lib/github/repos.ts:75-155`). Response: `InstallationRepository[]`:
`{name, full_name, description: string|null, private: boolean, clone_url, updated_at, language: string|null}`. `500 {"error":"Failed to fetch repositories"}` on upstream failure. This is **the repo picker API** (used by `components/repo-selector.tsx`, `repo-selector-compact.tsx`).

### `GET /api/github/branches?owner=&repo=&limit=&query=`
`apps/web/app/api/github/branches/route.ts:264-329`. Auth: session required (`401 {"error":"GitHub not connected"}`) but **works for public repos without a GitHub token** (falls back to unauthenticated GitHub API, route.ts:308-313). `owner`+`repo` required (`400`). `limit` clamped 1–100. With `query`, uses `git/matching-refs/heads/{query}` prefix matching (route.ts:120-160). Response: `{branches: string[], defaultBranch: string}` — default branch sorted first, then case-insensitive alpha. `500 {"error":"Failed to fetch branches"}` if both authed and public paths fail.

### `GET /api/github/connection-status`
`apps/web/app/api/github/connection-status/route.ts:12-87`. Auth: session (401). Performs a **live installations sync** as a side effect. Response (`apps/web/lib/github/status.ts:11-16`):
```json
{ "status": "not_connected"|"connected"|"reconnect_required",
  "reason": "token_unavailable"|"installations_missing"|"sync_auth_failed"|null,
  "hasInstallations": boolean,
  "syncedInstallationsCount": number|null }
```
Logic: not linked → `not_connected`; linked but token unavailable → `reconnect_required/token_unavailable`; sync throws auth-like error (401, or 403 with expired/revoked text patterns, `apps/web/lib/github/sync.ts:36-80`) → `reconnect_required/sync_auth_failed`; DB had installations but sync returns 0 → `reconnect_required/installations_missing`; non-auth sync failure → optimistic `connected`. This is the **cheapest poll target after an OAuth/install round-trip on iOS**.

### `GET /api/github/orgs`
`apps/web/app/api/github/orgs/route.ts:6-43`. Auth: session + user token (`401 {"error":"GitHub not connected"}`). Proxies `GET /user/orgs?per_page=100`. Response: `[{login, name (=login), avatar_url}]` (`apps/web/lib/github/users.ts:137-160`). `500` on failure.

### `GET /api/github/orgs/install-status`
`apps/web/app/api/github/orgs/install-status/route.ts:49-275`. Auth: session (401); requires `GITHUB_APP_ID`+`GITHUB_APP_PRIVATE_KEY` configured (`500 {"error":"GitHub App not configured"}`). Combines GitHub `/user/orgs` + `/user` with DB installations (after a sync). Response `ConnectionStatusResponse` (route.ts:38-47):
```json
{ "user": {"githubId": n, "login": "", "avatarUrl": ""},
  "personalInstallStatus": "installed"|"not_installed",
  "personalInstallationUrl": string|null,
  "personalRepositorySelection": "all"|"selected"|null,
  "orgs": [{"githubId", "login", "avatarUrl", "installStatus", "installationId", "installationUrl", "repositorySelection"}],
  "tokenExpired"?: true }
```
Degraded mode: if the token is missing or GitHub returns 401/403, responds from DB cache with `tokenExpired:true`, empty user profile, `personalInstallStatus:"not_installed"` (route.ts:65-103, 130-154). Other GitHub failures → `502 {"error":"Failed to fetch GitHub data"}`; catch-all `500`. Drives the settings "Connections" UI (org-by-org install buttons → `/api/github/app/install?target_id=`).

### `GET /api/github/user`
`apps/web/app/api/github/user/route.ts:6-43`. Auth: session + token (`401 {"error":"GitHub not connected"}`). Proxies `GET /user`. Response: `{login, name: string|null, avatar_url}` (`users.ts:112-132`). `500` on failure.

### `POST /api/github/create-repo`
`apps/web/app/api/github/create-repo/route.ts:6-26`. Auth: session (401); body must be valid JSON (400). **Currently disabled**: always returns `501 {"error":"Creating repositories from Open Agents is temporarily disabled. Create the repository on GitHub first, then connect it to a session."}`. `maxDuration=120`. UI still has `components/create-repo-dialog.tsx`. Do not plan iOS create-repo around this.

### `POST /api/github/webhook` (server-to-server; not for iOS clients)
`apps/web/app/api/github/webhook/route.ts:153-289`. Auth: HMAC-SHA256 signature `x-hub-signature-256` against `GITHUB_WEBHOOK_SECRET` (timing-safe, route.ts:51-65). Required headers: `x-github-event`, `x-hub-signature-256` (else 400; bad sig 401; missing secret 500).
Handled events:
- `ping` → `{ok:true}`.
- `pull_request` (Zod `pullRequestWebhookSchema`, route.ts:33-45): on `closed`/`reopened` updates `sessions.prStatus` (`merged|closed|open`) for sessions linked to that repo+PR number and **archives sessions on close** (`archiveSession`); also dispatches background-agent triggers (route.ts:188-216). Response includes `matchedSessions/updatedSessions/archivedSessions`.
- `issues`, `deployment_status` → normalized via `normalizeGitHubBackgroundEvent` and dispatched to background agents (route.ts:218-239).
- `installation`, `installation_repositories` (Zod `installationWebhookSchema`, route.ts:18-31): `installation deleted` → delete rows; else upsert/partial-update `github_installations` for all users holding that installation (route.ts:241-289).
- Everything else → `{ok:true, ignored:true, event}`.
iOS relevance: PR merge/close state and session archival can change server-side at any time via webhooks — the app must treat session `prStatus`/`status` as server-driven.

---

## 4. `/api/vercel/*` routes

### `GET /api/vercel/repo-projects?repoOwner=&repoName=`
`apps/web/app/api/vercel/repo-projects/route.ts:9-73`. Auth: session (`401 {"error":"Not authenticated"}`). Params required (`400 {"error":"Missing repoOwner or repoName"}`). Requires Vercel OAuth token: missing → `403 {"error":"Connect Vercel to load matching projects"}`; invalid/expired (`VercelApiError.invalidToken` or 401, `apps/web/lib/vercel/projects.ts:103-108`) → `403 {"error":"Reconnect Vercel to load matching projects"}`. Other upstream failure → `500`.
Server-side it lists projects matching `https://github.com/{owner}/{repo}` across the personal scope + all teams (`/v2/teams` then `/v10/projects?repoUrl=...&teamId=...`, `projects.ts:199-312`), dedupes, sorts. It also reads the saved per-user link from `vercel_project_links` (PK userId+repoOwner+repoName, `schema.ts:157-178`).
**Response** (Zod `vercelRepoProjectsResponseSchema`, `apps/web/lib/vercel/types.ts:16-19`):
```json
{ "projects": [{"projectId","projectName","teamId":string|null,"teamSlug":string|null}],
  "selectedProjectId": string|null }
```
`selectedProjectId` = saved link if still in the list, else the single project if exactly one, else null (route.ts:44-50). Consumed by `hooks/use-vercel-repo-projects.ts` (SWR) → `components/session-starter.tsx`. The link itself is **persisted via `POST /api/sessions`** (body field `vercelProject: VercelProjectSelection | null`, validated against the same Zod schema, `app/api/sessions/route.ts:269-274`) — not via any `/api/vercel` write route.

### `GET /api/vercel/projects/[idOrName]/env`
`apps/web/app/api/vercel/projects/[idOrName]/env/route.ts:1-11`. **Intentionally a dead stub**: always `404 {"error":"Not found"}` with `Cache-Control: no-store`. The regression test (`route.test.ts:17-26`) locks in that decrypted env values are never proxied to the browser. Env pulling happens **server-side only** — `buildDevelopmentDotenvFromVercelProject` (`projects.ts:369-376`) builds a `.env` written into the sandbox. Do **not** plan an iOS env-listing feature on this route.

### Other Vercel surface (server-side helpers used by session APIs, not /api/vercel routes)
`apps/web/lib/vercel/projects.ts` also exposes preview-deployment lookups used by session/deployment endpoints: `findLatestPreviewDeploymentUrlForBranch` (READY, non-production, `projects.ts:432-478`), `findLatestBuildingDeploymentUrlForBranch` (BUILDING/QUEUED/INITIALIZING, 483-529), `findLatestFailedDeploymentInspectorUrlForBranch` (ERROR/CANCELED → inspectorUrl, 536-578). These surface through session/deployment routes (other brief), not under `/api/vercel`.

---

## 5. `POST /api/generate-pr`

File: `apps/web/app/api/generate-pr/route.ts` (`maxDuration=120`).

- Auth: session (`401`), then **BotID check** (`checkBotProtection()` → `403 {"error":"Access denied"}`, route.ts:28-31) — note for iOS: Vercel BotID is a browser/JS-challenge product; a native client may trip this (open question).
- **Rate limit**: 5 req/min per user, Redis-backed (`checkRateLimit`, route.ts:33-40; returns a 429-style response when limited).
- **Request body** (TS interface, *no Zod*, route.ts:13-19): `{sessionId: string, sessionTitle: string, baseBranch: string, branchName: string, createBranchOnly?: boolean}`.
- Validation: invalid JSON → 400; missing sessionId/branchName/baseBranch → 400; session not found → 404; not owner → `403 {"error":"Forbidden"}`; sandbox not active → `400 {"error":"Sandbox not initialized"}`; branch names must match `/^[\w\-/.]+$/` → 400.
- Behavior: connects to the session's **sandbox** and runs git there — resolves the live branch (`git symbolic-ref`), fetches origin base, detects uncommitted changes and commits-ahead, and **auto-creates a branch** `"{userInitials}/{8-hex}"` when on base/detached with changes (`generateBranchName`, `apps/web/app/api/generate-pr/_lib/generate-pr-helpers.ts:3-20`); persists new branch to the session row (route.ts:186-192).
- `createBranchOnly: true` → returns `200 {"branchName": string}` immediately after branch creation (route.ts:194-196).
- Otherwise, uncommitted changes → `400 {"error":"Uncommitted changes — commit first before generating PR content"}`; then generates an **AI title/body** from the sandbox diff + conversation context (`generatePullRequestContentFromSandbox`, `apps/web/lib/github/pr-content.ts:165+`; schema: title ≤72 chars conventional-commits, body `## Summary` + `## Changes`; on AI failure falls back to a diff-stats body, `pr-content.ts:344-345`). No-change cases → 400 with descriptive messages (`pr-content.ts:266-286`).
- **Response 200**: `{title: string, body: string, branchName: string}`. This route only *generates content*; the actual PR creation/commit/push happen through session routes / server actions (`lib/github/pulls.ts` has merge-readiness & merge helpers: `MergeReadiness`, `CheckRun`, `MergeMethod` types at `pulls.ts:3-56`) — covered in the sessions brief.
- Also auto-invoked by chat auto-commit flow (`apps/web/lib/chat-auto-commit.ts:67`).

---

## 6. `GET /api/models`

File: `apps/web/app/api/models/route.ts:5-24`.

- **No auth check at all** (public). `Cache-Control: private, no-store`.
- Response: `{"models": AvailableModel[]}`; on failure `500 {"error":"Failed to fetch available models"}`.
- Source: Vercel **AI Gateway** `gateway.getAvailableModels()` filtered to `modelType === "language"`, minus disabled models (currently `openai/gpt-*-pro` ids are disabled, `apps/web/lib/model-availability.ts:6-17`), then enriched with metadata from `https://models.dev/api.json` (750 ms timeout, best-effort) for `context_window` and per-million-token `cost` (`apps/web/lib/models-with-context.ts:218-238`).
- `AvailableModel` shape (`apps/web/lib/models.ts:6-26`):
  ```ts
  { id: string;             // e.g. "anthropic/claude-haiku-4.5"
    name: string;
    description?: string|null;
    modelType?: string|null; // "language"
    context_window?: number;
    cost?: { input?, output?, cache_read?, context_over_200k?: {input?,output?,cache_read?} } }
  ```
- Defaults the iOS app should mirror: `DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5"`, `APP_DEFAULT_MODEL_ID = "openai/gpt-5.4"`, `DEFAULT_CONTEXT_LIMIT = 200_000` (`models.ts:1-3`). Cost estimation math in `estimateModelUsageCost` (`models.ts:70-97`) including the >200k-token tier.

---

## 7. Notable absences / gotchas for the iOS plan

- There is **no generic "list my repos" route** — repo discovery is installation-scoped: `/api/github/installations` → `/api/github/installations/repos?installation_id=`. Repos outside an App installation are invisible to the picker.
- There is **no `/api/vercel/projects` list route** and no env-var read route (deliberate 404 stub). Vercel project choice is repo-scoped (`repo-projects`) and persisted through `POST /api/sessions`.
- `POST /api/github/create-repo` is a 501 stub.
- Responses use ad-hoc TS types more than Zod; only webhook payloads, installation sync, installation-repos, model metadata, and `vercelRepoProjectsResponseSchema` are Zod-validated. Error payloads are consistently `{error: string}` plus optional fields (`errorKind` on dashboard).
- Several GETs have **side effects** (installation sync on `connection-status`, `orgs/install-status`, `app/install`, `app/callback`, `post-link`) — calling them repeatedly is safe but does live GitHub API work; rate-limit-friendly polling matters.
- `generate-pr` is the only route here with BotID + rate limiting; everything else has neither.
- Structured log events worth keeping parity with: `repo-dashboard.fetch.started/.completed/.failed`, `repo-dashboard.provider.partial_failed` (dashboard route.ts:46-209).

## Open questions

1. **Native auth transport**: every route relies on the better-auth session cookie; the plan must decide between cookie-carrying web-auth sessions on iOS vs adding a bearer/token mechanism (e.g., better-auth bearer plugin) server-side.
2. **GitHub App install on iOS**: the install/callback flow depends on same-origin cookies (`github_app_install_redirect_to`/`_state`) and github.com redirects; needs an embedded browser session sharing cookies with API calls, or a polling fallback via `/api/github/connection-status`. Also note the `state` cookie is generated but never verified in `/api/github/app/callback` — flow tolerance is unknown if cookies are dropped (default destination `/get-started` is used).
3. **BotID on `/api/generate-pr`**: will `checkBotProtection()` block a native (non-browser) client? Needs verification or an exemption path.
4. `/api/repos/[owner]/[repo]/dashboard` currently has no web HTTP consumer (page renders server-side) — confirm it stays maintained as the contract for iOS, or wrap it in a versioned mobile API.
5. `/api/models` is unauthenticated — confirm whether that's intentional before exposing it as the iOS model catalog.
