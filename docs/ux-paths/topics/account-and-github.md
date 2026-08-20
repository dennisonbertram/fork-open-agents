# UX Paths — Account creation & GitHub connection

Scope: getting an identity into the app, linking a GitHub account, installing the
GitHub App on a personal account and orgs, verifying connection health, browsing
installation repositories/branches, and the account-level preference state a new
user sets up immediately after connecting.

## How to run these with curl

Real GitHub OAuth cannot be driven by curl. Every story below assumes the
server is started with `OPEN_AGENTS_ENABLE_TEST_AUTH=1` and that the runner
obtains a session cookie once:

```
curl -i -c cookies.txt "$BASE/api/dev/managed-runtime-demo"   # sets open_agents_test_user_id
curl -b cookies.txt "$BASE/api/auth/info"
```

All subsequent calls replay `-b cookies.txt`. Steps that redirect to
`github.com` must be run with `-i --max-redirs 0` and asserted on the `302`
`Location` header — do not follow them.

**Known cross-endpoint duplication in this topic** (recorded, not resolved):

| Data | Endpoints that return it |
| --- | --- |
| Whether GitHub is linked | `/api/auth/info` (`hasGitHub`, `hasGitHubAccount`, `hasGitHubInstallations`), `/api/github/connection-status` (`status`), `/api/github/orgs/install-status` (401 `GitHub not connected`) |
| Installation list | `/api/github/installations`, `/api/github/orgs/install-status` (`orgs[]` + `personalInstall*`), `/api/auth/info` (count-derived boolean only) |
| GitHub user profile | `/api/github/user`, `/api/github/orgs/install-status` (`user`) |
| Org list | `/api/github/orgs`, `/api/github/orgs/install-status` (`orgs[]`, plus install state) |
| Installation-sync side effect (`syncUserInstallations`) | fired by `/api/github/connection-status`, `/api/github/orgs/install-status`, `/api/github/app/install`, `/api/github/app/callback`, `/api/github/post-link` — five routes, no dedicated `POST /sync` |

---

## STORY-account-and-github-01: First look before signing in

**Type**: short
**Persona**: Priya, an engineer who found the product link in a newsletter and has not signed in.
**Goal**: Find out whether she is signed in and what the app needs from her, without creating anything.
**Preconditions**: No session cookie at all.
**Ideal path**: 1 call — a single unauthenticated identity probe should say "signed out" and what provider to use.
**Alternate paths**: `GET /api/github/connection-status` answers the same question but with a 401 instead of a body; `GET /api/health` proves liveness only.

### Steps
1. `GET /api/auth/info` — no cookie → expect `200` `{"user":undefined}` (note: signed-out is **not** a 401 here)
2. `GET /api/health` — no cookie → expect `200` health payload

### Variations
- Send a garbage cookie `open_agents_test_user_id=nobody` with test-auth disabled → still `200 {"user":undefined}`.
- Repeat step 1 with `Accept: text/html`; route always returns JSON.

### Edge Cases
- Auth failure: `GET /api/github/connection-status` with no cookie → `401 {"error":"Not authenticated"}` (different contract from `/api/auth/info` for the same question).
- Auth failure: `GET /api/github/installations` with no cookie → `401 {"error":"Not authenticated"}`.
- Auth failure: `GET /api/github/user` with no cookie → `401 {"error":"GitHub not connected"}` — misleading message; the user is not authenticated at all.
- Not found: `GET /api/github/nonexistent` → `404`.

---

## STORY-account-and-github-02: Establish a session and read the account baseline

**Type**: short
**Persona**: Priya, now willing to sign in.
**Goal**: Get an authenticated session and see the empty starting state of her account.
**Preconditions**: Server started with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`. This story creates the cookie every later story reuses.
**Ideal path**: 2 calls — sign in, then read identity. Everything else is optional detail.
**Alternate paths**: Real users go through `GET /api/auth/[...all]` (better-auth GitHub sign-in) instead of the dev endpoint; `/api/account/status` also returns an account-wide snapshot that overlaps `/api/auth/info` on identity.

### Steps
1. `GET /api/dev/test-auth` — no body → expect `200` `{ok:true,userId:"dev-managed-runtime-user"}` and `Set-Cookie: open_agents_test_user_id=dev-managed-runtime-user`. (`GET /api/dev/managed-runtime-demo` also sets the cookie but provisions a sandbox — only use it when the story needs the demo runtime.)
2. `GET /api/auth/info` — cookie → expect `200` `{user:{id:"dev-managed-runtime-user",...},authProvider,isAdmin,hasGitHub:true,hasGitHubAccount:true,hasGitHubInstallations:true}` (the cookie-only seed inserts a GitHub account row and an installation so `GitHubReconnectGate` stays closed; this is not an empty GitHub baseline)
3. `GET /api/account/status?window=24h` — cookie → expect `200` `{snapshot:{...}}` with empty/zeroed activity
4. `GET /api/settings/preferences` — cookie → expect `200` `{preferences:{defaultModelId,defaultSandboxType,...}}` (defaults, never created before)

### Variations
- `GET /api/dev/test-auth?next=/sessions` → `307` to `/sessions` with the same `Set-Cookie`. Absolute, protocol-relative, and `/%5c%5c…` `next` values are ignored and return the JSON body instead.
- `GET /api/dev/managed-runtime-demo?profileId=node-22` → sandbox demo payload, demo seeded against that profile.
- Call step 2 twice; `hasGitHub` / `hasGitHubAccount` / `hasGitHubInstallations` stay `true` (the seed is idempotent and does not unlink GitHub).

### Edge Cases
- Not found: start the server without `OPEN_AGENTS_ENABLE_TEST_AUTH=1` and in `NODE_ENV=production` → `GET /api/dev/test-auth` and `GET /api/dev/managed-runtime-demo` return `404 {"error":"Not found"}`. `VERCEL_ENV=production` also 404s both routes even if the flag is set.
- Auth failure: `GET /api/account/status` with no cookie → `401`.
- Validation failure: `GET /api/account/status?window=notatime` → `400`.
- Conflict-ish: `GET /api/auth/info` for a session whose user row was deleted → `200 {"user":undefined}` (the `userExists` guard), not a 401.

---

## STORY-account-and-github-03: Kick off the GitHub App install before linking GitHub

**Type**: short
**Persona**: Priya, who clicked "Install GitHub App" before ever connecting her GitHub identity.
**Goal**: Install the app on her account.
**Preconditions**: Session from STORY-02. `hasGitHubAccount:false`.
**Ideal path**: 1 call — the install entry point should detect the missing link and route her to connect first, without leaking a github.com URL.
**Alternate paths**: `GET /api/github/post-link?next=/sessions` reaches the same install chain from the other direction (it redirects into `/api/github/app/install`).

### Steps
1. `GET /api/github/app/install?next=/sessions` — cookie, `--max-redirs 0` → expect `302` with `Location` on **this host** at `/get-started?...github=not_linked...` (never `github.com/apps/...`); this is the issue-783 guard
2. `GET /api/auth/info` — cookie → expect `200`, `hasGitHub` still `false`

### Variations
- `GET /api/github/app/install?next=/sessions&target_id=1234567` while unlinked → still the `not_linked` internal redirect; the `target_id` branch is deliberately after the link check.
- `GET /api/github/app/install?reconnect=1` while unlinked → same `not_linked` redirect.

### Edge Cases
- Auth failure: same call with no cookie → `302` to `/` (redirect, not 401).
- Validation failure: `next=https://evil.example.com/steal` → redirect target is sanitized to an internal path (`sanitizeInternalRedirect`), never the external host.
- Configuration failure: unset `NEXT_PUBLIC_GITHUB_APP_SLUG` → `302` to `/get-started?...github=app_not_configured`.
- Not found: `GET /api/github/app/install` with `POST` → `405`.

---

## STORY-account-and-github-04: Complete the GitHub link and land back in the app

**Type**: medium
**Persona**: Priya, returning from GitHub OAuth.
**Goal**: Have the app recognize her GitHub identity and pull in any existing App installations.
**Preconditions**: Session from STORY-02; a GitHub OAuth account row linked for the test user (seeded, since curl cannot complete OAuth).
**Ideal path**: 2 calls — the OAuth callback lands, one post-link call syncs and routes. Today the state is spread over four read endpoints.
**Alternate paths**: `/api/github/connection-status` performs the *same* `syncUserInstallations` side effect as `/api/github/post-link`; so does `/api/github/orgs/install-status`. Three endpoints, one sync.

### Steps
1. `GET /api/github/post-link?next=/sessions` — cookie, `--max-redirs 0` → expect `302`; `Location` is `/sessions?...github=account_connected` when installations synced, or `/api/github/app/install?next=/sessions` when none exist yet
2. `GET /api/auth/info` — cookie → expect `200` `{hasGitHubAccount:true, hasGitHubInstallations:<bool>}`
3. `GET /api/github/connection-status` — cookie → expect `200` `{status:"connected"|"reconnect_required", reason, hasInstallations, syncedInstallationsCount}`
4. `GET /api/github/user` — cookie → expect `200` GitHub user object (`login`, `id`, `avatar_url`)
5. `GET /api/github/orgs` — cookie → expect `200` array of orgs
6. `GET /api/github/installations` — cookie → expect `200` array of `{installationId,accountLogin,accountType,repositorySelection,installationUrl}`

### Variations
- `GET /api/github/post-link` with no `next` → default destination `/sessions`.
- Run steps 3–6 in any order; all are read-only except the sync side effect in step 3.

### Edge Cases
- Auth failure: step 1 with no cookie → `302` to `/`.
- Token missing (link row exists but no usable access token): step 1 → `302` `.../get-started?...github=link_failed`; step 3 → `200 {"status":"reconnect_required","reason":"token_unavailable","syncedInstallationsCount":null}`; step 4 → `401 {"error":"GitHub not connected"}`. Three different status codes for one underlying condition.
- Upstream failure: GitHub API 5xx during sync → step 1 → `302 ...github=sync_failed`; step 3 → `200 {"status":"sync_degraded","reason":"sync_unknown_error"}` (a degraded state reported as `200`).
- Validation failure: `next=//evil.example.com` → sanitized to an internal path.

---

## STORY-account-and-github-05: Install the app on the personal account and confirm it took

**Type**: medium
**Persona**: Priya, GitHub linked, no installations yet.
**Goal**: Install the GitHub App on her personal account and verify the app sees it.
**Preconditions**: STORY-04 completed with `hasGitHubInstallations:false`.
**Ideal path**: 3 calls — start install, handle callback, confirm. GitHub's own consent screen is out of the API's control.
**Alternate paths**: The install can also be started implicitly by `GET /api/github/post-link` (it chains into `/api/github/app/install`). Confirmation is available from `/api/github/installations`, `/api/github/orgs/install-status`, `/api/github/connection-status`, and `/api/auth/info` — four endpoints for one fact.

### Steps
1. `GET /api/github/app/install?next=/sessions` — cookie, `--max-redirs 0`, save cookies → expect `302` to `https://github.com/apps/<slug>/installations/new/permissions?state=<state>` plus `Set-Cookie: github_app_install_state=<state>` and `github_app_install_redirect_to=/sessions`
2. (simulate GitHub) `GET /api/github/app/callback?installation_id=48213377&setup_action=install&state=<state from step 1 cookie>` — cookie jar from step 1, `--max-redirs 0` → expect `302` to `/sessions?...github=app_installed` (or `github=pending_sync` if the sync found nothing) and `Set-Cookie` deletions for both install cookies
3. `GET /api/github/installations` — cookie → expect `200` array containing `{installationId:48213377, accountLogin:"priya-dev", accountType:"User", repositorySelection:"selected"|"all"}`
4. `GET /api/github/orgs/install-status` — cookie → expect `200` `{user:{login:"priya-dev"},personalInstallStatus:"installed",personalInstallationUrl,personalRepositorySelection,orgs:[...]}`
5. `GET /api/auth/info` — cookie → expect `200` `{hasGitHubInstallations:true}`

### Variations
- `setup_action=request` (org owner must approve) → step 2 redirects with `github=request_sent`, and step 3 still returns `[]`.
- Omit `installation_id` in step 2 with a valid state → `github=no_action` with the `missingInstallationId` flag set.
- `next=/settings/repositories` in step 1 → step 2 lands on that path.

### Edge Cases
- Auth failure: step 2 without a session cookie → `302` to `/`.
- Validation failure (CSRF): step 2 with `state=forged-state-value` while the cookie holds another value → `302` to `/get-started?...github=invalid_state`, install cookies cleared, nothing synced. Same result if the state cookie is absent.
- Validation failure: `installation_id=not-a-number` → parsed as `null`, treated as `no_action`.
- Auth failure: valid state but GitHub token gone → `302 ...github=not_linked`.
- Not found: `GET /api/github/orgs/install-status` with the GitHub App env unconfigured → `500 {"error":"GitHub App not configured"}`.

---

## STORY-account-and-github-06: Add an organization installation

**Type**: medium
**Persona**: Rahul, a staff engineer who already installed on his personal account and now wants the app on `acme-labs`.
**Goal**: Install on a second (org) account and confirm both installations coexist.
**Preconditions**: STORY-05 completed; at least one installation exists; the user is a member of at least one org.
**Ideal path**: 3 calls — list orgs with their install state, start a targeted install, confirm. `/api/github/orgs/install-status` already does the first in one shot.
**Alternate paths**: `GET /api/github/orgs` returns the same org list without install state — a strictly weaker duplicate. Starting the install without `target_id` reaches GitHub's `select_target` picker instead of the direct permissions page.

### Steps
1. `GET /api/github/orgs/install-status` — cookie → expect `200`; find `orgs[]` entry `{login:"acme-labs", githubId:90210441, installStatus:"not_installed", installationId:null}`
2. `GET /api/github/app/install?target_id=90210441&next=/settings/repositories` — cookie, `--max-redirs 0` → expect `302` to `https://github.com/apps/<slug>/installations/new/permissions?state=<state>&target_id=90210441` with install cookies set
3. `GET /api/github/app/callback?installation_id=48219902&setup_action=install&state=<state>` — cookie jar, `--max-redirs 0` → expect `302` to `/settings/repositories?...github=app_installed`
4. `GET /api/github/installations` — cookie → expect `200` array of length 2 (personal + `acme-labs`)
5. `GET /api/github/orgs/install-status` — cookie → expect `200` with `acme-labs` now `installStatus:"installed"`, non-null `installationId` and `installationUrl`

### Variations
- Repeat step 2 with no `target_id` while installations already exist → `302` to `.../installations/select_target?state=<state>` (picker instead of direct install).
- Org that the app is installed on but which is not in the user's GitHub `orgs` list → still appears in `orgs[]` via the DB-installation merge branch.

### Edge Cases
- Validation failure: `target_id=acme-labs` (non-numeric) → the numeric guard fails, so the request falls through to the sync/picker branch rather than 400.
- Auth failure: step 1 with an expired GitHub token → `200` with `tokenExpired:true` and a DB-cached `orgs[]` where `user.login` is `""` — degraded data returned as success.
- Auth failure: no token and no linked GitHub account → step 1 → `401 {"error":"GitHub not connected"}`.
- Upstream failure: GitHub `/user` or `/user/orgs` returns a non-auth error → `502 {"error":"Failed to fetch GitHub data"}`.
- Unexpected failure inside the handler → `500 {"error":"Failed to fetch organization data"}`.

---

## STORY-account-and-github-07: Browse installation repos and pick a working branch

**Type**: medium
**Persona**: Rahul, ready to point the product at a repo.
**Goal**: Find `acme-labs/payments-api` through the installation and confirm its branches.
**Preconditions**: STORY-06 completed; org installation id known.
**Ideal path**: 2 calls — list repos for the installation, list branches for the chosen repo.
**Alternate paths**: none found for installation repo listing. Branches are also readable indirectly via per-repo settings defaults (`GET /api/settings/repositories/{owner}/{repo}` returns a resolved `defaultBranch`), which duplicates the default-branch field from `/api/github/branches`.

### Steps
1. `GET /api/github/installations` — cookie → expect `200`; take `installationId` for `acme-labs`
2. `GET /api/github/installations/repos?installation_id=48219902&limit=50` — cookie → expect `200` array of repos
3. `GET /api/github/installations/repos?installation_id=48219902&query=payments` — cookie → expect `200` filtered array containing `payments-api`
4. `GET /api/github/branches?owner=acme-labs&repo=payments-api&limit=25` — cookie → expect `200` `{branches:[...],defaultBranch:"main"}`
5. `GET /api/github/branches?owner=acme-labs&repo=payments-api&query=release/` — cookie → expect `200` `{branches:["release/2026-07",...],defaultBranch:"main"}`

### Variations
- `limit=500` on branches → clamped to 100 by `normalizeGitHubLimit`.
- `limit=abc` → treated as unset, server default applies.
- Public repo with no linked token → the branches route falls back to unauthenticated GitHub access.

### Edge Cases
- Validation failure: `GET /api/github/installations/repos` with no `installation_id` → `400 {"error":"installation_id is required"}`.
- Ownership failure: `installation_id=99999999` (not owned by this user) → `403 {"error":"Installation not found"}` — a 403 where the rest of the codebase prefers 404.
- Auth failure: valid installation but no GitHub token → `401 {"error":"GitHub not connected"}`.
- Validation failure: `GET /api/github/branches` missing `owner` or `repo` → `400`.
- Auth failure: `GET /api/github/branches` for a private repo without a token → `401`.
- Upstream failure: GitHub error while listing branches → `500`.

---

## STORY-account-and-github-08: Repository creation is a dead end

**Type**: short
**Persona**: Priya, who has no repo yet and looked for "create repository" in the product.
**Goal**: Create a new repo from inside the app.
**Preconditions**: Session from STORY-02.
**Ideal path**: 1 call. The feature is disabled, so the honest ideal is a single call that says so.
**Alternate paths**: none found — no other route creates a repository.

### Steps
1. `POST /api/github/create-repo` — body: `{"name":"payments-experiments","private":true}` → expect `501 {"error":"Creating repositories from Open Agents is temporarily disabled. ..."}`
2. `GET /api/github/installations/repos?installation_id=48219902` — cookie → expect `200`, confirming the user must instead pick an existing repo

### Variations
- Any body shape produces the same `501`; the payload is parsed and discarded.

### Edge Cases
- Auth failure: step 1 with no cookie → `401 {"error":"Not authenticated"}` (auth is checked before the disabled response).
- Validation failure: malformed JSON body → `400 {"error":"Invalid JSON body"}`.

---

## STORY-account-and-github-09: Diagnose and repair a broken GitHub connection

**Type**: medium
**Persona**: Rahul, three weeks later; runs started failing after he revoked the OAuth grant on GitHub.
**Goal**: Understand why GitHub stopped working and restore it.
**Preconditions**: A linked GitHub account whose token is revoked/expired; installations still present in the DB.
**Ideal path**: 3 calls — diagnose, reconnect, confirm. Today diagnosis is scattered across four endpoints with four different contracts.
**Alternate paths**: The reconnect can also be started with `GET /api/github/app/install` (no `reconnect` flag, account picker) or by re-running `GET /api/github/post-link`. Diagnosis is duplicated across `/api/auth/info`, `/api/github/connection-status`, `/api/github/orgs/install-status`, and `/api/github/user`.

### Steps
1. `GET /api/auth/info` — cookie → expect `200` `{hasGitHubAccount:true,hasGitHubInstallations:true}` — note this still looks healthy
2. `GET /api/github/connection-status` — cookie → expect `200` `{"status":"reconnect_required","reason":"token_unavailable"|"sync_auth_failed","syncedInstallationsCount":null}`
3. `GET /api/github/user` — cookie → expect `401 {"error":"GitHub not connected"}`
4. `GET /api/github/orgs/install-status` — cookie → expect `200` with `tokenExpired:true` and cached `orgs[]`
5. `GET /api/github/app/install?reconnect=1&next=/settings` — cookie, `--max-redirs 0` → expect `302` to `https://github.com/apps/<slug>/installations/new/permissions?state=<state>&target_id=<accountId>` (skips the picker), with install cookies set
6. (after re-auth) `GET /api/github/post-link?next=/settings` — cookie, `--max-redirs 0` → expect `302` to `/settings?...github=account_connected`
7. `GET /api/github/connection-status` — cookie → expect `200` `{"status":"connected","reason":null,"syncedInstallationsCount":2}`
8. `GET /api/github/installations` — cookie → expect `200` array of length 2, unchanged

### Variations
- Installations exist in the DB but the sync returns `0` → step 7 gives `{"status":"reconnect_required","reason":"installations_missing"}`.
- GitHub returns a transient 500 during the sync → step 7 gives `{"status":"sync_degraded","reason":"sync_unknown_error"}`.
- `reconnect=1` with no stored GitHub account id → falls through to the normal picker/install branch.

### Edge Cases
- Auth failure: step 2 with no cookie → `401 {"error":"Not authenticated"}`.
- Not-linked: a user who never linked GitHub → step 2 → `200 {"status":"not_connected","reason":null}` (not an error status).
- Auth failure: step 4 with no token and no linked account → `401 {"error":"GitHub not connected"}`.
- Redirect safety: `next=https://phish.example.com` on step 5 → sanitized to an internal path.

---

## STORY-account-and-github-10: Full onboarding, end to end, with account defaults

**Type**: long
**Persona**: Dana, a new team lead onboarding herself before inviting the team.
**Goal**: Go from no account to a fully connected workspace with account-level and per-repo defaults set the way her team works.
**Preconditions**: Fresh test-auth session; test-auth enabled. Consumes the flows from STORY-02 through STORY-07.
**Ideal path**: ~8 calls — sign in, link, install, list repos, set preferences, set repo overrides, verify. The 20+ calls below reflect the current fan-out of overlapping status endpoints.
**Alternate paths**: Every status read here has a duplicate (see the table at the top). Per-repo defaults overlap account preferences: `autoCommitPush` / `autoCreatePr` / `managedRuntimeProfileId` exist in both `/api/settings/preferences` and `/api/settings/repositories/{owner}/{repo}`.

### Steps
1. `GET /api/auth/info` — no cookie → expect `200 {"user":undefined}`
2. `GET /api/dev/managed-runtime-demo` — → expect `200` + `Set-Cookie` session
3. `GET /api/auth/info` — cookie → expect `200` `{hasGitHub:false}`
4. `GET /api/github/app/install?next=/get-started` — cookie, `--max-redirs 0` → expect `302` internal `...github=not_linked`
5. `GET /api/github/post-link?next=/get-started` — cookie, `--max-redirs 0` → expect `302` (link established out of band) to `/api/github/app/install?next=/get-started` or `...github=account_connected`
6. `GET /api/github/connection-status` — cookie → expect `200` `{"status":"connected"|"reconnect_required"}`
7. `GET /api/github/user` — cookie → expect `200` `{"login":"dana-eng","id":10472233}`
8. `GET /api/github/app/install?next=/get-started` — cookie, `--max-redirs 0` → expect `302` to `github.com/apps/<slug>/installations/new/permissions?state=<state>`, install cookies set
9. `GET /api/github/app/callback?installation_id=48231114&setup_action=install&state=<state>` — cookie jar, `--max-redirs 0` → expect `302` `/get-started?...github=app_installed`
10. `GET /api/github/orgs/install-status` — cookie → expect `200` `{personalInstallStatus:"installed",orgs:[{login:"acme-labs",installStatus:"not_installed",githubId:90210441}]}`
11. `GET /api/github/app/install?target_id=90210441&next=/get-started` — cookie, `--max-redirs 0` → expect `302` with `target_id=90210441`
12. `GET /api/github/app/callback?installation_id=48231998&setup_action=install&state=<state>` — cookie jar → expect `302` `...github=app_installed`
13. `GET /api/github/installations` — cookie → expect `200` array length 2
14. `GET /api/github/installations/repos?installation_id=48231998&query=payments&limit=25` — cookie → expect `200` containing `acme-labs/payments-api`
15. `GET /api/github/branches?owner=acme-labs&repo=payments-api` — cookie → expect `200` `{defaultBranch:"main"}`
16. `GET /api/settings/preferences` — cookie → expect `200` `{preferences:{...defaults}}`
17. `PATCH /api/settings/preferences` — body: `{"defaultSandboxType":"vercel","defaultDiffMode":"split","autoCommitPush":true,"autoCreatePr":false,"alertsEnabled":true}` → expect `200` `{preferences:{autoCommitPush:true,...}}`
18. `GET /api/settings/repositories/acme-labs/payments-api` — cookie → expect `200` `{resolved:{...},raw:{...all nulls}}`
19. `PATCH /api/settings/repositories/acme-labs/payments-api` — body: `{"fullClone":true,"defaultBranch":"main","autoCreatePr":true,"vcpus":4}` → expect `200` `{resolved,raw}` with the overrides applied
20. `GET /api/settings/repositories/acme-labs/payments-api` — cookie → expect `200`, `resolved.autoCreatePr === true` (repo override beats the account `false` from step 17)
21. `GET /api/account/status?window=24h` — cookie → expect `200` `{snapshot}` reflecting the connected account
22. `GET /api/auth/info` — cookie → expect `200` `{hasGitHub:true,hasGitHubAccount:true,hasGitHubInstallations:true}`

### Variations
- Skip steps 11–12 (personal-only onboarding) and run step 14 against the personal installation id.
- Run step 19 before step 17 — repo overrides do not depend on account preferences existing.
- `DELETE /api/settings/repositories/acme-labs/payments-api` → `200` `{resolved,raw}` with every override reset to null; `resolved.autoCreatePr` falls back to the account value.

### Edge Cases
- Auth failure: any of steps 13–22 without the cookie → `401 {"error":"Not authenticated"}`.
- Validation failure: step 17 with `{"defaultSandboxType":"fly"}` → `400 {"error":"Invalid sandbox type"}`.
- Validation failure: step 17 with `{"defaultManagedRuntimeProfileId":"profile-that-does-not-exist"}` → `400` (unknown profile reference).
- Validation failure: step 17 with a malformed JSON body → `400 {"error":"Invalid JSON body"}`.
- Validation failure: step 19 with `{"vcpus":7}` (outside `ALLOWED_VCPU_VALUES`) → `400`.
- Validation failure: `GET /api/settings/repositories/%20/payments-api` (blank owner) → `400` from the route-params schema.
- Conflict: repeating step 9 with the already-consumed state cookie (cookies were deleted on first use) → `302 ...github=invalid_state`; the installation from step 9 is unaffected.

---

## STORY-account-and-github-11: The GitHub App webhook keeps installation state honest

**Type**: medium
**Persona**: The platform itself, reacting to GitHub. Dana's org admin changes the app's repository access, then uninstalls it.
**Goal**: Keep the app's installation records in sync with GitHub without the user doing anything.
**Preconditions**: STORY-10 installations exist. `GITHUB_WEBHOOK_SECRET` set. Every call needs `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>` and `X-GitHub-Event`.
**Ideal path**: 1 signed call per GitHub event — this is already minimal.
**Alternate paths**: The same records are also refreshed by `syncUserInstallations` from `/api/github/connection-status`, `/api/github/orgs/install-status`, `/api/github/app/install`, `/api/github/app/callback`, and `/api/github/post-link` — a push path and five pull paths writing the same table.

### Steps
1. `GET /api/github/installations` — cookie → expect `200` with `acme-labs` `repositorySelection:"selected"`
2. `POST /api/github/webhook` — headers `X-GitHub-Event: installation_repositories`, signed; body: `{"action":"added","installation":{"id":48231998,"repository_selection":"all","html_url":"https://github.com/organizations/acme-labs/settings/installations/48231998","account":{"login":"acme-labs","type":"Organization"}}}` → expect `200 {"ok":true,...}`
3. `GET /api/github/installations` — cookie → expect `200` with `acme-labs` now `repositorySelection:"all"`
4. `POST /api/github/webhook` — headers `X-GitHub-Event: installation`, signed; body: `{"action":"deleted","installation":{"id":48231998,"account":{"login":"acme-labs","type":"Organization"}}}` → expect `200 {"ok":true,"deleted":<n>}`
5. `GET /api/github/installations` — cookie → expect `200` array length 1 (personal only)
6. `GET /api/github/orgs/install-status` — cookie → expect `200` with `acme-labs` back to `installStatus:"not_installed"`
7. `GET /api/auth/info` — cookie → expect `200` `{hasGitHubInstallations:true}` (personal install still present)

### Variations
- `X-GitHub-Event: installation` with `"action":"suspend"` → `200 {"ok":true,"ignored":true,"action":"suspend"}`; records untouched.
- `X-GitHub-Event: pull_request` with `{"action":"closed","pull_request":{"number":412,"merged":true},"repository":{"name":"payments-api","owner":{"login":"acme-labs"}}}` → `200`; may dispatch background triggers and archive the matching session.
- `X-GitHub-Event: ping` → `200 {"ok":true}` (unhandled events are acknowledged, not rejected).

### Edge Cases
- Auth failure: missing `X-Hub-Signature-256` or `X-GitHub-Event` → `400 {"error":"Missing webhook headers"}`.
- Auth failure: signature computed with the wrong secret → `401`.
- Validation failure: valid signature, body `{"action":"created"}` with no `installation` object → `400`.
- Validation failure: valid signature over a non-JSON body → `400 {"error":"Invalid JSON payload"}`.
- Not found: `deleted` event for an `installation.id` with no matching rows → `200 {"ok":true,"deleted":0}` (idempotent, no 404).
- Replay: sending step 4 twice → second call `200` with `deleted:0`; safely idempotent.
