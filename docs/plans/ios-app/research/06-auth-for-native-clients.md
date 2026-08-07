# Auth for Native (iOS) Clients — Ground-Truth Brief

Researched June 2026 against the actual working tree (`feat/agents-phase6-authored-tools`).
All claims below are grounded in repo code or the *installed* better-auth package
(`better-auth@1.6.5`, pinned in `apps/web/package.json:56` and `bun.lock:1126`). Where I
inspected library internals I cite the installed dist files (resolved via bun's store; the
`apps/web/node_modules/better-auth` symlink points at
`node_modules/.bun/better-auth@1.6.5+.../`).

---

## 1. Better Auth server setup (`apps/web/lib/auth/config.ts`)

The single `betterAuth()` instance lives at `apps/web/lib/auth/config.ts:44-118`. There is
**no other** `betterAuth(` call in the repo.

### Plugins: NONE are enabled

The config has **no `plugins:` array at all**. Specifically:

- **No `bearer` plugin** — `Authorization: Bearer` is ignored today.
- **No `genericOAuth` plugin** — Vercel and GitHub are *built-in* social providers (see below).
- **No `deviceAuthorization`, `oneTimeToken`, `jwt`, `apiKey`, or `expo`** plugin.
- Client side (`apps/web/lib/auth/client.ts:1-7`): `createAuthClient` with only
  `inferAdditionalFields<typeof auth>()` — a type-level plugin, no runtime auth behavior.

However, better-auth 1.6.5 **ships** `bearer`, `device-authorization`, `one-time-token`,
`generic-oauth`, `jwt`, `mcp`, etc. in-box (verified:
`apps/web/node_modules/better-auth/dist/plugins/` contains `bearer/`,
`device-authorization/`, `one-time-token/` directories). Enabling them is a config change,
not a dependency change. The Expo helper (`@better-auth/expo`) is a **separate package, not
installed**.

### Core options

- `secret: process.env.BETTER_AUTH_SECRET` (config.ts:45) — HMAC key for signing session
  cookies/tokens.
- **Dynamic baseURL** (config.ts:46-49): `baseURL: { allowedHosts, fallback }` — the newer
  1.6.x object form. `allowedHosts` comes from `getAllowedAuthHosts()`
  (`apps/web/lib/auth/base-url.ts:50-81`): always includes `localhost:*`, `127.0.0.1:*`,
  `[::1]:*` (+ `:3000` variants), plus the hosts (and `*.<host>` wildcards) derived from
  `BETTER_AUTH_URL`, `VERCEL_BRANCH_URL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`,
  `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`. `fallback` comes from
  `getAuthBaseURLFallback()` (base-url.ts:30-48): `BETTER_AUTH_URL` → preview branch URL →
  `https://VERCEL_URL` → undefined.
- **trustedOrigins**: not set explicitly. In 1.6.5, trusted origins are *derived from*
  `baseURL.allowedHosts` (each host becomes `https://<host>`, plus `http://` for
  localhost/127.0.0.1) plus the fallback origin — verified in
  `better-auth/dist/context/helpers.mjs:59-84` (`getTrustedOrigins`). **Crucially, line
  ~81-83 also reads the `BETTER_AUTH_TRUSTED_ORIGINS` env var (comma-separated) and appends
  it** — so a custom iOS scheme like `openagents://` can be added as a trusted origin with
  *zero code change*, just an env var.
- **Database**: Drizzle adapter over Postgres (config.ts:51-59). Tables:
  `users` (schema.ts:70), `accounts` (schema.ts:84, OAuth provider tokens),
  `auth_sessions` (schema.ts:103, columns: `id`, `expiresAt`, **`token` (unique)**,
  `ipAddress`, `userAgent`, `userId`), `verification` (schema.ts:117, OAuth state +
  one-time values). IDs generated with `nanoid()` (config.ts:113-117).
- **Session storage**: DB-backed (`session.modelName: "auth_sessions"`, config.ts:84-86).
  **No `cookieCache`** — every `getSession` hits Postgres.
- **OAuth token handling**: `account.encryptOAuthTokens: true` (config.ts:89) — provider
  access/refresh tokens are stored encrypted in `accounts`. Account linking enabled with
  `trustedProviders: ["vercel", "github"]`, `allowDifferentEmails: true` (config.ts:90-94).

### Session cookie: name, format, duration (better-auth defaults — nothing overridden)

Verified in installed lib (`dist/cookies/index.mjs:17-46`, `dist/context/create-context.mjs:143-145`):

- Cookie name: **`better-auth.session_token`**; in production/https it gets the secure
  prefix → **`__Secure-better-auth.session_token`**. Attributes: `HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Secure` (prod).
- Cookie value: **signed token** = `<rawToken>.<HMAC-SHA256(rawToken, BETTER_AUTH_SECRET)
  base64url-nopad>`, URL-encoded (the `.`-separated signature is what the bearer plugin
  later verifies). The **raw token** is what's stored in `auth_sessions.token`.
- Duration: `expiresIn` default **7 days**; `updateAge` default **24 h** (session is rolled
  forward when used after 1 day); `freshAge` 24 h. An active iOS user would therefore stay
  signed in indefinitely; 7 days idle ⇒ re-login.

### Social providers (built-in, not generic-oauth)

- **Vercel** (config.ts:97-105): better-auth ships a first-class `vercel` provider
  (verified `@better-auth/core/dist/social-providers/vercel.mjs`): authorize URL
  `https://vercel.com/oauth/authorize`, token `https://api.vercel.com/login/oauth/token`,
  userinfo `https://api.vercel.com/login/oauth/userinfo`. **PKCE is mandatory**
  (`codeVerifier is required for Vercel`). Repo config pins
  `redirectURI = <fallback origin>/api/auth/callback/vercel` (config.ts:40-42), scope
  `["openid", "email", "profile"]`, `overrideUserInfoOnSignIn: true`.
  Env: `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` / `VERCEL_APP_CLIENT_SECRET`.
  Per `.env.example`, the Vercel OAuth app must register every callback origin
  (production + `http://localhost:3000/api/auth/callback/vercel`).
- **GitHub** (config.ts:106-110): standard GitHub provider using the **GitHub App's**
  client id/secret (`NEXT_PUBLIC_GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`). Callback:
  `{origin}/api/auth/callback/github`. Used for *linking* (repo access), not primary
  sign-in (the only sign-in button is Vercel —
  `apps/web/components/auth/sign-in-button.tsx:58-61`,
  `authClient.signIn.social({ provider: "vercel", callbackURL })`).
- Username derivation: `deriveAuthUsername` (`apps/web/lib/auth/username.ts`) +
  `additionalFields.username` on the user model (config.ts:66-69).

### Handler & endpoints

- `/api/auth/[...all]/route.ts` is the whole better-auth surface:
  `export const { GET, POST } = toNextJsHandler(auth)` (route.ts:4). With no plugins, the
  relevant endpoints are: `POST /api/auth/sign-in/social`, `GET /api/auth/callback/:provider`,
  `POST /api/auth/link-social`, `GET /api/auth/get-session`, `POST /api/auth/sign-out`,
  `POST /api/auth/get-access-token`, etc. **There are no token-issuing endpoints today**
  (no `/token`, no device endpoints, no OTT endpoints).
- Sign-in social accepts `disableRedirect: true` and returns `{ url, redirect }` JSON
  (verified `dist/api/routes/sign-in.mjs:18,143-146`) — a native client can fetch the
  provider authorize URL without following redirects.
- `GET /api/auth/info` (`apps/web/app/api/auth/info/route.ts`) is the app's own session
  probe: returns `{ user, authProvider, isAdmin, hasGitHub, hasGitHubAccount,
  hasGitHubInstallations }` (`SessionUserInfo`, `apps/web/lib/session/types.ts:13-20`), or
  `{ user: undefined }` when unauthenticated (always HTTP 200). Ideal as the iOS
  "who am I / is GitHub connected" bootstrap call.
- Sign-out: web uses a **server action** (`apps/web/lib/auth/actions.ts:35-59`) that also
  revokes the Vercel OAuth token via `https://api.vercel.com/login/oauth/token/revoke`
  before `auth.api.signOut`. A native client can't call server actions; it would POST
  `/api/auth/sign-out` directly (which does **not** revoke the Vercel token — parity gap to
  note in the plan).

### Rate limiting

Not configured in the repo; better-auth defaults apply (verified
`dist/context/create-context.mjs:166-171`): enabled in production, window 10 s, max 100,
**memory storage** (per serverless instance). Device-flow polling or aggressive retries
from iOS could trip this; it's per-path on `/api/auth/*` only.

---

## 2. How requests are authenticated today (and whether Bearer works)

### Resolution path

Two helpers, both **cookie-only**:

- `getSessionFromReq(req)` (`apps/web/lib/session/server.ts:16-45`) — route handlers.
- `getServerSession()` (`apps/web/lib/session/get-server-session.ts:17-47`) — RSC pages +
  route handlers (React `cache()`-wrapped).

Both do: (1) check the **test-auth cookie** (see §3); (2) call
`auth.api.getSession({ headers })` passing the *full* incoming headers; (3) map to the
app's `Session` shape (`lib/session/types.ts:1-11`). Note both **hardcode
`authProvider: "vercel"`** (server.ts:36, get-server-session.ts:37).

`auth.api.getSession` resolves the session **only from the signed session cookie** in the
`cookie` header. **`Authorization: Bearer` is dead weight today** — without the bearer
plugin, nothing reads it. There is **no API-key path, no PAT path, no service-token path
for user-facing routes**. (The only Bearer check in the app is the cron route:
`apps/web/app/api/background-agents/cron/route.ts:6` compares against
`CRON_SECRET`/`BACKGROUND_AGENTS_CRON_SECRET` — machine-to-machine only. Harness routes
use an *outgoing* `HARNESS_SERVICE_TOKEN`; inbound access still goes through the user
session via `requireHarnessRunAccess`.)

### Enforcement is per-route, not middleware

The only Next middleware is `apps/web/proxy.ts:12-35` (Next 16 `proxy`) and it does **zero
auth** — it just rewrites `GET /shared/:id` to a markdown API route for
`Accept: text/markdown` clients. ~30 API route files individually call
`getServerSession`/`getSessionFromReq` (e.g. `app/api/sessions/...`, `app/api/chat/...`,
`app/api/github/...`, `app/api/settings/...`) and return 401/redirect themselves. Pages do
the same (e.g. `app/page.tsx:6-8` redirects signed-in users to `/sessions`).

### SSE / streaming routes authenticate identically

- `POST /api/chat` (starts a run, streams AI SDK UI-message chunks),
- `GET /api/chat/[chatId]/stream` (resumable stream; auth via
  `requireAuthenticatedUser()` → `getServerSession()` then ownership check
  `requireOwnedChatById` — see `app/api/chat/[chatId]/stream/route.ts:18-32` and
  `app/api/chat/_lib/chat-context.ts`),
- `GET /api/harness/runs/[runId]/events` (SSE with `Last-Event-ID` replay).

Because they all funnel through the same two helpers that pass full request headers into
`auth.api.getSession`, **enabling the bearer plugin transparently upgrades every one of
these routes — including SSE — to accept `Authorization: Bearer`** with no per-route edits
(see §4).

### Session token format a native client would hold

Either of:
- the **signed cookie value** `<token>.<sig>` (what the bearer plugin calls a signed token), or
- the **raw `auth_sessions.token`** (returned by e.g. the device-flow `access_token` or in
  the OTT verify response body) — the bearer plugin accepts raw tokens too and signs them
  server-side unless `requireSignature: true` is set (verified
  `dist/plugins/bearer/index.mjs`, the `token.includes(".")` branch).

---

## 3. Test-auth path (`OPEN_AGENTS_ENABLE_TEST_AUTH`) — gift for iOS dev

`apps/web/lib/session/test-auth.ts`:

- Enabled when `NODE_ENV === "development"` **or** `OPEN_AGENTS_ENABLE_TEST_AUTH === "1"`
  (test-auth.ts:6-11). So it's *always on* under `bun run web` locally.
- Cookie: name **`open_agents_test_user_id`**, value must equal exactly
  **`dev-managed-runtime-user`** (test-auth.ts:3-4, 37-40). Both helpers check it *before*
  better-auth (server.ts:19-24, get-server-session.ts:20-25), returning a synthetic session
  for user id `dev-managed-runtime-user` (username `managed-runtime-demo`).
- It is a plain cookie-header string compare — **an iOS client can simply send a static
  header `Cookie: open_agents_test_user_id=dev-managed-runtime-user` on every request**
  (including SSE) against a dev server and be fully authenticated. No OAuth needed for
  development.
- `GET /api/dev/managed-runtime-demo` (`app/api/dev/managed-runtime-demo/route.ts:4-14`)
  both seeds demo data and Set-Cookies the test cookie (`HttpOnly; SameSite=Lax;
  Max-Age=86400`, test-auth.ts:55-62).
- Caveats: the synthetic user has no GitHub link/installations, and writes attribute to the
  `dev-managed-runtime-user` row (must exist in DB for FK-bearing writes; the demo route
  seeds it). Local dev server for this repo runs on **:3002** per project memory.

---

## 4. CSRF / origin protections, and exactly what a native client needs

### What blocks (and doesn't block) a native client today

Better-auth's origin/CSRF middleware applies **only to `/api/auth/*` routes** (the app's
own API routes have no CSRF checks; they're cookie-auth + ownership checks only). Verified
in `dist/api/middlewares/origin-check.mjs`:

- GET/HEAD/OPTIONS are exempt (line 40).
- For POSTs, `validateOrigin` **only runs when the request carries a `cookie` header**
  (line 102: `if (!(forceValidate || useCookies)) return;`). A cookie-less native POST to
  `/api/auth/sign-in/social` or `/one-time-token/verify` is **not origin-checked** (the
  Fetch-Metadata `formCsrfMiddleware` also passes: native URLSession sends no
  `Sec-Fetch-*` headers, so it falls through; lines 123-144).
- **The trap**: if a request has a cookie header but **no `Origin`/`Referer`**, POSTs to
  `/api/auth/*` are rejected 403 `MISSING_OR_NULL_ORIGIN` (line 103). iOS `URLSession`
  **stores cookies automatically by default** (`HTTPCookieStorage`), so after any response
  that Set-Cookies a session, subsequent auth POSTs (e.g. sign-out) would carry a cookie
  without an Origin and get 403. Mitigations: use an ephemeral
  `URLSessionConfiguration` with `httpCookieStorage = nil` / `httpShouldSetCookies =
  false` and rely purely on `Authorization: Bearer`, or always send an `Origin:` header
  matching a trusted origin.
- `callbackURL` values in auth POST bodies are validated against trusted origins
  (origin-check.mjs:44-64). Relative paths are allowed; an `openagents://...` callback URL
  is allowed **only if** `openagents://` is a trusted origin
  (`matchesOriginPattern`, `dist/auth/trusted-origins.mjs`: for non-http schemes it's a
  `startsWith` match). Add via `BETTER_AUTH_TRUSTED_ORIGINS=openagents://` env var
  (helpers.mjs reads it) or a `trustedOrigins` array in config.

### (a) ASWebAuthenticationSession login ending with a native session token

There is no path today that delivers a token to a native app. Recommended minimal,
grounded design (all pieces ship inside better-auth 1.6.5):

1. **Enable plugins in `lib/auth/config.ts`**: `bearer()` and `oneTimeToken()`
   (both in `better-auth/plugins`; OTT stores its tokens in the existing `verification`
   table — **no schema migration**; bearer needs no schema either).
2. **Add `openagents://` (app scheme) to trusted origins** — env var or config.
3. **Native flow**:
   - App POSTs `/api/auth/sign-in/social` (no cookies → no origin check) with
     `{ provider: "vercel", callbackURL: "/native-auth/complete", disableRedirect: true }`
     → gets `{ url }` (the Vercel authorize URL; server-side PKCE+state stored in
     `verification`).
   - App opens `url` in `ASWebAuthenticationSession` (callbackURLScheme `openagents`).
   - Vercel redirects to `{server}/api/auth/callback/vercel`; better-auth creates the
     session, Set-Cookies it *in the in-app browser*, and 302s to `/native-auth/complete`.
   - **New tiny page/route `/native-auth/complete`** (the only new server code): it has the
     fresh session cookie, calls `auth.api.generateOneTimeToken` (or client-side
     `GET /api/auth/one-time-token/generate` — session-gated,
     `dist/plugins/one-time-token/index.mjs:35-43`), then redirects to
     `openagents://auth?ott=<token>` (valid 3 min by default).
   - `ASWebAuthenticationSession` returns that URL to the app; app POSTs
     `/api/auth/one-time-token/verify` with `{ token }` (cookie-less → no origin check).
     Response is the **full session JSON (`{ session: { token, expiresAt, ... }, user }`)**
     and, with the bearer plugin enabled, a **`set-auth-token` response header** carrying
     the signed token (bearer after-hook fires on any response that sets the session
     cookie — `dist/plugins/bearer/index.mjs` after-hook; OTT verify calls
     `setSessionCookie`, index.mjs:57). URLSession reads either; store in Keychain.
   - Alternative with zero new pages: replicate `@better-auth/expo`'s server plugin
     (~40 lines: intercept OAuth callback, append session token to a trusted-scheme
     callback) — but OTT keeps the token out of better-auth internals and is simpler to
     reason about.
   - Another alternative: **`deviceAuthorization()` plugin** (in-box;
     `dist/plugins/device-authorization/routes.mjs`): `POST /api/auth/device/code` →
     user approves in any browser → `POST /api/auth/device/token` returns
     `{ access_token: <raw session token>, token_type: "Bearer", expires_in }`
     (routes.mjs:244-278). Requires a `deviceCode` table (**schema migration**) and a
     small approval page; worse UX than ASWebAuthenticationSession for a phone, fine as a
     fallback or for TV/CLI.

4. **GitHub OAuth as primary sign-in for iOS** is also possible (`provider: "github"`,
   same flow) since both providers are configured; but product-wise Vercel is the sign-in
   provider and GitHub is a *link*.

### (b) Bearer auth on every API route incl. SSE

- Enable `bearer()` in the plugins array. Its **before-hook runs on `auth.api.getSession`
  calls too** (matcher checks `context.headers` as well as `context.request` —
  `dist/plugins/bearer/index.mjs` before-hook), and both app helpers already forward the
  full request headers (`server.ts:26-28`, `get-server-session.ts:27-29`). It rewrites the
  context's `cookie` header to contain the session cookie derived from the Bearer token,
  so **all ~30 session-gated API routes, all RSC pages, and the three SSE/streaming routes
  work with `Authorization: Bearer <token>` with no further server changes.**
- Decide `requireSignature`: default accepts the **raw** DB token (it signs it
  server-side); `requireSignature: true` accepts only the signed `<token>.<sig>` form.
  Recommend storing the signed token (from `set-auth-token` or by signing at issuance) and
  setting `requireSignature: true`.
- Token lifetime for Bearer == session lifetime (7 d, rolled forward every 24 h of use).
  If the plan wants longer-lived mobile sessions, override `session.expiresIn` (global —
  affects web too) or mint mobile sessions via a custom endpoint; flag as a decision.
- The test-auth path (§3) is cookie-name based and unaffected; for dev convenience the
  iOS client can keep using the static test cookie header locally.

---

## 5. GitHub linking & GitHub App install from a native context

Two distinct steps in this product, both currently **cookie-session web flows**:

1. **GitHub OAuth account link** — web calls `authClient.linkSocial({ provider: "github",
   callbackURL })` (`app/settings/accounts-section.tsx:117,557`,
   `app/get-started/get-started-flow.tsx:361`) → `POST /api/auth/link-social` (needs the
   session cookie + passes origin check) → browser does GitHub OAuth →
   `/api/auth/callback/github` stores the token in `accounts` → redirect to
   `/api/github/post-link` (`app/api/github/post-link/route.ts:61` chains into the app
   install).
2. **GitHub App installation** — `GET /api/github/app/install`
   (`app/api/github/app/install/route.ts:67+`): requires `getServerSession()` (cookie),
   sets two state cookies (`github_app_install_redirect_to`, `github_app_install_state`,
   15-min, SameSite=Lax — install/route.ts:15-21), redirects to
   `https://github.com/apps/<NEXT_PUBLIC_GITHUB_APP_SLUG>/installations/new`; GitHub's
   "Setup URL" returns to `GET /api/github/app/callback`
   (`app/api/github/app/callback/route.ts:34+`), which **again requires the cookie
   session**, reads the state cookies, syncs installations via the user's GitHub token,
   and redirects to an internal page with `?github=<status>` query params.

**Native implications:**

- The flow *can* run in an `ASWebAuthenticationSession`/`SFSafariViewController` sheet,
  **but the browser sheet must hold the user's web session cookie**, which a
  Bearer-only iOS app does not share. The clean bridge is the same OTT trick in reverse:
  add a route like `GET /native-auth/bridge?ott=...&next=/api/github/app/install...` that
  verifies the OTT (verify **sets the session cookie** in the sheet —
  `one-time-token/index.mjs:57`), then redirects into the existing install/link flow; end
  the flow on a page that redirects to `openagents://github-linked?status=...` so the
  sheet closes. OTTs are single-use and short-lived, so mint one per bridge hop
  (the app can mint them any time via authenticated `GET /api/auth/one-time-token/generate`
  with its Bearer token).
- Redirect constraints: GitHub App callback ("Setup URL") and OAuth callback URLs are
  **fixed, registered HTTPS URLs on the server origin** — they cannot point at a custom
  scheme, so the server must always terminate these flows and only the *final* hop can be
  `openagents://`. `sanitizeInternalRedirect` (used in install/callback routes) restricts
  `next` to internal paths, so the final custom-scheme hop needs either an allowed internal
  page that performs the scheme redirect client-side, or a small change to allow
  registered native callbacks.
- Status reporting: callback encodes results as query params (`github=app_installed`,
  `request_sent`, `pending_sync`, `not_linked`, `missing_installation_id=1` —
  callback/route.ts:79-92); the native side can parse these from the final URL.
- Post-link verification API already exists: `GET /api/auth/info` returns
  `hasGitHubAccount` / `hasGitHubInstallations`, and `GET /api/github/connection-status`,
  `/api/github/installations`, `/api/github/orgs/install-status` are normal session-gated
  JSON routes that will work over Bearer once the plugin is on.

---

## 6. Concrete server-side change list for the iOS plan

| # | Change | Size | Schema migration? |
|---|--------|------|-------------------|
| 1 | Add `bearer({ requireSignature: true })` to `plugins` in `lib/auth/config.ts` | ~3 lines | No |
| 2 | Add `oneTimeToken()` to `plugins` | ~2 lines | No (uses `verification` table) |
| 3 | Add native scheme to trusted origins (`BETTER_AUTH_TRUSTED_ORIGINS=openagents://` env, or `trustedOrigins` in config) | env-only possible | No |
| 4 | New `/native-auth/complete` page/route: session-cookie → OTT → `openagents://auth?ott=` redirect | small | No |
| 5 | New `/native-auth/bridge` route: OTT → session cookie → redirect into link/install flows (for GitHub linking from iOS) | small | No |
| 6 | (Optional) native sign-out parity: endpoint that revokes Vercel token + `auth.api.signOut` (mirrors `lib/auth/actions.ts:35-59`) | small | No |
| 7 | (Fallback option) `deviceAuthorization()` plugin + approval page | medium | **Yes** (`deviceCode` table) |
| 8 | Regression tests: Bearer on a session-gated route + on `GET /api/chat/[chatId]/stream`; OTT round-trip; origin-check 403 case | medium | — |

No changes are needed to the ~30 existing API routes or the SSE routes — they all resolve
auth through `getSessionFromReq`/`getServerSession`, which inherit Bearer support from the
plugin.

---

## 7. Known uncertainties (marked explicitly)

- **Bearer + `auth.api.getSession({ headers })`**: verified by reading the installed
  plugin's matcher/handler (checks `context.headers`), and this is the documented pattern,
  but I did not execute a runtime proof in this session. The plan should include an
  integration test before relying on it (repo discipline requires red/green proof anyway).
- **`pickSource` host requirement**: direct `auth.api` calls with `headers` need a
  `host`/`x-forwarded-host` header or the dynamic baseURL falls back to `fallback`
  (`dist/context/helpers.mjs:91-98`). Requests forwarded from Next route handlers always
  carry `host`, so this is theoretical, but matters if anyone calls `getSession` with
  synthetic headers.
- **Vercel OAuth app policy**: whether Vercel's OAuth app registration imposes extra
  constraints (e.g., user-agent restrictions inside ASWebAuthenticationSession) was not
  verifiable from the repo. The server-terminated callback design avoids needing a custom
  scheme registered with Vercel at all.
- **better-auth minor-version drift**: all library line numbers refer to 1.6.5 exactly
  (`^1.6.5` range in package.json means a future install could move internals; the
  *behaviors* cited — bearer, OTT, device flow, `BETTER_AUTH_TRUSTED_ORIGINS` — are public
  documented APIs and stable).
