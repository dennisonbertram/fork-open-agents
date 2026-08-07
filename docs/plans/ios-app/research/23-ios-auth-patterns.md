# Research Brief 23: Native iOS Authentication Against the Better Auth Backend

Topic: how a native Swift/SwiftUI iOS app authenticates against the open-agents Better Auth backend — bearer tokens, the native OAuth dance, token storage, trustedOrigins, and the Sign in with Apple / App Store guideline 4.8 question.

Date: 2026-06-09. Sources: better-auth official docs + plugin source (better-auth `^1.6.5` is what the repo pins — `apps/web/package.json:56`), Apple developer docs, App Store Review Guidelines.

---

## 0. Ground truth: what the server does today (actual code)

- **Auth config** lives at `apps/web/lib/auth/config.ts`. It registers **no plugins at all** (no `plugins:` key, lines 44–118) — no bearer plugin, no expo plugin — and **no `trustedOrigins`**. It uses the object-form `baseURL: { allowedHosts, fallback }` (config.ts:46–49) where `allowedHosts` comes from `getAllowedAuthHosts()` in `apps/web/lib/auth/base-url.ts` (localhost variants + Vercel deployment hosts + `*.host` wildcards). **`allowedHosts` is a host allowlist for baseURL resolution, not `trustedOrigins`** — a custom iOS scheme cannot be expressed there; `trustedOrigins` would be a new config key.
- **Sign-in is Vercel OAuth only.** `socialProviders.vercel` (config.ts:98–105, scopes `openid email profile`, explicit `redirectURI` to `/api/auth/callback/vercel`) and `socialProviders.github` (config.ts:106–110, used for repo access/account linking, not primary sign-in). The web sign-in button calls `authClient.signIn.social({ provider: "vercel", callbackURL })` (`apps/web/components/auth/sign-in-button.tsx:58–61`).
- **Every authenticated server path funnels through `auth.api.getSession({ headers })`** in exactly two helpers:
  - `apps/web/lib/session/get-server-session.ts:27–29` (React Server Components, cached)
  - `apps/web/lib/session/server.ts:26–28` (`getSessionFromReq` for API routes)
  Both also honor a test-auth cookie short-circuit (`getTestAuthSessionFromCookieHeader`, gated by `OPEN_AGENTS_ENABLE_TEST_AUTH`, `apps/web/lib/session/test-auth.ts`). **Consequence: adding the `bearer()` plugin server-side makes the entire existing API surface accept `Authorization: Bearer` with zero per-route changes**, because the bearer plugin converts the header into the session cookie before `getSession` runs (see §1).
- Session mapping hardcodes `authProvider: "vercel"` (`get-server-session.ts:37`, `server.ts:36`) — cosmetic today, but worth knowing if Apple sign-in is added.
- Account linking: `trustedProviders: ["vercel", "github"]`, `allowDifferentEmails: true`, `encryptOAuthTokens: true` (config.ts:88–95).
- Sign-out also revokes the stored Vercel OAuth token via `https://api.vercel.com/login/oauth/token/revoke` (`apps/web/lib/auth/actions.ts:9, 34–57`) — an iOS sign-out should hit the same server-side path (better-auth `/sign-out` endpoint alone does *not* revoke the Vercel token; the revocation lives in a Next.js server action, so the iOS app either needs a dedicated API route or accepts non-revocation. Flagged in open questions).

---

## 1. Better Auth bearer plugin (the token API for native clients)

Docs: https://www.better-auth.com/docs/plugins/bearer
Source verified: `packages/better-auth/src/plugins/bearer/index.ts` (better-auth GitHub, main branch).

### Server config required

```ts
import { bearer } from "better-auth/plugins";
export const auth = betterAuth({
  plugins: [bearer()],   // option: bearer({ requireSignature: true })
});
```

### How the client obtains the token

- The plugin registers an **after hook that matches every response**. Whenever a response sets the session cookie (sign-in, session refresh/rotation), it mirrors the cookie value into a **`set-auth-token` response header**. It skips when the cookie is empty or being cleared (`max-age === 0`).
- The token value is the **signed session-cookie value** in `"<token>.<HMAC-SHA256-signature>"` format (signed with `BETTER_AUTH_SECRET`), copied verbatim from the `Set-Cookie` value.
- The plugin also appends `set-auth-token` to `Access-Control-Expose-Headers` (relevant for web cross-origin clients; irrelevant for URLSession, which can read any response header).

### How the client sends it

- `Authorization: Bearer <signed-token>` on any request to the backend. Scheme match is case-insensitive (RFC 7235).
- A **before hook** matches any request with an `authorization` header, verifies the HMAC signature against the auth secret, and **injects the session cookie into a cloned header set** — downstream code (i.e., `auth.api.getSession({ headers })`) sees a normal cookie session. This is why no route changes are needed in apps/web.
- `requireSignature: false` (default) also accepts a **raw unsigned session token** (no `.` in it) and signs it server-side. Recommend running with `requireSignature: true` and always storing/sending the full signed value from `set-auth-token` — strictly stronger, and the docs' own caveat is that sloppy bearer use "could easily lead to security vulnerabilities."
- Server-side check stays exactly what the codebase already does: `auth.api.getSession({ headers: req.headers })` → `401` when null.

### Important subtlety for iOS

`set-auth-token` is emitted on **any** session-cookie-setting response — including the sliding-window session refresh (§3). The iOS HTTP layer should watch *every* API response for a `set-auth-token` header and rotate the stored Keychain token when present, not only at sign-in. (When the session is merely read without refresh, no header is emitted; the stored token stays valid.)

---

## 2. The native OAuth dance (the hard part)

### 2.1 The core problem

`signIn.social({ provider: "vercel" })` is a redirect flow: the backend's `POST /api/auth/sign-in/social` returns a provider authorization `url`; the user authenticates at Vercel; Vercel redirects to `https://<app>/api/auth/callback/vercel`; **the server sets the session cookie on its own domain and 302-redirects to `callbackURL`**. In a native app the whole dance happens inside `ASWebAuthenticationSession`'s ephemeral browser — **the session cookie lands in that browser's jar, which the app cannot read, and which is destroyed when the sheet closes**. The token must be explicitly handed across the browser→app boundary.

### 2.2 The canonical better-auth answer: the Expo plugin's deep-link handoff

Docs: https://www.better-auth.com/docs/integrations/expo
Source verified: `packages/expo/src/index.ts` (better-auth GitHub).

The `@better-auth/expo` **server** plugin is better-auth's only first-party native-client story, and its mechanism is provider-agnostic and not Expo-specific:

1. **Origin shim** (`onRequest` hook): native HTTP stacks don't send an `Origin` header; the Expo *client* sends a custom **`expo-origin`** header and the server plugin copies it into `origin` so better-auth's CSRF/origin checks pass. (A Swift client replicating this flow must account for the same checks — see open questions on whether a missing `Origin` is rejected.)
2. **Callback rewrite** (`after` hook matching `/callback*`, `/oauth2/callback`, `/magic-link/verify`, `/verify-email`): when the response's `Location` header is a **non-`http(s)` deep link** (e.g. `openagents://auth-callback`) **and** `ctx.context.isTrustedOrigin(location)` passes **and** a session cookie was just set, the plugin **appends the raw `Set-Cookie` value as a query parameter**:
   ```ts
   redirectURL.searchParams.set("cookie", cookie);
   ctx.setHeader("location", redirectURL.toString());
   ```
   So the ephemeral browser is redirected to `openagents://auth-callback?cookie=<url-encoded Set-Cookie>`, ASWebAuthenticationSession intercepts that scheme, and the app parses the signed session token out of the `cookie` query parameter.
3. The Expo client stores the cookie in SecureStore and replays it on later requests (`Cookie:` header with `credentials: "omit"`). **A Swift client can instead take the signed token value from that cookie string and use it as the Bearer token** (it is the same signed value the bearer plugin emits in `set-auth-token` — verified in both sources).

**Recommended server change for iOS:** either (a) install `@better-auth/expo` as-is (it works for any native client that sends `expo-origin` and a custom-scheme `callbackURL`; despite the name there is no Expo runtime coupling server-side), or (b) write a ~40-line custom better-auth plugin that does the same callback rewrite but hands off a token more conservatively (e.g. set `?token=<signed-token>` instead of the whole `Set-Cookie` string, or mint a one-time short-TTL code exchanged for the session token via `POST` — avoids long-lived credentials appearing in URL/query logs). Option (b) is cleaner; option (a) is battle-tested. Either way `trustedOrigins: ["openagents://"]` is mandatory (§4).

### 2.3 The iOS-side flow with ASWebAuthenticationSession

Docs: https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession

1. `POST {base}/api/auth/sign-in/social` with JSON `{ "provider": "vercel", "callbackURL": "openagents://auth-callback", "disableRedirect": true }` (plus the `expo-origin: openagents://` header if using the expo server plugin). Response contains the provider authorization `url`.
2. Open it:
   ```swift
   let session = ASWebAuthenticationSession(
     url: authURL,
     callback: .customScheme("openagents")   // iOS 17.4+ API; pre-17.4: init(url:callbackURLScheme:completionHandler:)
   ) { callbackURL, error in /* parse ?cookie= or ?token= */ }
   session.presentationContextProvider = self   // required since iOS 13
   session.prefersEphemeralWebBrowserSession = true/false  // see trade-off below
   session.start()
   ```
   - The completion handler receives the full deep-link URL; extract the token via `URLComponents`.
   - iOS 17.4+ also offers `.https(host:path:)` callbacks (universal-link style, requires an associated domain). More phishing-resistant than custom schemes (any app can claim a scheme), but requires `apple-app-site-association` hosting on the web app's domain and the server redirecting to an `https://` URL — which the expo plugin's rewrite explicitly *skips* (it only rewrites non-http(s) Locations), so the https-callback variant needs the custom plugin from §2.2(b). Custom scheme is the pragmatic v1; the one-time-code exchange mitigates scheme-hijacking risk.
   - `prefersEphemeralWebBrowserSession = false` (default) shares Safari cookies — a user already signed into vercel.com in Safari gets near-instant SSO, but iOS shows a consent alert ("…wants to use vercel.com to sign in"). `true` skips data sharing (and may skip the alert) but forces full Vercel credentials every time. Recommend default (`false`) for sign-in convenience.
   - Error case: `ASWebAuthenticationSessionError.canceledLogin` when the user dismisses the sheet — treat as silent cancel.
3. Parse the token, store in Keychain (§3), use as Bearer everywhere.

### 2.4 Rejected alternative: WKWebView login + cookie extraction

Loading the sign-in page in a `WKWebView` and harvesting the session cookie from `WKWebsiteDataStore.httpCookieStore` technically works but is **not recommended**: (a) Google and some IdPs block OAuth inside embedded webviews (`disallowed_useragent`) — Vercel's OAuth currently tolerates it, but that is fragile; (b) App Store reviewers and Apple's own guidance (ASWebAuthenticationSession exists precisely for this) treat embedded-webview credential capture as a dark pattern; guideline 5.1.1 privacy expectations and the SSO ecosystem have standardized on `ASWebAuthenticationSession`; (c) no Safari SSO sharing; (d) cookie timing is racy (must poll the cookie store after navigation). Use it only as a last-resort fallback. **ASWebAuthenticationSession + explicit token handoff is both the reliable and the App-Store-safe pattern.**

---

## 3. Token storage, expiry, refresh, 401 handling

Docs: https://www.better-auth.com/docs/concepts/session-management

- **Session model:** the bearer token *is* the session token (row in `auth_sessions`; the repo renames better-auth's session table via `session.modelName: "auth_sessions"`, config.ts:84–86, schema in `apps/web/lib/db/schema.ts`). There is **no separate refresh token** — better-auth uses a single sliding-window session.
- **Defaults (repo does not override them):** `expiresIn = 60*60*24*7` (7 days), `updateAge = 60*60*24` (1 day). When a session is used more than `updateAge` after its last update, expiry is pushed out to now + 7 days, and a fresh `Set-Cookie` (hence fresh `set-auth-token` header) is emitted. **An iOS app used at least weekly never re-authenticates; >7 days idle → session dead → full re-auth.**
- **Keychain:** store the signed token as `kSecClassGenericPassword` with **`kSecAttrAccessibleAfterFirstUnlock`** (the standard choice for tokens needed by background networking after reboot; `...ThisDeviceOnly` variant if iCloud Keychain sync of the session is undesirable — recommend `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` since the session is device-bound state, and better-auth records `userAgent`/`ipAddress` per session row, making per-device sessions the natural model). Never UserDefaults; never files.
- **Rotation:** intercept every response in a URLSession layer; if `set-auth-token` present → atomically replace the Keychain item.
- **401 middleware:** on any 401 from the API: (1) do **not** blind-retry — the session token has no client-side refresh path; (2) clear the Keychain token, flip app state to signed-out, surface the sign-in sheet; (3) optionally first call `GET /api/auth/get-session` to distinguish "session expired" from a per-route authz failure. Note `getSession` returning `null` with 200 is the canonical "not signed in" signal for better-auth — many routes in this codebase return their own 401s (`getSessionFromReq` → undefined → route-level 401).
- **Server-side revocation** (`authClient.revokeSession(s)`, password change, user-initiated "sign out everywhere") invalidates the token immediately — the 401 path above covers it.
- **Cookie cache caveat:** the repo does not enable `session.cookieCache`; if it ever does, revoked bearer sessions can stay valid until cache expiry (docs note this explicitly). Not a current concern.

---

## 4. trustedOrigins for custom schemes

Docs: https://www.better-auth.com/docs/reference/security

- `trustedOrigins` guards two things: (1) CSRF — requests whose `Origin` header is not trusted are rejected; (2) **open-redirect validation of `callbackURL` / `redirectTo` / `errorCallbackURL` / `newUserCallbackURL`** — a `callbackURL` of `openagents://auth-callback` will be **rejected at the `/sign-in/social` call** unless the scheme is trusted.
- Custom schemes are first-class: `trustedOrigins: ["openagents://"]` (wildcards supported, e.g. `"myapp://*"`; the docs show `"exp://**"` dev patterns and warn to keep dev wildcards out of production).
- **Repo today: no `trustedOrigins` key at all** (config.ts) — by default only the resolved baseURL is trusted. **Required server change:** add `trustedOrigins: ["openagents://"]` (exact scheme TBD) alongside the bearer + native-callback plugins. If Sign in with Apple is added, also `"https://appleid.apple.com"` (Apple docs requirement, §5.2).
- Function form `trustedOrigins: async (request) => [...]` exists but is per-request — static array suffices here.

---

## 5. Sign in with Apple and App Store guideline 4.8 (this WILL force a server addition)

### 5.1 The guideline, precisely (current text, fetched June 2026)

Source: https://developer.apple.com/app-store/review/guidelines/ (§4.8 "Login Services"); change history: https://developer.apple.com/news/?id=7j1f99yf (the 2023 revision that relaxed "must offer Sign in with Apple" to "must offer an equivalent privacy-preserving login service").

Current 4.8 text (verbatim):

> Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service with the following features:
> - the login service limits data collection to the user's name and email address;
> - the login service allows users to keep their email address private as part of setting up their account; and
> - the login service does not collect interactions with your app for advertising purposes without consent.

Exemptions (verbatim list): exclusively your company's own account system; alternative app marketplace logins; education/enterprise/business apps using existing education or enterprise accounts; government/industry-backed citizen ID; **"Your app is a client for a specific third-party service and users are required to sign in to their mail, social media, or other third-party account directly to access their content."**

### 5.2 Applied to open-agents

- "Sign in with Vercel" is unambiguously a **third-party login service used to set up the user's primary account** → 4.8 applies on its face.
- **Exemption analysis:**
  - *Own account system*: does not apply — the account is bootstrapped via Vercel OAuth, not a first-party email/password/passkey system.
  - *Client for a specific third-party service*: the intended reading is apps like an IMAP client or the official Dropbox/X client, where the third-party account **is** the content being accessed. open-agents has its own account layer (users, sessions, preferences, background agents) on the developer's own backend; Vercel OAuth is just the identity bootstrap. Reviewer-facing analyses (e.g. WorkOS's 2025 guide, https://workos.com/blog/apple-app-store-authentication-sign-in-with-apple-2025) and the guideline's own examples do **not** extend the exemption to "my own SaaS that happens to authenticate via someone else's OAuth." There is a *colorable* argument (the app's core function is operating on the user's Vercel sandboxes and GitHub repos — users arguably "sign in to their third-party account directly to access their content"), but it is a gamble a release plan should not depend on. **Plan assumption: 4.8 applies; ship Sign in with Apple (or an equivalent) in v1.**
  - Marketplace/education/government: N/A.
- **What "equivalent" means:** Sign in with Apple always qualifies. A first-party email+passkey login with private-email support could also qualify, but Sign in with Apple is the only zero-ambiguity option and is the cheapest to defend in review.

### 5.3 Server-side work this forces (better-auth Apple provider)

Docs: https://www.better-auth.com/docs/authentication/apple

- Add `socialProviders.apple` to `apps/web/lib/auth/config.ts` with: `clientId` (the **Services ID** for web, but see bundle-ID note), `clientSecret` = an **ES256 JWT** generated from Apple Team ID + Key ID + `.p8` private key (max 180-day expiry — **operational task: rotate before ~6 months**; the docs ship a `jose`-based generator), and **`appBundleIdentifier`** = the iOS app's bundle ID.
- `appBundleIdentifier` is critical for native: an ID token obtained on-device via `ASAuthorizationAppleIDProvider` has `aud = <bundle ID>` (not the Services ID); without this option better-auth fails with `JWTClaimValidationFailed: unexpected "aud" claim value`.
- Add `"https://appleid.apple.com"` to `trustedOrigins` (Apple docs requirement).
- **Native flow is the easy one:** use the system `SignInWithAppleButton` / `ASAuthorizationAppleIDProvider` (no browser at all), then `POST /api/auth/sign-in/social` with `{ "provider": "apple", "idToken": { "token": <identityToken>, "nonce": <nonce> } }`. Better-auth verifies the token and creates the session directly — the response sets the session cookie, so with the bearer plugin installed the **`set-auth-token` header comes back on this same response**; no deep-link dance needed for Apple.
- Caveats from the docs: Apple sends `email` **only on first authorization** (persist it; `mapProfileToUser` fallback); Apple rejects `http://localhost` return URLs (dev needs a TLS domain — only affects the *web* Apple flow, not the native idToken flow).
- Product consequence to plan for: a Apple-only user has **no Vercel token and no GitHub installation**, and parts of the product (sandbox creation runs on the user's Vercel account; repos need GitHub) assume those. The app needs a post-Apple-sign-in "connect Vercel / connect GitHub" linking flow (better-auth account linking already has `trustedProviders: ["vercel","github"]`, config.ts:92 — Apple would need adding) or must gate features. Also `authProvider: "vercel"` is hardcoded in the session mapping (§0).
- Apple also requires apps offering account creation to offer **in-app account deletion** (guideline 5.1.1(v)) — adjacent requirement the iOS plan must carry; the web app has no user-facing delete-account endpoint today (not found in `app/api/*`; verify).

---

## 6. Recommended end-to-end architecture (summary for the plan author)

**Server (one PR in apps/web):**
1. `plugins: [bearer({ requireSignature: true }), <native-callback plugin>]` in `apps/web/lib/auth/config.ts` — native-callback plugin = `@better-auth/expo` or a small custom plugin that, on `/callback/*` responses redirecting to a trusted custom scheme, attaches a one-time code or the signed token.
2. `trustedOrigins: ["openagents://", "https://appleid.apple.com"]`.
3. `socialProviders.apple` with generated client-secret JWT + `appBundleIdentifier`; add `"apple"` to `accountLinking.trustedProviders`.
4. (Optional hardening) one-time-code exchange endpoint instead of token-in-URL.

**iOS:**
1. Vercel sign-in: `POST /api/auth/sign-in/social` → `ASWebAuthenticationSession` (custom scheme `openagents`, context provider, handle cancel) → parse token from deep-link query → Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
2. Apple sign-in: native `ASAuthorizationAppleIDProvider` → idToken POST → token from `set-auth-token` response header.
3. URLSession middleware: attach `Authorization: Bearer`, rotate token on any `set-auth-token` response header, on 401 clear Keychain + present sign-in.
4. Sign-out: call the server sign-out (and a route that revokes the Vercel token, see open question) then wipe Keychain.

---

## 7. Uncertainties / verification needed before implementation

- **Missing-`Origin` behavior:** whether better-auth 1.6.x rejects POSTs that carry *no* `Origin` header (URLSession default) or only rejects *mismatched* origins. The expo plugin's `expo-origin` shim suggests the `callbackURL` trust check is the real gate, but this must be smoke-tested; if bare POSTs fail, the iOS client sends `expo-origin: openagents://` (or the custom plugin accepts an equivalent header).
- **Exact `set-auth-token` semantics in 1.6.5 vs main:** source was read from `main`; verify against the pinned `1.6.5` (`bun pm ls`) before relying on rotation-on-every-refresh behavior.
- **Token-in-URL exposure:** the expo plugin puts the full signed session token in a query param of the deep link; assess log-leak surface (Vercel edge logs won't see it — the redirect target is the app scheme, not the server — but the ephemeral browser process briefly holds it). One-time code exchange removes the concern.
- **Vercel-token revocation on sign-out from iOS:** revocation lives in a Next.js server action (`lib/auth/actions.ts`), not an API route; decide whether to expose an API route or accept that iOS sign-out only kills the better-auth session.
- **4.8 final call:** plan assumes Sign in with Apple is required. If the team wants to attempt the "client for a specific third-party service" exemption (app as a client for the user's Vercel/GitHub content), prepare App Review notes, but have the SIWA implementation ready as the fallback — review outcomes here are reviewer-dependent.
- **Account-deletion requirement (5.1.1(v))** once Apple sign-in (or any account creation) ships in-app: confirm whether a delete-account path exists server-side; none was found in this research pass.
