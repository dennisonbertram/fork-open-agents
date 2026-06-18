# Auth, OAuth callbacks & session ownership — Audit Scratchpad

## Files reviewed
- [x] docs/agents/lessons-learned.md
- [x] lib/auth/config.ts
- [x] lib/auth/client.ts
- [x] lib/auth/actions.ts
- [x] lib/auth/base-url.ts (+ test)
- [x] lib/auth/username.ts (+ test)
- [x] app/api/auth/[...all]/route.ts
- [x] app/api/auth/info/route.ts (+ test)
- [x] lib/session/server.ts
- [x] lib/session/get-server-session.ts
- [x] lib/session/types.ts
- [x] lib/session/test-auth.ts
- [x] app/api/sessions/route.ts (+ tests)
- [x] app/api/sessions/[sessionId]/route.ts (+ test)
- [x] app/api/sessions/_lib/session-context.ts (+ test)
- [x] app/api/sessions/[sessionId]/chats/route.ts
- [x] app/api/sessions/[sessionId]/chats/[chatId]/route.ts
- [x] app/api/sessions/[sessionId]/chats/[chatId]/messages/route.ts
- [x] app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts
- [x] app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts
- [x] app/api/sessions/[sessionId]/chats/[chatId]/fork/route.ts
- [x] app/api/sessions/[sessionId]/code-editor/route.ts
- [x] app/api/sessions/[sessionId]/dev-server/route.ts
- [x] app/api/sessions/[sessionId]/skills/route.ts
- [x] app/api/sessions/[sessionId]/share/route.ts (deprecated)
- [x] app/api/sessions/[sessionId]/git/_lib/git-route.ts
- [x] app/api/sessions/[sessionId]/git/status/route.ts
- [x] app/api/chat/route.ts
- [x] app/api/chat/_lib/chat-context.ts
- [x] app/api/github/app/callback/route.ts
- [x] app/api/github/app/install/route.ts
- [x] app/api/github/post-link/route.ts
- [x] lib/github/actions/connection.ts
- [x] lib/redirect-safety.ts
- [x] lib/onboarding.ts
- [x] lib/inference/encryption.ts
- [x] lib/observability/diagnostic-token.ts
- [x] lib/db/sessions-cache.ts
- [x] app/shared/[shareId]/page.tsx
- [x] app/sessions/[sessionId]/layout.tsx
- [x] app/sessions/[sessionId]/chats/[chatId]/page.tsx
- [x] app/get-started/page.tsx
- [x] components/session-starter.tsx (checked authProvider usage)

## Key lessons-learned items verified
1. **LL-24**: VERIFIED — BETTER_AUTH_URL properly derived from explicit env var > VERCEL_BRANCH_URL (preview) > VERCEL_URL. Redirect URI constructed correctly.
2. **LL-33**: VERIFIED — GitHub App install/callback/post-link routes all use `NextResponse.redirect()` with `response.cookies.set()/delete()`. No plain `Response.redirect()` found with cookie manipulation. The signOut server action uses `redirect()` from next/navigation which is correct for server actions.
3. **LL-30**: VERIFIED — All session/chats routes use `{ params }: { params: Promise<{ sessionId: string; chatId?: string }> }` with correct param destructuring.
4. **LL-137**: FAILED in github app callback — state cookie is SET but never VALIDATED (see finding 1).
5. **LL-138**: Not verified (out of scope for this run, but noted).

## Verified — NO issues found

### BETTER_AUTH_URL derivation (lib/auth/base-url.ts)
- Production: Uses BETTER_AUTH_URL if set, otherwise VERCEL_URL (stable production domain).
- Preview: Prefers VERCEL_BRANCH_URL (branch alias, stable across redeploys) over VERCEL_URL.
- Local: Without BETTER_AUTH_URL, no fallback → Better Auth derives redirect_uri from request host.
- Allowed hosts include loopback, production, and wildcard subdomains. Correct.

### Session ownership checks
- All API routes under /api/sessions/[sessionId]/... use session-context helpers (requireAuthenticatedUser, requireOwnedSession, requireOwnedSessionChat, requireOwnedSessionWithSandboxGuard).
- Server pages at session layout level check `sessionRecord.userId !== session.user.id` and redirect.
- The chat context in app/api/chat/_lib/chat-context.ts duplicates the same pattern with additional response format support.
- No unauthorized session access paths found.

### Cookie security on redirects
- All GitHub App redirect routes use NextResponse.redirect() with response.cookies.set()/delete(). 
- Cookie attributes: secure (production only), httpOnly, sameSite=lax, path=/. Correct.
- Test auth cookie also uses HttpOnly and SameSite=Lax.

### Redirect safety (lib/redirect-safety.ts)
- sanitizeInternalRedirect validates origin matches request URL, preventing open redirects.
- All caller sites pass req.url as the base URL parameter.

### Session cache (lib/db/sessions-cache.ts)
- Uses React.cache() for per-request deduplication. No stale-ownership concerns.

### Secret handling
- Encryption key derivation uses SHA-256 with domain prefix. Correct.
- Diagnostic tokens use HMAC-SHA256 with timing-safe comparison. Correct.

## Confirmed findings

### Finding 1: Missing CSRF state validation in GitHub App setup callback (Medium, High confidence)
**Files**: app/api/github/app/callback/route.ts:22-28 (deletes state without validation), app/api/github/app/install/route.ts:56 (generates state), app/api/github/app/install/route.ts:33 (stores state cookie)
**Observed**: The `github_app_install_state` cookie (set via generateState() in install/route.ts:56, stored at line 33) is only deleted in the callback handler (line 25) but NEVER read or validated against the `state` query parameter from the GitHub callback URL. This directly violates LL-137 which states "GitHub App callbacks ... must validate a server-stored state nonce before linking accounts or syncing installations."
**Trigger**: An attacker crafts a URL like `https://example.com/api/github/app/callback?installation_id=<ATTACKER_ID>&setup_action=install` and tricks an authenticated victim into visiting it. The callback processes arbitrary installation_id/state parameters without any CSRF protection.
**Impact**: Cross-site request forgery on the GitHub App setup callback. An attacker can cause a victim's browser to sync installations with arbitrary parameters, potentially causing confusion or UI state corruption. The impact is bounded because actual GitHub App installation requires the user to complete the flow on GitHub.com first.
**Fix**: At the top of the callback handler, read `requestUrl.searchParams.get("state")` and compare it against `cookieStore.get("github_app_install_state")?.value`. Reject (400/403) on mismatch.

### Finding 2: Session authProvider hardcoded to "vercel" regardless of actual OAuth provider (Low, High confidence)
**Files**: lib/session/server.ts:36, lib/session/get-server-session.ts:37
**Observed**: Both session functions hardcode `authProvider: "vercel"` in the returned Session object. The Better Auth `auth.api.getSession()` returns the user's session but the code never inspects which provider (Vercel vs GitHub) was used to authenticate. A GitHub-only user would be reported as `authProvider: "vercel"`.
**Impact**: Client-side UI (session-starter.tsx:97,222) incorrectly shows Vercel-connected state for GitHub-only users, showing Vercel project selection UI that cannot succeed. However, actual Vercel API calls are gated by token availability (getUserVercelToken returns null for GitHub-only users), so the security impact is bounded by defense-in-depth in the API layer.
**Trigger**: Sign in via GitHub OAuth at `/api/auth/sign-in/social` with provider=github. Check `/api/auth/info` response — `authProvider` field reports "vercel" despite GitHub sign-in.

## Coverage gaps
- Did not verify LL-138 (full-page GitHub installation sync pagination) — requires reading `lib/github/sync.ts`
- Did not verify LL-139 (user-token installation sync before redirect) — `post-link/route.ts` looks correct but not deeply audited
- Did not audit Better Auth social providers plugin internals for CSRF/state — Better Auth is a dependency
- Did not verify token revocation completeness in `lib/auth/actions.ts` (signOut)
- Did not trace all workflow paths that consume authSession for authProvider-dependent behavior
