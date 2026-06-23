# Auth / OAuth / Sessions Audit Scratchpad

Domain: Auth, OAuth callbacks & session ownership.
Repo root: /Users/dennison/develop/open-agents (web app at apps/web).

## Known lessons (from docs/agents/lessons-learned.md) — DO NOT re-report fixed instances
- L26 (Auth/OAuth): BETTER_AUTH_URL pins Vercel callback; locally derived from request host. config.ts uses `getAuthBaseURLFallback` (BETTER_AUTH_URL -> VERCEL_BRANCH_URL preview -> VERCEL_URL). Appears consistent with lesson.
- L33 (Next.js): `cookies()` + `Response.redirect()` silently drops Set-Cookie. Must use NextResponse.redirect + response.cookies.set.
- L30: dynamic route param name must match folder segment.
- L105: request-start snapshot persistence must be ownership-guarded.
- L137: GitHub App callbacks that process OAuth code or installation_id must validate server-stored state nonce.

## Files read
- lib/auth/config.ts — Better Auth instance. baseURL.allowedHosts + fallback. Vercel + GitHub social providers. account.encryptOAuthTokens=true, accountLinking enabled trustedProviders vercel+github, allowDifferentEmails=true.
- lib/auth/base-url.ts — getAuthBaseURLFallback, getAllowedAuthHosts. Builds allowedHosts incl wildcards for prod/branch/vercel URLs.
- lib/auth/actions.ts — signOut server action: revokes Vercel token then auth.api.signOut then redirect("/").

## To read
- app/api/auth/[...all]/route.ts (Better Auth catch-all handler)
- app/api/auth/info/route.ts
- app/api/github/app/callback/route.ts (OAuth callback — state validation?)
- app/api/github/app/install/route.ts
- app/api/sessions/route.ts, [sessionId]/route.ts (ownership checks)
- lib/session/* (get-server-session, server)
- lib/onboarding.ts

## Candidate defects (to evaluate)
- (pending) state/nonce validation in github callback.
- (pending) ownership checks in sessions API.
- (pending) cookie-on-redirect in any redirect response.
- (pending) BETTER_AUTH_URL derivation correctness.

## Coverage gaps
- (fill as we go)
