# Git/GitHub Audit Scratchpad

## Domain Scope
- Git branch/commit/PR/discard operations
- GitHub App install/sync/webhooks
- Fork-push PR fallback
- Branch safety
- Connection status

## Key Files (to review systematically)
### Core APIs
- `apps/web/app/api/github/app/callback/route.ts` - OAuth callback
- `apps/web/app/api/github/app/install/route.ts` - Install URL
- `apps/web/app/api/github/webhook/route.ts` - Webhook handler
- `apps/web/app/api/github/connection-status/route.ts` - Connection status

### Session Git APIs
- `apps/web/app/api/sessions/[sessionId]/git/branch/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/commit/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/discard/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/pr/generate/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/pr/merge/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/pr/close/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/pr/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/pr/readiness/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/status/route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/_lib/git-route.ts`
- `apps/web/app/api/sessions/[sessionId]/git/_lib/git-errors.ts`

### Lib modules
- `apps/web/lib/git/actions/branch.ts`
- `apps/web/lib/git/actions/discard.ts`
- `apps/web/lib/git/branches.ts`
- `apps/web/lib/git/helpers.ts`
- `apps/web/lib/git/queries/status.ts`
- `apps/web/lib/github/app.ts`
- `apps/web/lib/github/access.ts`
- `apps/web/lib/github/client.ts`
- `apps/web/lib/github/commit.ts`
- `apps/web/lib/github/commit-intent.ts`
- `apps/web/lib/github/pulls.ts`
- `apps/web/lib/github/sync.ts`
- `apps/web/lib/github/token.ts`
- `apps/web/lib/github/tools.ts`
- `apps/web/lib/github/urls.ts`
- `apps/web/lib/github/actions/commit.ts`
- `apps/web/lib/github/actions/connection.ts`
- `apps/web/lib/github/actions/pr.ts`
- `apps/web/lib/github/queries/pr.ts`
- `apps/web/lib/github/queries/deployment.ts`
- `apps/web/lib/github/repos.ts`
- `apps/web/lib/github/users.ts`
- `apps/web/lib/github/status.ts`
- `apps/web/lib/github/repo-dashboard.ts`
- `apps/web/lib/github/pr-content.ts`
- `apps/web/lib/github/installation-repos.test.ts`

## Lessons Learned (Git/GitHub domain)
1. **STATE_CSRF (L137)**: Callbacks processing OAuth `code` or `installation_id` MUST validate a server-stored `state` nonce. Never trust callback query params without CSRF/state verification.
2. **INSTALL_SYNC_PRUNE (L138)**: Installation sync must fetch ALL GitHub API pages (`per_page=100` + pagination) before pruning DB records. Pruning from a partial page silently removes valid installations.
3. **USER_TOKEN_SYNC_BEFORE_REDIRECT (L139)**: Do user-token installation sync before redirecting after OAuth-only callbacks or treating zero local installation rows as "not installed".
4. **FORK_PUSH_FALLBACK (L140)**: Public upstream repos may reject direct branch pushes; PR generation should fall back to creating/pushing to user's fork, using qualified head ref (`forkOwner:branch`).
5. **FORK_RETRY (L141)**: Fork creation can be slow; PR fallback should retry fork push on transient `repository not found` errors.
6. **PUSH_DENIED_DETECTION (L142)**: Git push failures from Vercel sandboxes can return empty output even when auth/write is denied; shouldn't rely only on text matching "permission".
7. **FAST_FAIL_403 (L143)**: When GitHub App lacks push access, fail fast with 403 directing to /settings/connections rather than silently forking.

## Assumptions
- The codebase uses Better Auth for session/auth.
- GitHub App OAuth flow: callback at `/api/github/app/callback` with `code` and optional `installation_id`.
- Session git operations go through Vercel Sandboxes.
- PR generation involves: get diff from sandbox -> create branch -> commit -> push -> create PR.
- Fork fallback for PR generation when direct push fails.

## Review Progress
- [ ] Read `app/api/github/app/callback/route.ts` (CSRF check)
- [ ] Read `app/api/github/webhook/route.ts` (webhook auth)
- [ ] Read `app/api/github/app/install/route.ts` (install flow)
- [ ] Read `lib/github/sync.ts` (installation sync + pagination)
- [ ] Read `lib/github/token.ts` (token management)
- [ ] Read `app/api/sessions/[sessionId]/git/pr/generate/route.ts` (PR gen + fork fallback)
- [ ] Read `lib/github/actions/pr.ts` (PR actions)
- [ ] Read `lib/github/actions/commit.ts` (commit actions)
- [ ] Read `app/api/sessions/[sessionId]/git/commit/route.ts` (commit route)
- [ ] Read `app/api/sessions/[sessionId]/git/discard/route.ts` (discard - branch safety)
- [ ] Read `lib/git/actions/discard.ts` (discard action)
- [ ] Read `app/api/sessions/[sessionId]/git/branch/route.ts` (branch route)
- [ ] Read `lib/git/actions/branch.ts` (branch action)
- [ ] Read `lib/github/app.ts` (GitHub App helpers)
- [ ] Read `lib/github/access.ts` (access control)
- [ ] Read `lib/github/client.ts` (GitHub API client)

## Candidate Defects - RESOLVED

### C1: CSRF/state validation in callback (L137) - CONFIRMED MISSING
- `app/api/github/app/install/route.ts:56` generates `state` via `generateState()`, stores in cookie `github_app_install_state` (line 33)
- `app/api/github/app/callback/route.ts:34-92` NEVER reads the `state` query param and NEVER compares to stored cookie
- Cookie is only deleted at line 26 in `redirectAndClearCookies`, never validated
- Impact limited: callback doesn't create DB records from URL params; sync uses user's own token
- SameSite=Lax on cookie provides some protection
- Severity: MEDIUM - defense-in-depth gap on a documented protection

### C2: Installation sync pagination (L138) - VERIFIED FIXED
- `lib/github/sync.ts:100-145` fetches ALL pages (per_page=100, loops until page < per_page)
- `deleteInstallationsNotInList` only called after full page collection (line 168)
- Correct fix in place.

### C3: Fork push retry (L141) - N/A in current code
- Current commit flow uses GitHub API commits (lib/github/actions/commit.ts), not sandbox git push-to-fork
- `pushBranchToRemote` (line 55-88) is only called when there are already-pushed commits
- No fork fallback path found in current active code paths

### C4: Push denied detection (L142) - N/A with API-based commits
- `pushBranchToRemote` checks `pushResult.success` and error text, but is a secondary path
- Primary commit path uses GitHub API direct commits; access control checked via `verifyRepoAccess`
- The `isPermissionPushError` function exists in `generate-pr/_lib/generate-pr-helpers.ts:30-42` for legacy path

### C5: 403 fast-fail (L143) - PARTIALLY ADDRESSED
- `verifyRepoAccess` (lib/github/access.ts:70-147) detects lost push access (user_no_access, app_no_access)
- Fails fast with descriptive errors before any mutation
- Error message for app_no_access says "Ask an org admin to update the app's repository permissions"
- Does NOT specifically direct to /settings/connections as lesson recommends
- But DOES fail fast rather than silently forking

### C6: Branch safety in discard - SAFE
- `discardChanges` uses `git reset --hard HEAD` and `git clean -fd` (lib/git/actions/discard.ts:215-235)
- Only affects sandbox workspace, not remote
- Commit flow creates new branches when on base/detached (lib/github/actions/commit.ts:166-194)
- All branch names validated with `isSafeBranchName` before use

### C7: Webhook signature validation - VERIFIED CORRECT
- `app/api/github/webhook/route.ts:51-64` validates HMAC SHA-256 with `timingSafeEqual`
- `x-hub-signature-256` header checked at line 163-167
- 401 returned for invalid signatures (line 171-174)

## Confirmed Findings for Report

### FINDING: git-github-1 — Missing CSRF State Validation
- File: `apps/web/app/api/github/app/callback/route.ts`
- Lines 34-92: callback handler never validates `state` param against stored cookie
- Severity: MEDIUM | Category: security | Confidence: HIGH

### FINDING: git-github-2 — Connection Status Silently Reports "connected" on Sync Error
- File: `apps/web/app/api/github/connection-status/route.ts`
- Lines 78-85: non-auth sync errors default to `status: "connected"` with stale data
- Severity: MEDIUM | Category: observability | Confidence: HIGH
