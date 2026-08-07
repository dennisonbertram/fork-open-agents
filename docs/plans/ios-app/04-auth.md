# 04 — Auth End to End

Part of the iOS app build plan. Siblings: `00-overview.md`, `01-product-and-ux.md`,
`02-api-contract-and-networking.md`, `03-architecture.md`, `05-streaming-chat-engine.md`,
`06-testing-strategy.md`, `07-observability.md`, `08-ci-cd-release.md`,
`09-step-by-step-build-guide.md`.

This document specifies authentication end to end: the **server workstream** (changes to
`apps/web` that a weak model must make first) and the **iOS workstream** (sign-in,
token storage, rotation, bootstrap, 401 handling, sign-out, account deletion).

All server claims below were verified against the working tree and the installed
`better-auth@1.6.5` package (pinned via `apps/web/package.json`; dist files at
`apps/web/node_modules/better-auth/dist/`).

---

## 1. Fixed decisions (restated, not re-decided)

| Decision | Value | Why (one line) |
|---|---|---|
| Token mechanism | better-auth `bearer()` plugin, `requireSignature: true` | One config change upgrades the entire API surface, including SSE |
| Browser→app handoff | Expo-style deep-link handoff, hardened: deep link carries a **one-time token (OTT)**, not the session cookie | Single-use, 3-minute TTL, hashed at rest; session token never appears in any URL |
| Custom scheme | `openagents://` | Registered in `trustedOrigins` and in the app's `CFBundleURLTypes` |
| Sign-in providers (iOS v1) | Vercel OAuth (primary, via `ASWebAuthenticationSession`) + Sign in with Apple (native, no browser) | Vercel is the product identity; Apple is required by App Store guideline 4.8 |
| Account deletion | better-auth `user.deleteUser.enabled: true` → `POST /api/auth/delete-user` | App Store guideline 5.1.1(v); all app tables cascade on user delete |
| iOS token storage | Keychain, `kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` | Device-bound session; no iCloud Keychain sync |
| iOS HTTP client | swift-openapi-generator 1.12.2 + URLSession transport + `AuthMiddleware: ClientMiddleware` | Per `02-api-contract-and-networking.md` |
| Multi-account | **Out of scope v1** | Single Keychain slot; see §10 |
| iOS bundle identifier | `com.openagents.ios` | Must match the value pinned in `08-ci-cd-release.md` and the Apple provider's `appBundleIdentifier` |

Notation: `{baseURL}` below means the web app origin the iOS client targets
(production Vercel domain, or `http://localhost:3000` in dev — the `APIEnvironment`
type from `02-api-contract-and-networking.md`).

---

## 2. Ground truth: how server auth works today

Read these files before changing anything:

| File | Fact |
|---|---|
| `apps/web/lib/auth/config.ts` | The single `betterAuth()` instance. **No `plugins:` key. No `trustedOrigins` key. No `user.deleteUser`.** Social providers: `vercel` (primary sign-in, PKCE mandatory) and `github` (repo-access linking). `session.modelName: "auth_sessions"`. `account.encryptOAuthTokens: true`, `accountLinking.trustedProviders: ["vercel", "github"]`. |
| `apps/web/app/api/auth/[...all]/route.ts` | `export const { GET, POST } = toNextJsHandler(auth)` — the entire better-auth HTTP surface. |
| `apps/web/lib/session/server.ts` | `getSessionFromReq(req)` — used by API route handlers. Checks the test-auth cookie, then calls `auth.api.getSession({ headers: req.headers })`. |
| `apps/web/lib/session/get-server-session.ts` | `getServerSession()` — used by RSC pages and some routes. Same two steps, React `cache()`-wrapped. |
| `apps/web/lib/session/types.ts` | `Session` and `SessionUserInfo` shapes (see §8.4). |
| `apps/web/app/api/auth/info/route.ts` | `GET /api/auth/info` — session probe; always HTTP 200; returns `{ user: undefined }` when signed out. |
| `apps/web/lib/auth/actions.ts` | Web sign-out is a **server action** that revokes the Vercel OAuth token at `https://api.vercel.com/login/oauth/token/revoke` and then calls `auth.api.signOut`. Native clients cannot call server actions. |
| `apps/web/lib/session/test-auth.ts` | Dev-only cookie auth: `Cookie: open_agents_test_user_id=dev-managed-runtime-user` (enabled when `NODE_ENV === "development"` or `OPEN_AGENTS_ENABLE_TEST_AUTH === "1"`). |

**The single most important fact:** every session read in the entire app — ~30 API
route files, all RSC pages, and the SSE routes (`POST /api/chat`,
`GET /api/chat/[chatId]/stream`, `GET /api/harness/runs/[runId]/events`) — flows
through exactly two helpers, `apps/web/lib/session/server.ts` and
`apps/web/lib/session/get-server-session.ts`, and both pass the **full request
headers** into `auth.api.getSession({ headers })`. The bearer plugin's before-hook
converts an `Authorization: Bearer` header into the session cookie inside that call.
Therefore enabling the plugin upgrades the whole API surface — JSON routes, RSC, and
SSE — **with zero per-route edits and zero edits to the two helpers themselves**.

Session/cookie mechanics (better-auth 1.6.5 defaults; repo overrides nothing):

- Cookie name `better-auth.session_token` (prod: `__Secure-better-auth.session_token`).
- Cookie value = signed token `<rawToken>.<HMAC-SHA256(rawToken, BETTER_AUTH_SECRET) base64url-nopad>`.
  The raw token is the `auth_sessions.token` column. **The bearer token is this same
  signed value.**
- Lifetime: `expiresIn` 7 days, `updateAge` 24 h (sliding window — any authenticated
  request more than 24 h after the last roll extends expiry to now + 7 days; the token
  **value never changes** for the life of the session, only `expiresAt` moves),
  `freshAge` 24 h (matters for account deletion, §3.6).
- Sessions are DB rows; revocation is immediate (next request 401s).

---

## 3. Server workstream (do this first — one PR into `develop`)

Follow `docs/process/behavior-tdd.md`: write the failing tests in §3.8 first, confirm
red, then implement A1–A7, then run `bun --bun run ci`.

Protected user path: "a native client can sign in via browser handoff, call every
session-gated API (including SSE) with `Authorization: Bearer`, sign out, and delete
its account." No web behavior may change (web continues on cookies; the bearer plugin
is additive).

### 3.1 A1 — Enable `bearer()` and `oneTimeToken()` plugins

Edit `apps/web/lib/auth/config.ts`. Add one import and one `plugins` key. Neither
plugin needs a schema migration (`bearer` is stateless; `oneTimeToken` stores tokens
in the existing `verification` table).

```ts
// apps/web/lib/auth/config.ts  (additions only — keep everything else as-is)
import { bearer, oneTimeToken } from "better-auth/plugins";

export const auth = betterAuth({
  // ...existing options unchanged...
  plugins: [
    bearer({ requireSignature: true }),
    oneTimeToken({ expiresIn: 3, storeToken: "hashed" }),
  ],
});
```

Option semantics (verified in `apps/web/node_modules/better-auth/dist/plugins/bearer/index.mjs`
and `.../one-time-token/index.mjs`):

- `bearer({ requireSignature: true })` — accepts only the full signed
  `<token>.<sig>` value (the `set-auth-token` value); raw unsigned tokens are
  rejected. The before-hook verifies the HMAC against `BETTER_AUTH_SECRET` and
  injects `better-auth.session_token=<signed>` into the context's `cookie` header.
- `oneTimeToken({ expiresIn: 3, storeToken: "hashed" })` — adds
  `GET /api/auth/one-time-token/generate` (session-gated; returns `{ token }`) and
  `POST /api/auth/one-time-token/verify` (public; body `{ token }`; single-use;
  3-minute TTL; SHA-256-hashed at rest in `verification`). Verify returns the full
  session JSON **and sets the session cookie**, which makes the bearer after-hook fire
  → the response carries `set-auth-token`.

### 3.2 A2 — `trustedOrigins`

In the same `betterAuth({ ... })` call, add a top-level key:

```ts
  trustedOrigins: ["openagents://", "https://appleid.apple.com"],
```

Why each entry:

- `"openagents://"` — better-auth validates `callbackURL` / `errorCallbackURL` values
  and `Origin` headers against trusted origins. For non-http schemes the match is
  prefix-based, so this whitelists every `openagents://...` deep link. Without it,
  the redirect in §3.3 is rejected as an open redirect.
- `"https://appleid.apple.com"` — required by the better-auth Apple provider docs for
  the web-side Apple flow (harmless for the native idToken flow; include it now so the
  web app can add an Apple button later without a config change).

Env-only alternative (no code): better-auth 1.6.5 also appends the comma-separated
`BETTER_AUTH_TRUSTED_ORIGINS` env var to trusted origins (verified in
`apps/web/node_modules/better-auth/dist/context/helpers.mjs`, `getTrustedOrigins`).
Use the config array as the durable source of truth; use the env var only for
temporary preview-deployment experiments.

### 3.3 A3 — Native sign-in completion route (the deep-link handoff)

Create a **new file** `apps/web/app/api/native-auth/complete/route.ts`. Do **not**
place it under `app/api/auth/` — that subtree belongs to the better-auth catch-all.

This route runs inside the in-app browser at the end of the OAuth dance, where the
fresh session cookie exists. It converts the cookie session into a one-time token and
bounces to the app scheme:

```ts
// apps/web/app/api/native-auth/complete/route.ts
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";

const NATIVE_CALLBACK = "openagents://auth";

export async function GET(req: NextRequest) {
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError) {
    // better-auth redirected here via errorCallbackURL with ?error=<code>
    return Response.redirect(
      `${NATIVE_CALLBACK}?error=${encodeURIComponent(oauthError)}`,
      303,
    );
  }
  try {
    const { token } = await auth.api.generateOneTimeToken({
      headers: req.headers,
    });
    return Response.redirect(
      `${NATIVE_CALLBACK}?ott=${encodeURIComponent(token)}`,
      303,
    );
  } catch {
    // No session cookie present (cancelled / expired dance)
    return Response.redirect(`${NATIVE_CALLBACK}?error=sign_in_failed`, 303);
  }
}
```

Notes for the implementer:

- `auth.api.generateOneTimeToken({ headers })` throws a better-auth `APIError` (401)
  when the headers carry no valid session cookie — the `catch` handles that.
- The redirect target is a custom scheme; `Response.redirect` accepts any absolute
  URL. `ASWebAuthenticationSession` intercepts the `Location` header and never
  performs a network fetch of `openagents://...`.
- Never put the session token itself in this URL. Only the OTT.

### 3.4 A4 — Sign in with Apple provider

App Store guideline 4.8 ("Login Services"): an app whose primary account is set up
via a third-party login service (Vercel OAuth qualifies) must offer an equivalent
privacy-preserving option. Sign in with Apple is the zero-ambiguity choice. Plan
assumption: 4.8 applies; ship SIWA in v1 (the "client for a specific third-party
service" exemption is a reviewer-dependent gamble — see §11).

#### 3.4.1 Apple Developer portal prerequisites (manual, one-time)

1. App ID `com.openagents.ios` with the **Sign in with Apple** capability enabled.
2. A **Sign in with Apple key** (`.p8` file) under Certificates → Keys. Record the
   **Key ID** and the **Team ID**.
3. (Only needed if the web app later adds an Apple button) a Services ID with the web
   domain and `{baseURL}/api/auth/callback/apple` as a return URL. The native idToken
   flow does not use it.

#### 3.4.2 Client secret generation script

Apple's `client_secret` is an ES256 JWT with a maximum 180-day validity —
**operational task: regenerate and update the env var at least every ~5 months**
(add a calendar reminder; see `08-ci-cd-release.md` release checklist).

Create `apps/web/scripts/generate-apple-client-secret.ts`:

```ts
// apps/web/scripts/generate-apple-client-secret.ts
// Usage:
//   APPLE_TEAM_ID=XXXXXXXXXX APPLE_KEY_ID=YYYYYYYYYY \
//   APPLE_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)" \
//   APPLE_CLIENT_ID=com.openagents.ios \
//   bun run apps/web/scripts/generate-apple-client-secret.ts
import { importPKCS8, SignJWT } from "jose";

const teamId = process.env.APPLE_TEAM_ID;
const keyId = process.env.APPLE_KEY_ID;
const privateKeyPem = process.env.APPLE_PRIVATE_KEY;
const clientId = process.env.APPLE_CLIENT_ID;
if (!(teamId && keyId && privateKeyPem && clientId)) {
  console.error(
    "Missing env: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID",
  );
  process.exit(1);
}

const key = await importPKCS8(privateKeyPem, "ES256");
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: keyId })
  .setIssuer(teamId)
  .setIssuedAt()
  .setExpirationTime("179d") // Apple max is 180 days
  .setAudience("https://appleid.apple.com")
  .setSubject(clientId)
  .sign(key);
console.log(jwt);
```

`jose` is already a transitive dependency of better-auth; add it as a direct
`devDependency` of `apps/web` if `bun run` cannot resolve it:
`bun add --cwd apps/web --dev jose`.

#### 3.4.3 Config change

In `apps/web/lib/auth/config.ts`:

1. Add a profile mapper next to the existing `mapVercelProfileToUser` /
   `mapGitHubProfileToUser` functions:

```ts
function mapAppleProfileToUser(profile: {
  sub: string;
  email?: string;
  name?: string;
}): { username: string } {
  return {
    username: deriveAuthUsername({
      id: profile.sub,
      email: profile.email,
      name: profile.name,
    }),
  };
}
```

2. Add the provider inside `socialProviders`:

```ts
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? "",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
      appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER ?? "",
      mapProfileToUser: mapAppleProfileToUser,
    },
```

3. Extend account linking: change
   `trustedProviders: ["vercel", "github"]` to
   `trustedProviders: ["vercel", "github", "apple"]`.

4. Add the env vars to `apps/web/.env.example` (values blank, with comments):
   `APPLE_CLIENT_ID` (= `com.openagents.ios` for native-only; the Services ID once a
   web button exists), `APPLE_CLIENT_SECRET` (output of §3.4.2),
   `APPLE_APP_BUNDLE_IDENTIFIER` (= `com.openagents.ios`).

`appBundleIdentifier` is load-bearing: an identity token minted on-device by
`ASAuthorizationAppleIDProvider` has `aud = <bundle id>`, not the Services ID.
better-auth 1.6.5 validates the audience as
`audience ?? appBundleIdentifier ?? clientId` (verified in
`@better-auth/core/dist/social-providers/apple.mjs`, `verifyIdToken`). Without this
option every native Apple sign-in fails JWT audience validation.

Nonce: better-auth compares the request-body `idToken.nonce` **verbatim** against the
token's `nonce` claim (`if (nonce && jwtClaims.nonce !== nonce) return false`), and
Apple embeds the string set on `ASAuthorizationAppleIDRequest.nonce` verbatim in the
claim. So the iOS app sends the **same** nonce string in both places (§8.6). No
hashing across this boundary.

Known cosmetic gap (do not fix in this PR): both session helpers hardcode
`authProvider: "vercel"` (`apps/web/lib/session/server.ts`,
`apps/web/lib/session/get-server-session.ts`), so an Apple-only user reports
`authProvider: "vercel"` in `GET /api/auth/info`. The iOS app must not branch on
`authProvider`. File a follow-up ticket to derive it from the `accounts` rows.

Product gap to carry into `01-product-and-ux.md`: an Apple-only user has no Vercel
token (sandboxes run on the user's Vercel account) and no GitHub installation. The
app must gate those features and offer "Connect Vercel" / "Connect GitHub" via the
bridge route (§3.7).

### 3.5 A5 — Sign-out (native parity route)

`POST /api/auth/sign-out` (better-auth built-in) revokes the better-auth session but
does **not** revoke the Vercel OAuth token — that logic lives in the server action
`apps/web/lib/auth/actions.ts`, which native clients cannot call.

1. Extract the revocation helper so both callers share it. Create
   `apps/web/lib/auth/revoke-vercel-token.ts` containing `revokeVercelToken` and
   `getRevocableVercelToken` moved verbatim from `apps/web/lib/auth/actions.ts`
   (export both; update `actions.ts` to import them). Per the repo's
   file-organization rule, do not append to `actions.ts`.

2. Create `apps/web/app/api/native-auth/sign-out/route.ts`:

```ts
// apps/web/app/api/native-auth/sign-out/route.ts
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getRevocableVercelToken,
  revokeVercelToken,
} from "@/lib/auth/revoke-vercel-token";
import { getSessionFromReq } from "@/lib/session/server";

export async function POST(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
    const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const token = await getRevocableVercelToken(session.user.id);
      if (token) {
        await revokeVercelToken({ token, clientId, clientSecret });
      }
    }
  } catch {
    // best-effort revocation; never block sign-out
  }
  await auth.api.signOut({ headers: req.headers });
  return Response.json({ success: true });
}
```

Because `getSessionFromReq` and `auth.api.signOut({ headers })` both go through the
bearer plugin, this route works with `Authorization: Bearer` and no cookies.

### 3.6 A6 — Account deletion (App Store guideline 5.1.1(v))

Guideline 5.1.1(v): apps that support account creation must let users initiate
account deletion **inside the app**. There is no deletion path in the repo today
(verified: no `delete-user` / `deleteAccount` route under `apps/web/app/api`).

better-auth 1.6.5 ships the endpoint; enabling it is config-only. In
`apps/web/lib/auth/config.ts`, extend the existing `user` block:

```ts
  user: {
    modelName: "users",
    fields: { image: "avatarUrl" },
    additionalFields: {
      username: { type: "string", required: true },
      lastLoginAt: { type: "date", required: false },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        // Best-effort: revoke the Vercel OAuth token before the row disappears.
        try {
          const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
          const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
          if (clientId && clientSecret) {
            const token = await getRevocableVercelToken(user.id);
            if (token) {
              await revokeVercelToken({ token, clientId, clientSecret });
            }
          }
        } catch {
          // never block deletion on revocation failure
        }
      },
    },
  },
```

(Import the two helpers from `@/lib/auth/revoke-vercel-token`, created in §3.5.)

Endpoint behavior (verified in
`apps/web/node_modules/better-auth/dist/api/routes/update-user.mjs`):

- `POST /api/auth/delete-user`, body `{}` (send an empty JSON object; **do not send
  `password`** — these are OAuth-only users with no credential account, and a
  `password` field returns 400 `CREDENTIAL_ACCOUNT_NOT_FOUND`).
- Requires a **fresh** session: created within `freshAge` (default 24 h). A stale
  session gets 400 `SESSION_EXPIRED`. iOS UX for this is specified in §8.9. Do not
  set `freshAge: 0` (that would disable freshness globally, weakening the web app).
- On success: deletes the `users` row, deletes all sessions, clears the session
  cookie, returns `{ "success": true, "message": "User deleted" }`.
- Data cleanup: every FK to `users.id` in `apps/web/lib/db/schema.ts` declares
  `onDelete: "cascade"` (verified — all 33 references), so sessions, chats,
  preferences, agents, background agents, usage events, Composio profiles, etc. are
  deleted transactionally with the user row. External side effects that survive:
  GitHub App installations on the user's org (GitHub-side object) and any live Vercel
  sandboxes (expire on their own). Note both in App Review notes.

### 3.7 A7 — Bridge route for browser-bound flows (GitHub link / GitHub App install / Composio connect)

GitHub OAuth linking (`POST /api/auth/link-social`) and the GitHub App install
(`GET /api/github/app/install`) are cookie-session web flows with fixed HTTPS
callbacks — they must run in a browser sheet that **holds the user's session
cookie**, which a bearer-only app does not share. Bridge the bearer session into a
browser cookie with the OTT mechanism in reverse:

Create `apps/web/app/api/native-auth/bridge/route.ts`:

```ts
// apps/web/app/api/native-auth/bridge/route.ts
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";

export async function GET(req: NextRequest) {
  const ott = req.nextUrl.searchParams.get("ott");
  const next = sanitizeInternalRedirect(
    req.nextUrl.searchParams.get("next"),
    "/sessions",
  );
  if (!ott) {
    return Response.json({ error: "Missing ott" }, { status: 400 });
  }
  // asResponse gives us the Response whose Set-Cookie establishes the session
  const verifyResponse = await auth.api.verifyOneTimeToken({
    body: { token: ott },
    asResponse: true,
  });
  if (!verifyResponse.ok) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  const redirect = new Response(null, {
    status: 303,
    headers: { Location: next },
  });
  const setCookie = verifyResponse.headers.get("set-cookie");
  if (setCookie) {
    redirect.headers.set("set-cookie", setCookie);
  }
  return redirect;
}
```

Check `sanitizeInternalRedirect`'s actual signature in
`apps/web/lib/redirect-safety.ts` before wiring (it is already used by
`apps/web/app/api/github/app/install/route.ts` and
`apps/web/app/api/github/post-link/route.ts`); adjust the call to match.

Native usage (specified fully in `01-product-and-ux.md`): the app mints an OTT via
authenticated `GET /api/auth/one-time-token/generate`, opens
`{baseURL}/api/native-auth/bridge?ott=<ott>&next=/api/github/app/install` in
`ASWebAuthenticationSession`, and the existing web flows run with a real cookie
session. The flow's terminal page reports status via query params
(`?github=app_installed`, etc.); v1 simply closes the sheet on user dismissal and
re-fetches `GET /api/auth/info` to observe `hasGitHubInstallations`. The OTT is
single-use: mint a fresh one per bridge hop.

### 3.8 A8 — Tests (write these FIRST; confirm red before A1–A7)

| # | File (create) | Asserts |
|---|---|---|
| 1 | `apps/web/lib/session/bearer-session.test.ts` | Sign in a test user via `auth.api` to obtain a signed token; build a `NextRequest` with only `Authorization: Bearer <signed>` (no cookie); `getSessionFromReq` returns the session. With a tampered signature → `undefined`. With a raw unsigned token → `undefined` (because `requireSignature: true`). |
| 2 | `apps/web/app/api/native-auth/complete/route.test.ts` | (a) request with valid session cookie → 303 with `Location` starting `openagents://auth?ott=`; (b) request without session → 303 to `openagents://auth?error=sign_in_failed`; (c) request with `?error=access_denied` → 303 to `openagents://auth?error=access_denied`. |
| 3 | `apps/web/app/api/native-auth/ott-roundtrip.test.ts` | Generate OTT with a session; `POST /api/auth/one-time-token/verify` with `{ token }` returns 200 session JSON **and** a `set-auth-token` response header; the same token a second time → 400. |
| 4 | `apps/web/app/api/native-auth/sign-out/route.test.ts` | Bearer-authenticated POST → 200 `{ success: true }` and the session row is gone (subsequent `getSessionFromReq` with the same bearer → `undefined`); unauthenticated → 401. |
| 5 | `apps/web/app/api/auth/delete-user.test.ts` | With `deleteUser.enabled`, a fresh-session bearer POST to `/api/auth/delete-user` with `{}` → 200 `{ success: true }`; the `users` row and a seeded `sessions` row are gone (cascade); a stale session (forge `createdAt` 25 h old) → 400. |
| 6 | SSE bearer proof (manual + regression note) | `curl -N -H "Authorization: Bearer <signed>" {baseURL}/api/chat/<chatId>/stream` returns 200 with `x-vercel-ai-ui-message-stream: v1` (cross-ref `05-streaming-chat-engine.md`); record as observability evidence in the PR. |

Run: `bun test apps/web/lib/session/bearer-session.test.ts` (and each file), then the
adjacent suite, then `git diff --check`, then `bun --bun run ci`.

Follow the existing route-test patterns in the repo (e.g.
`apps/web/app/api/settings/runtime-profiles/[profileId]/route.test.ts`) for mocking
conventions.

### 3.9 A9 — Which responses carry `set-auth-token` (reference table)

The bearer after-hook runs only inside the better-auth HTTP pipeline
(`/api/auth/*` via the catch-all) and only when the response sets a non-empty session
cookie. Verified consequences:

| Response | Carries `set-auth-token`? |
|---|---|
| `POST /api/auth/one-time-token/verify` | **Yes** — this is where the iOS app first obtains the token |
| `POST /api/auth/sign-in/social` with `idToken` (Apple native) | **Yes** — token arrives on this same response; no deep-link dance |
| `GET /api/auth/get-session` | Only when the sliding window rolls (last roll > 24 h ago). Same token value, extended expiry |
| `GET /api/auth/callback/vercel` | Yes, but unreadable (it is a browser redirect inside the sheet) |
| `POST /api/auth/sign-out` | No (cookie is being cleared; hook skips `max-age=0`) |
| **All app API routes** (`/api/sessions`, `/api/chat`, `/api/settings/*`, SSE, …) | **Never.** They resolve auth via in-process `auth.api.getSession({ headers })`; better-auth's response headers are discarded by the route handler. The DB-side expiry extension still happens, so normal API usage keeps the session alive. |

Practical upshot: the token value is stable for the session's lifetime; rotation
handling on iOS (§8.5) is a cheap safety net, not a hot path.

### 3.10 Server workstream checklist

- [ ] Tests from §3.8 written and red
- [ ] A1 `bearer({ requireSignature: true })` + `oneTimeToken({ expiresIn: 3, storeToken: "hashed" })` in `apps/web/lib/auth/config.ts`
- [ ] A2 `trustedOrigins: ["openagents://", "https://appleid.apple.com"]`
- [ ] A3 `apps/web/app/api/native-auth/complete/route.ts`
- [ ] A4 Apple provider + `mapAppleProfileToUser` + `trustedProviders` + secret script + `.env.example` entries
- [ ] A5 `apps/web/lib/auth/revoke-vercel-token.ts` extraction + `apps/web/app/api/native-auth/sign-out/route.ts`
- [ ] A6 `user.deleteUser.enabled: true` with `beforeDelete` revocation
- [ ] A7 `apps/web/app/api/native-auth/bridge/route.ts`
- [ ] All tests green; `git diff --check`; `bun --bun run ci`
- [ ] OpenAPI spec updated for the new `native-auth` routes per the contract-expansion workstream in `02-api-contract-and-networking.md` (extend `apps/web/lib/api/openapi-spec.ts`; keep `scripts/check-openapi.ts` green)
- [ ] PR into `develop` with SSE bearer curl evidence attached

---

## 4. The Vercel sign-in redirect chain, exactly

```
(1) iOS app
      POST {baseURL}/api/auth/sign-in/social
      Headers: Content-Type: application/json, Origin: openagents://
      Body: {"provider":"vercel",
             "callbackURL":"/api/native-auth/complete",
             "errorCallbackURL":"/api/native-auth/complete",
             "disableRedirect":true}
      <- 200 {"url":"https://vercel.com/oauth/authorize?client_id=...&state=...&code_challenge=...","redirect":true}

(2) iOS app opens url in ASWebAuthenticationSession (callbackURLScheme "openagents")
      User authenticates on vercel.com (PKCE + state held server-side in `verification`)

(3) Vercel
      302 -> {baseURL}/api/auth/callback/vercel?code=...&state=...

(4) better-auth callback handler
      validates state, exchanges code (PKCE), creates `auth_sessions` row
      <- Set-Cookie: __Secure-better-auth.session_token=<token>.<sig>; HttpOnly; SameSite=Lax; Path=/; Secure
      <- 302 Location: /api/native-auth/complete

(5) In-app browser follows with the fresh cookie
      GET {baseURL}/api/native-auth/complete
      route calls auth.api.generateOneTimeToken({ headers })  // session-gated
      <- 303 Location: openagents://auth?ott=<32-char one-time token>

(6) ASWebAuthenticationSession intercepts the openagents:// redirect,
      invokes the completion handler with the URL, dismisses the sheet.
      The ephemeral browser jar (and its session cookie) is discarded.

(7) iOS app
      POST {baseURL}/api/auth/one-time-token/verify
      Headers: Content-Type: application/json, Origin: openagents://   (no cookies, no Authorization)
      Body: {"token":"<ott>"}
      <- 200 {"session":{"token":"...","expiresAt":"...",...},"user":{...}}
      <- set-auth-token: <token>.<sig>            // store THIS value

(8) iOS app stores the set-auth-token value in the Keychain, then
      GET {baseURL}/api/auth/info  with Authorization: Bearer <token>.<sig>
      <- 200 SessionUserInfo  -> signed-in app state
```

Failure chain: if the user cancels at Vercel or the dance fails, better-auth
redirects to `errorCallbackURL` with `?error=<code>`; step (5) forwards it as
`openagents://auth?error=<code>`. If the user dismisses the sheet itself,
`ASWebAuthenticationSession` completes with
`ASWebAuthenticationSessionError.canceledLogin` — treat as silent cancel.

Why steps (1) and (7) pass better-auth's CSRF middleware without a browser origin:
`validateOrigin` only runs on `/api/auth/*` POSTs that carry a `cookie` header on the
wire (verified in `apps/web/node_modules/better-auth/dist/api/middlewares/origin-check.mjs`).
The iOS client never sends cookies (§8.2), so the check is skipped. The client still
sends `Origin: openagents://` (a trusted origin) on every `/api/auth/*` POST as
belt-and-braces, so behavior is correct even if a cookie ever leaks into the jar.

---

## 5. The Sign in with Apple chain, exactly

No browser, no deep link, no OTT:

```
(1) User taps the system SignInWithAppleButton
(2) ASAuthorizationAppleIDProvider request: scopes [.fullName, .email], nonce = <random 32-byte hex>
(3) Apple returns ASAuthorizationAppleIDCredential { identityToken, ... }
(4) iOS app
      POST {baseURL}/api/auth/sign-in/social
      Headers: Content-Type: application/json, Origin: openagents://
      Body: {"provider":"apple",
             "idToken":{"token":"<identityToken as UTF-8 string>","nonce":"<same nonce string>"}}
      <- 200 {"user":{...},"session":{...}}  (or {"token":...,"user":...} shape — decode leniently)
      <- set-auth-token: <token>.<sig>
(5) Store token in Keychain; GET /api/auth/info; signed in.
```

Server verifies the identity token against Apple's JWKS with
`aud = APPLE_APP_BUNDLE_IDENTIFIER` and compares the `nonce` claim verbatim (§3.4.3).

Apple sends `email` and the user's name **only on first authorization**; better-auth
persists them at user creation. Subsequent sign-ins carry only the stable `sub`.

---

## 6. iOS workstream — module layout

Auth code lives in the local SPM package `ios/Packages/OpenAgentsAuth` (see
`03-architecture.md` for the package graph). Files this plan requires:

| File | Responsibility |
|---|---|
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/KeychainTokenStore.swift` | Keychain CRUD for the session token (§8.3) |
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/AuthMiddleware.swift` | `ClientMiddleware`: bearer header, rotation, 401 signal (§8.5) |
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/SignInCoordinator.swift` | ASWebAuthenticationSession flow + callback parsing (§8.1–8.2) |
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/AppleSignInCoordinator.swift` | Native SIWA flow (§8.6) |
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/AuthSession.swift` | `@Observable` auth state machine (§8.7) |
| `ios/Packages/OpenAgentsAuth/Sources/OpenAgentsAuth/SessionUserInfo.swift` | Bootstrap model (§8.4) — hand-written until `/api/auth/info` joins the OpenAPI spec |
| `ios/Packages/OpenAgentsAuth/Tests/OpenAgentsAuthTests/*` | Swift Testing unit tests (§9) |

App-target wiring (in `ios/App`):

- `project.yml` registers the URL scheme and the SIWA entitlement:

```yaml
# ios/App/project.yml (excerpt)
targets:
  OpenAgents:
    entitlements:
      path: OpenAgents.entitlements
      properties:
        com.apple.developer.applesignin: [Default]
    info:
      properties:
        CFBundleURLTypes:
          - CFBundleURLName: com.openagents.ios.auth
            CFBundleURLSchemes: [openagents]
```

`ASWebAuthenticationSession` does not require the scheme in `Info.plist` (it
intercepts in-process), but registering it enables cold-start handling of any stray
`openagents://` opens (e.g. the GitHub bridge terminal page) via SwiftUI
`.onOpenURL`.

---

## 7. iOS sign-in state machine

```
                 +-----------------+
                 |  .unknown       |  app launch
                 +--------+--------+
                          | KeychainTokenStore.load()
            token absent  |          token present
        +-----------------+------------------+
        v                                    v
+---------------+                  GET /api/auth/info (Bearer)
| .signedOut    |                     |            |
| (sign-in view)|        user != nil  |            |  user == nil OR 401
+-------+-------+                     v            v
        |                      +-------------+   clear Keychain
        | Vercel or Apple flow | .signedIn   |<--------+
        +--------------------->| (SessionUserInfo)     |
                               +------+------+         |
                                      | any API 401    |
                                      +----------------+
```

States live in `AuthSession` (`@Observable`, `@MainActor`):
`case unknown, signedOut(reason: SignOutReason?), signedIn(SessionUserInfo)`.

---

## 8. iOS implementation specifics

### 8.1 ASWebAuthenticationSession (Vercel sign-in)

```swift
// SignInCoordinator.swift (core sequence; error handling elided here, required in code)
@MainActor
final class SignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
  func signInWithVercel(api: APIClient, tokens: KeychainTokenStore) async throws {
    // Step 1: ask the server for the provider authorize URL (no cookies, no auth)
    let start = try await api.post(
      path: "/api/auth/sign-in/social",
      body: SignInSocialRequest(
        provider: "vercel",
        callbackURL: "/api/native-auth/complete",
        errorCallbackURL: "/api/native-auth/complete",
        disableRedirect: true
      )
    ) // decodes { url: String, redirect: Bool }

    guard let authorizeURL = URL(string: start.url) else {
      throw AuthError.malformedAuthorizeURL
    }

    // Step 2: run the browser dance
    let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
      let session = ASWebAuthenticationSession(
        url: authorizeURL,
        callback: .customScheme("openagents") // iOS 17.4+ API; fine on iOS 26
      ) { url, error in
        if let error {
          cont.resume(throwing: error) // .canceledLogin => silent cancel upstream
        } else if let url {
          cont.resume(returning: url)
        } else {
          cont.resume(throwing: AuthError.emptyCallback)
        }
      }
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = false // allow Safari SSO with vercel.com
      session.start()
    }

    // Step 3: parse openagents://auth?ott=... (see 8.2), exchange, store
    let ott = try Self.parseOneTimeToken(from: callbackURL)
    let verify = try await api.postRaw(
      path: "/api/auth/one-time-token/verify",
      body: ["token": ott]
    )
    guard verify.status == 200,
          let token = verify.headerFields[HTTPField.Name("set-auth-token")!] else {
      throw AuthError.tokenExchangeFailed(status: verify.status.code)
    }
    try await tokens.replace(token)
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    ASPresentationAnchor() // resolve the key window's anchor in real code
  }
}
```

Decisions encoded above:

- `prefersEphemeralWebBrowserSession = false` (default): a user already signed into
  vercel.com in Safari gets near-instant SSO; iOS shows the standard consent alert.
- `.customScheme("openagents")`: v1 uses the custom scheme. `.https` Universal-Link
  callbacks (more phishing-resistant) are deferred — they require an
  `apple-app-site-association` file on the web origin and a different server
  redirect; the single-use 3-minute OTT already mitigates scheme hijacking (§11).
- The OTT exchange (`/api/auth/one-time-token/verify`) is sent with **no**
  `Authorization` header and no cookies.

### 8.2 Callback URL parsing and cookie hygiene

```swift
static func parseOneTimeToken(from url: URL) throws -> String {
  // Expected: openagents://auth?ott=<token>  or  openagents://auth?error=<code>
  guard url.scheme == "openagents",
        url.host == "auth",
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
    throw AuthError.unexpectedCallback(url.redactedForLogging)
  }
  if let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
    if error == "access_denied" { throw AuthError.userCancelled }
    throw AuthError.serverRejected(code: error)
  }
  guard let ott = components.queryItems?.first(where: { $0.name == "ott" })?.value,
        !ott.isEmpty else {
    throw AuthError.missingToken
  }
  return ott
}
```

Cookie hygiene — the shared `URLSession` used by the API client (and the SSE client
in `05-streaming-chat-engine.md`) MUST be configured so no cookie ever rides along:

```swift
let configuration = URLSessionConfiguration.ephemeral
configuration.httpCookieStorage = nil
configuration.httpShouldSetCookies = false
configuration.httpCookieAcceptPolicy = .never
```

Rationale: a stored cookie on a `/api/auth/*` POST without an `Origin` header turns
on better-auth's origin validation and yields 403 `MISSING_OR_NULL_ORIGIN` (§4). The
client additionally always sends `Origin: openagents://` on `/api/auth/*` and
`/api/native-auth/*` POSTs (the `AuthMiddleware` adds it), making the requests valid
under origin validation regardless.

### 8.3 Keychain storage (exact attribute set)

Single generic-password item. Exact attributes:

| Attribute | Value |
|---|---|
| `kSecClass` | `kSecClassGenericPassword` |
| `kSecAttrService` | `"com.openagents.ios.auth"` |
| `kSecAttrAccount` | `"session-token"` |
| `kSecAttrAccessible` | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` |
| `kSecValueData` | UTF-8 bytes of the signed token (`<token>.<sig>`, verbatim from `set-auth-token`) |
| `kSecAttrSynchronizable` | **absent / false** — never sync the session via iCloud Keychain |

`...AfterFirstUnlockThisDeviceOnly` is the canonical choice (restated from the stack
decisions): readable by background networking after first unlock post-reboot,
excluded from iCloud Keychain and from encrypted device-to-device transfers — the
better-auth session records `ipAddress`/`userAgent` per row, so per-device sessions
are the natural model.

```swift
// KeychainTokenStore.swift
actor KeychainTokenStore {
  private let service = "com.openagents.ios.auth"
  private let account = "session-token"

  func load() -> String? {
    var query: [String: Any] = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func replace(_ token: String) throws {
    let data = Data(token.utf8)
    let update: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(baseQuery() as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = baseQuery()
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] =
        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
      let addStatus = SecItemAdd(add as CFDictionary, nil)
      guard addStatus == errSecSuccess else { throw AuthError.keychain(addStatus) }
    } else if status != errSecSuccess {
      throw AuthError.keychain(status)
    }
  }

  func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}
```

### 8.4 Bootstrap: `GET /api/auth/info`

First authenticated call after launch or sign-in. Always HTTP 200; signed-out is
`user == nil`. Exact server shape (`apps/web/lib/session/types.ts` +
`apps/web/app/api/auth/info/route.ts`):

```swift
// SessionUserInfo.swift — mirrors apps/web/lib/session/types.ts
struct SessionUserInfo: Codable, Equatable, Sendable {
  struct User: Codable, Equatable, Sendable {
    let id: String
    let username: String
    let email: String?    // string | undefined server-side
    let avatar: String    // always present (may be "")
    let name: String?
  }
  let user: User?                    // nil  => signed out (HTTP still 200)
  let authProvider: String?          // "vercel" | "github" (hardcoded "vercel" today; do not branch on it)
  let isAdmin: Bool?
  let hasGitHub: Bool?               // hasGitHubAccount || hasGitHubInstallations
  let hasGitHubAccount: Bool?        // GitHub OAuth account linked
  let hasGitHubInstallations: Bool?  // GitHub App installed somewhere
}
```

Bootstrap rules:

1. Keychain token present → `GET /api/auth/info` with bearer.
2. `user != nil` → `.signedIn(info)`; gate GitHub-dependent UI on
   `hasGitHubInstallations` (cross-ref `01-product-and-ux.md`).
3. `user == nil` (200) → token is dead (session expired or revoked): clear Keychain,
   `.signedOut(reason: .sessionExpired)`.
4. Network failure → keep `.unknown`, show cached UI from GRDB, retry with backoff
   (do **not** sign the user out on airplane mode).

Until `/api/auth/info` is added to `apps/web/openapi.json` (contract-expansion
workstream, `02-api-contract-and-networking.md`), this model is hand-written; once
generated into `ios/Packages/OpenAgentsAPI`, delete the hand-written copy.

### 8.5 `AuthMiddleware` (bearer attach + rotation + 401 signal)

One `ClientMiddleware` (swift-openapi-runtime) on the generated client; the SSE
engine reuses the same logic on its raw `URLSession` requests
(`05-streaming-chat-engine.md`).

```swift
// AuthMiddleware.swift
struct AuthMiddleware: ClientMiddleware {
  let tokens: KeychainTokenStore
  let onUnauthorized: @Sendable () async -> Void

  func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    if let token = await tokens.load() {
      request.headerFields[.authorization] = "Bearer \(token)"
    }
    if request.method == .post,
       request.path?.hasPrefix("/api/auth/") == true
         || request.path?.hasPrefix("/api/native-auth/") == true {
      request.headerFields[HTTPField.Name("Origin")!] = "openagents://"
    }
    let (response, responseBody) = try await next(request, body, baseURL)
    if let rotated = response.headerFields[HTTPField.Name("set-auth-token")!],
       !rotated.isEmpty {
      try? await tokens.replace(rotated)   // §3.9: same value in practice; replace is idempotent
    }
    if response.status.code == 401 {
      await onUnauthorized()
    }
    return (response, responseBody)
  }
}
```

Rotation rules (from §3.9):

- Watch **every** response for `set-auth-token`; replace the Keychain item when
  present. In practice it appears only on `/api/auth/*` responses and carries the
  same token value with extended expiry — the replace is a safety net for future
  better-auth versions that rotate the value.
- App API responses never carry it; no polling or refresh endpoint exists or is
  needed. Any authenticated request already extends the session server-side.
- Optional liveness nudge: on `scenePhase == .active` after ≥ 24 h of background,
  fire `GET /api/auth/get-session` once; if the window rolls, the response carries
  `set-auth-token` and the middleware handles it. Not required for correctness.

### 8.6 Sign in with Apple (native)

```swift
// AppleSignInCoordinator.swift (essentials)
import AuthenticationServices

@MainActor
final class AppleSignInCoordinator: NSObject {
  private var currentNonce: String?

  func makeRequest() -> ASAuthorizationAppleIDRequest {
    let nonce = Self.randomNonce()           // 32 random bytes, hex-encoded
    currentNonce = nonce
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    request.nonce = nonce                     // sent VERBATIM to the server too (§3.4.3)
    return request
  }

  func handle(_ credential: ASAuthorizationAppleIDCredential,
              api: APIClient, tokens: KeychainTokenStore) async throws {
    guard let nonce = currentNonce,
          let tokenData = credential.identityToken,
          let identityToken = String(data: tokenData, encoding: .utf8) else {
      throw AuthError.appleCredentialIncomplete
    }
    let response = try await api.postRaw(
      path: "/api/auth/sign-in/social",
      body: SignInWithIdTokenRequest(
        provider: "apple",
        idToken: .init(token: identityToken, nonce: nonce)
      )
    )
    guard response.status == 200,
          let token = response.headerFields[HTTPField.Name("set-auth-token")!] else {
      throw AuthError.tokenExchangeFailed(status: response.status.code)
    }
    try await tokens.replace(token)
  }
}
```

UI: use SwiftUI's `SignInWithAppleButton(.signIn)` on the sign-in screen, rendered
with **equal prominence** to the Vercel button (guideline 4.8 requires the
alternative be "equivalent"). Handle `ASAuthorizationError.canceled` as silent
cancel.

Post-Apple-sign-in: `GET /api/auth/info` will show `hasGitHub == false` and the user
has no Vercel connection; route them through the connect flows per
`01-product-and-ux.md` (bridge route, §3.7).

### 8.7 401 handling and re-auth UX

- **Single source of truth:** `AuthMiddleware.onUnauthorized` → `AuthSession`
  transitions to `.signedOut(reason: .sessionExpired)` after one confirmation probe:
  call `GET /api/auth/info`; only if `user == nil` clear the Keychain. (This guards
  against a single route-level 401 quirk signing the user out spuriously.)
- Never blind-retry a 401 — there is no client-side refresh path; the session token
  has no refresh token.
- UX: present the sign-in sheet modally over the current content; preserve all local
  GRDB state; on successful re-auth, retry the failed user action if it was
  idempotent (GETs), otherwise return the user to the screen they were on.
- SSE streams (chat) that receive 401 mid-stream: surface the same signal; the
  resumable-stream replay (`05-streaming-chat-engine.md`) re-attaches after re-auth.
- Distinguish from 403: 403 responses (ownership, policy) are feature-level errors,
  never sign-out triggers.

### 8.8 Sign out

1. `POST {baseURL}/api/native-auth/sign-out` with bearer (revokes the Vercel OAuth
   token server-side and kills the better-auth session). Ignore network failure after
   one retry — sign-out must always succeed locally.
2. `await tokens.clear()` (Keychain delete).
3. Wipe user-scoped GRDB tables (see `03-architecture.md` data-reset section) and any
   in-memory caches.
4. `AuthSession` → `.signedOut(reason: .userInitiated)`.

Do not call `POST /api/auth/sign-out` directly from the app — it skips Vercel token
revocation (parity gap documented in §2).

### 8.9 In-app account deletion UI (guideline 5.1.1(v))

Location: Settings → Account → **Delete Account** (must be reachable without
contacting support; reviewers check this).

Flow:

1. Confirmation screen states exactly what is deleted (account, sessions, chats,
   preferences, agents, usage history — server cascade, §3.6) and what is not
   (GitHub App installation on their org; instructions to uninstall via GitHub
   settings).
2. Require typed confirmation (`DELETE`) or `.destructive` confirmation dialog.
3. `POST {baseURL}/api/auth/delete-user` with bearer, body `{}`.
4. On `200 { success: true }`: clear Keychain, wipe GRDB, `.signedOut(reason: .accountDeleted)`,
   show a terminal "Your account was deleted" screen.
5. On `400` with `SESSION_EXPIRED` semantics (session older than 24 h, §3.6): show
   "Please sign in again to confirm deletion", run the full sign-in flow (§8.1 or
   §8.6 — produces a fresh session), then retry the delete **once** automatically.
6. On any other error: show the error, do not wipe local state.

SIWA note for App Review: with the idToken-only flow the server holds no Apple
refresh/access token, so there is nothing to revoke at
`https://appleid.apple.com/auth/revoke`; state this in the review notes alongside the
full-cascade deletion behavior.

### 8.10 Local development auth (no OAuth required)

Against a local dev server (`bun run web`, `http://localhost:3000`,
`apps/web/lib/session/test-auth.ts` active when `NODE_ENV === "development"` or
`OPEN_AGENTS_ENABLE_TEST_AUTH === "1"`):

- A `#if DEBUG`-only environment option ("Local dev server") makes the API client
  attach the static header `Cookie: open_agents_test_user_id=dev-managed-runtime-user`
  to every request **instead of** the bearer header. This authenticates everything,
  including SSE.
- Seed the demo user first: `curl http://localhost:3000/api/dev/managed-runtime-demo`.
- ATS: add `NSAppTransportSecurity > NSAllowsLocalNetworking = true` to the Debug
  configuration only (XcodeGen `configVariants` or an `Info.plist` per-config
  override; never in Release).
- This path must be compiled out of Release builds (`#if DEBUG`), not just hidden.

---

## 9. iOS test plan for auth (cross-ref `06-testing-strategy.md`)

Swift Testing unit tests in `ios/Packages/OpenAgentsAuth/Tests/OpenAgentsAuthTests/`:

| Test file | Covers |
|---|---|
| `CallbackParsingTests.swift` | `parseOneTimeToken`: happy path, `error=access_denied` → `.userCancelled`, other `error=` codes, missing `ott`, wrong scheme/host |
| `KeychainTokenStoreTests.swift` | load/replace/clear round-trip; replace-over-existing; `kSecAttrAccessible` asserted on the stored item (run on simulator; Keychain works without a host app entitlement there) |
| `AuthMiddlewareTests.swift` | bearer header attached when token present; absent when not; `set-auth-token` triggers `replace`; 401 triggers `onUnauthorized` exactly once; `Origin: openagents://` added on `/api/auth/*` POSTs only (use a stubbed `next`) |
| `SessionUserInfoDecodingTests.swift` | decode fixtures: signed-in payload, `{"user":null}`-equivalent (`{}` with `user` absent), unknown extra keys tolerated |
| `AuthSessionStateTests.swift` | state transitions in §7, including the 401-then-probe guard in §8.7 |

XCUITest smoke (thin suite, `06-testing-strategy.md`): launch → signed-out screen
shows both sign-in buttons; DEBUG local-dev path signs in and reaches the sessions
list. The real OAuth dance is not UI-automated (external browser + IdP); it is
covered manually per release using the checklist in `08-ci-cd-release.md`.

---

## 10. Multi-account — explicitly out of scope v1

v1 holds exactly one identity: one Keychain item (`kSecAttrAccount = "session-token"`),
one GRDB database, one `AuthSession`. Switching accounts = sign out + sign in.

Design left open intentionally (do not build now): keying Keychain items by user id
(`kSecAttrAccount = "session-token.<userId>"`), per-user GRDB files, and an account
switcher. Nothing in this document blocks that later; the only invariant to preserve
is that `KeychainTokenStore` is the sole reader/writer of token material.

---

## 11. Security rules (binding for both workstreams)

1. **Never log token material.** No `print`, `os_log`, `Logger`, breadcrumb, crash
   key, or analytics property may interpolate: the bearer token, the
   `set-auth-token` header value, the `Authorization` header, the OTT, an Apple
   identity token, or the raw callback URL. The logging facade in
   `07-observability.md` exposes a `redactedForLogging` URL helper (strips query
   values, keeps names: `openagents://auth?ott=<redacted>`) — use it for any URL that
   could carry credentials. Server side: never log `Authorization` headers
   (existing `docs/process/observability-discipline.md` applies).
2. **No tokens in URLs after the callback.** The only credential-bearing URL in the
   whole system is `openagents://auth?ott=<token>`: single-use, 3-minute TTL, hashed
   at rest, and its target is the app scheme — it never reaches any server or server
   log. Session tokens never appear in any URL, ever. The expo plugin's
   cookie-in-query handoff is explicitly rejected for this reason.
3. **Keychain only.** Tokens never touch `UserDefaults`, files, iCloud KV store, the
   pasteboard, widgets/app-group containers, or watch connectivity.
4. **No cookie jar.** The API/SSE `URLSession`s use the ephemeral, cookie-disabled
   configuration in §8.2. The only cookies in the system live inside
   `ASWebAuthenticationSession`'s browser and die with the sheet.
5. **Scheme-hijack posture.** Any app can claim `openagents://`. Exposure is bounded
   to the OTT (single-use, 3 min, useless after verify). Universal-Link callbacks are
   a v2 hardening, not a v1 requirement.
6. **TLS only.** ATS default (no arbitrary-loads exception); the localhost exception
   is Debug-only (§8.10).
7. **Redaction expectations in review.** PRs touching auth must include a grep proof
   that no new logging statement references `authorization`, `set-auth-token`,
   `ott`, or `token` string interpolation in `ios/Packages/OpenAgentsAuth` and the
   touched server files.

---

## 12. Acceptance checklist (auth feature is "done" when)

- [ ] Server PR from §3 merged into `develop` with all §3.8 tests green and SSE bearer curl evidence
- [ ] `apps/web/openapi.json` includes `/api/auth/info`, `/api/native-auth/complete`, `/api/native-auth/sign-out`, `/api/native-auth/bridge` (contract workstream, `02-api-contract-and-networking.md`); `bun run --cwd apps/web openapi:generate` and `scripts/check-openapi.ts` green
- [ ] iOS: Vercel sign-in end to end on a physical device against a preview deployment (chain in §4 observed; token lands in Keychain; `/api/auth/info` returns the user)
- [ ] iOS: Sign in with Apple end to end (chain in §5), including a brand-new Apple ID with email relay
- [ ] iOS: kill app → relaunch → still signed in (Keychain + bootstrap path)
- [ ] iOS: revoke the session server-side (delete the `auth_sessions` row) → next request 401s → re-auth sheet appears → recovery works
- [ ] iOS: sign-out clears Keychain + GRDB and the Vercel token is revoked (verify `accounts` row token unusable)
- [ ] iOS: account deletion flow per §8.9 including the stale-session re-auth branch
- [ ] All §9 unit tests green in CI (`08-ci-cd-release.md` pipeline)
- [ ] Security grep from §11.7 attached to the iOS PR

---

## 13. Open risks and deferred decisions

| Risk | Posture |
|---|---|
| Bearer + `auth.api.getSession({ headers })` verified by reading 1.6.5 dist, not yet by runtime proof | §3.8 test 1 is the gate; nothing iOS-side starts until it is green |
| Vercel OAuth inside `ASWebAuthenticationSession` (IdP user-agent policies) | Server-terminated callback means Vercel never sees a custom scheme; if vercel.com blocks the embedded user agent (unlikely — ASWebAuthenticationSession presents Safari), fall back to `prefersEphemeralWebBrowserSession = true` testing, then escalate |
| App Store 4.8 exemption gamble ("client for a third-party service") | Not taken: SIWA ships in v1. Keep the exemption argument drafted in App Review notes as backup only |
| Apple client-secret JWT expiry (≤180 days) | Operational rotation task in `08-ci-cd-release.md`; failure mode is web-side Apple sign-in only once native uses idToken (idToken verification needs no client secret), but rotate anyway for the token-endpoint path |
| better-auth minor-version drift (`^1.6.5` range) | Behaviors used (bearer, OTT, delete-user, trustedOrigins env) are public documented APIs; §3.8 tests catch regressions on upgrade |
| `authProvider` hardcoded to `"vercel"` | Follow-up ticket; iOS never branches on it |
| `usage_events.source` enum only contains `"web"` | Out of auth scope; tracked in `02-api-contract-and-networking.md` contract workstream |
