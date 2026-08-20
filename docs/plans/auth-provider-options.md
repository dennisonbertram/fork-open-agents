# Authentication provider options

## The question

Today this product identifies users through one sign-in method — "Login with
Vercel", implemented with the **better-auth** library. We are considering
offering more sign-in methods, and "Clerk" was floated as a candidate. The
conversation had two embedded assumptions that turned out to be wrong, so it
is worth stating them plainly before anything else:

- **Neither this project nor its sibling uses Clerk today.** This repo uses
  better-auth (source of truth: `AGENTS.md:179`). The sibling repo `free-pi`
  signs in with a GitHub OAuth **device flow** driven from a CLI and hand-rolled
  `jose` JWTs — no Clerk reference anywhere in it. **This was verified by the human operator
  reading that repository directly and passing the result in — not by this
  sandbox, which cannot see it.** Treated here as reliable secondhand input,
  not first-hand evidence (see "Not verified" item 6). So "use Clerk" means introducing
  Clerk to both projects, not copying an existing setup.
- **Original intent, corrected:** the idea was that Clerk could sit *inside*
  better-auth as a provider so that "adding sign-in methods is simple." That
  reading is the one this document treats as primary, with the platform-swap
  reading covered as Option B.

The document's job: establish, with evidence, what each path actually costs,
what breaks, whether it is a good idea, and what a shared identity layer would
require for both projects.

Three evidential casts are kept separate throughout, per the working rules:
**[codebase]** = read directly in this repo; **[docs]** = read in official
documentation (better-auth.com / clerk.com, fetched for this task);
**[inferred]** = reasoned from the first two, not asserted as fact.

---

## What exists today

### Sign-in: Login with Vercel

The sign-in identity layer is better-auth, configured once in
`apps/web/lib/auth/config.ts`.

- The sole sign-in provider entry is `socialProviders.vercel`
  (`config.ts:104-112`): client id from
  `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, secret from
  `VERCEL_APP_CLIENT_SECRET` (`config.ts:106-107`), scopes
  `["openid", "email", "profile"]` (`config.ts:109`), and the Vercel profile
  mapped to a derived username (`config.ts:20-29`).
- The client-side trigger is `authClient.signIn.social({ provider: "vercel",
  callbackURL })` (`components/auth/sign-in-button.tsx:78-82`). The button's
  user-facing label is "Sign in with Vercel" (`sign-in-button.tsx:97`).
- The OAuth callback is `/api/auth/callback/vercel`, built from the auth base
  URL (`config.ts:44-46`); `AGENTS.md:292` confirms the local Vercel app must
  register that callback alongside the production URL.
- Which columns the provider populates: better-auth creates a row in `users`
  via the Drizzle adapter (`config.ts:55-66`), and one row in `accounts` keyed
  by `provider_id = "vercel"` holding the token/scope (`schema.ts:128-154`).
  A session row is written to `auth_sessions` (`schema.ts:157-172`).
- The app hard-codes the identity origin: the resolved session is labelled
  `authProvider: "vercel"` in `resolve-session.ts:48`.
- Sign-out actively revokes the Vercel OAuth token against Vercel's API
  (`lib/auth/actions.ts:35-59`).

Env vars that are **auth-related**, confirmed by grepping `process.env` usage
(not by reading `.env.example`, which was unreadable in this session):
`BETTER_AUTH_SECRET` (`config.ts:49`), `BETTER_AUTH_URL`,
`VERCEL_ENV`/`VERCEL_BRANCH_URL`/`VERCEL_URL`/`VERCEL_PROJECT_PRODUCTION_URL`
(`lib/auth/base-url.ts:31-66`), the two Vercel OAuth vars above, and the
GitHub vars below. Anything else that may sit in `.env.example` is unverified
and listed under "Not verified".

### Repo access: GitHub OAuth

GitHub is configured as a **second** better-auth social provider
(`socialProviders.github`, `config.ts:113-121`) — but it is **not** the
sign-in method. Its job is repo access. The two are deliberately distinguished:

- **Sign-in flow** (issues a session): Vercel, above.
- **Repo-access flow** (issues a repo token): GitHub. The OAuth-scope request
  is `["read:user", "user:email", "repo"]` (`config.ts:119`) — the `repo`
  scope is what lets the product act on repositories on the user's behalf, as
  the code comment at `config.ts:116-118` states.
- GitHub access is **linked to an already-signed-in user**, not used to create
  a session. The linking call is `authClient.linkSocial({ provider: "github" })`
  in `app/settings/accounts-section.tsx:126-127` and
  `app/get-started/get-started-flow.tsx:301-302`. Account linking is enabled
  with `vercel` and `github` trusted (`config.ts:97-101`).
- The stored GitHub token is retrieved with
  `auth.api.getAccessToken({ providerId: "github" })`
  (`lib/github/token.ts:8-14`), auto-refreshing via the stored refresh token.
- **There is a separate, independent GitHub mechanism**: the GitHub *App* path
  (`lib/github/app.ts`). That uses `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`
  (`app.ts:57-58`) to mint short-lived, per-repository *installation* tokens
  (`mintInstallationToken`, `app.ts:92-140`), distinct from the user OAuth
  token in `accounts`.

So the boundary is: **better-auth owns both** — Vercel for the session,
GitHub (same library, `linkSocial`) for a user-scoped repo token — and a
separate GitHub App (also not Clerk-related) handles installation-scoped repo
tokens. Nothing conflates "the thing that signs you in" with "the thing that
grants repo access" at the library level; they are three distinct OAuth grants
(`vercel`, `github` user token, GitHub App installation).

### Who consumes identity

Grep for `getServerSession` / `auth.api.getSession` across `apps/web` lists a
large surface. Every one of these reads the better-auth session to derive the
current `user.id`, so a change to how sessions are issued touches all of them:

- **Server-rendered pages**: `app/(mobile)/m/chat/[chatId]/page.tsx:73`,
  `app/(mobile)/m/layout.tsx:21`, `app/[username]/[repo]/page.tsx:55`.
- **Route handlers** (representative): `app/api/chat/route.ts:91`,
  `app/api/chat/_lib/chat-context.ts:76`,
  `app/api/sessions/route.ts:64,149`,
  `app/api/sessions/[sessionId]/route.ts:30,62,213`,
  `app/api/generate-pr/route.ts:24`, `app/api/sandbox/route.ts:228`,
  `app/api/transcribe/route.ts` (uses it too), plus the entire
  `app/api/github/*` family (`branches`, `create-repo`, `installations`,
  `repos`, `orgs`, `post-link`, `user`, `connection-status`, ...) and the whole
  `app/api/settings/*` family (`preferences`, `skills`, `model-variants`).
- Background-agents / workflows / runs are all **keyed by `user_id`** in the
  database (`schema.ts`) rather than reading a live session — e.g.
  `backgroundAgents.userId` (`schema.ts:1176`), `workflowRuns.userId`
  (`schema.ts:1909`), `sessions.userId` (`schema.ts:323`), and many more. For
  them the coupling is to the **user row id**, not to the session token, which
  matters for migration (below).
- The session resolution wrapper is `lib/session/get-server-session.ts`,
  whose shared implementation is `lib/session/resolve-session.ts:25-57`. This
  is the single chokepoint that turns a better-auth session into the app's
  `Session` shape (and stamps `authProvider: "vercel"`).

The **MCP server's** identity consumption is separate and heavier — see next
section.

### The MCP OIDC provider

This is the hard constraint, and it is bigger than it looks. The hosted MCP
server does not authenticate through a plain better-auth session; it exposes a
full OAuth 2.0 / OIDC **provider** built on better-auth's `mcp` plugin, so that
external MCP clients (e.g. the Open Agents cloud dispatch loop referenced by
`AGENTS.md:46-67`) can obtain scoped access tokens.

- The plugin is wired in `config.ts:153-187`: `mcp({ loginPage, oidcConfig })`
  with `requirePKCE: true`,
  `allowPlainCodeChallengeMethod: false`, its own MCP-specific scopes
  (`MCP_SCOPES` from `lib/mcp-server/context.ts:3-9`), and a hand-written
  `scopes_supported` metadata override (`config.ts:176-184`).
- The plugin owns three DB tables: `oauth_applications`,
  `oauth_access_tokens`, `oauth_consents` (`schema.ts:3332-3396`, referenced
  into the adapter at `config.ts:62-64`). Access tokens and consents hold
  `user_id` — they are identity-bound (`schema.ts:3364,3384`).
- The live HTTP surface sits on this plugin: the MCP tool handler uses
  better-auth's `withMcpAuth` (`app/api/mcp/[transport]/route.ts:89`), validates
  `accessTokenExpiresAt` itself (`route.ts:89-100`), and resolves the session to
  a `user.id` + scopes (`route.ts:111-114`).
- Two well-known discovery documents are hand-built around it: RFC 8414
  authorization-server metadata (`app/.well-known/oauth-authorization-server/route.ts`)
  and RFC 9728 protected-resource metadata
  (`app/.well-known/oauth-protected-resource/route.ts`).
- Substantial custom consent hardening lives in `lib/auth/mcp-consent-hook.ts`
  (three refusals F1–F3) and `lib/auth/mcp-consent-record.ts`, all of which
  reach directly into better-auth internals (`internalAdapter`,
  `getSessionFromCtx`).

**[inferred]** Removing better-auth removes this OAuth/OIDC provider entirely.
Clerk does not ship an equivalent that turns *your app* into an OAuth provider
for third-party MCP clients; Clerk is an *identity provider for your app*, not
an *AS you plug into your own MCP transport*. Rebuilding this would mean
implementing RFC 8414 / RFC 9728 / authorize / token / consent ourselves, plus
re-implementing the F1–F3 consent security work. This is the single most
expensive thing either option implicitly depends on, and it is **live** — it is
the same surface the automated build/dispatch loop in `AGENTS.md` uses.

---

## Option A — add sign-in methods inside better-auth

This is the cheap path and, given the corrected premise (Clerk *as a provider
inside* better-auth), it deserves to be assessed first.

**Does better-auth support what is wanted?** Yes, and it does not even require
Clerk. **[docs]** better-auth's "OAuth" concept page states it supports OAuth
2.0/OIDC out of the box, and explicitly: *"If your desired provider isn't
directly supported, you can use the Generic OAuth Plugin for custom
integrations."* The **Generic OAuth plugin** (`better-auth/plugins`) accepts
*any* OAuth 2.1 or OpenID Connect provider via `discoveryUrl` /
`.well-known/openid-configuration`, registers it as a first-class social
provider, works through the same `signIn.social` and `linkSocial` methods, and
does PKCE + issuer validation by default. It has a `mapProfileToUser` hook and
supports provider logout.

**[docs]** better-auth also ships a **Device Authorization** plugin (OAuth 2.0
Device Authorization Grant, RFC 8628), used alone for session tokens or
composed with the OAuth Provider plugin to issue OAuth access tokens to a CLI.
This is precisely the shape the sibling `free-pi` CLI device flow needs (see
"Unifying with the CLI device flow" below).

**[docs]** Better-auth's social provider list includes GitHub, Google,
Microsoft, Slack, and many more — but **not** Clerk. Registry-level fact: there
is a "Migrating from Clerk to Better Auth" guide, which treats better-auth as a
*replacement for* Clerk, not a consumer of it. So if the goal is specifically
"offer social sign-in beyond Vercel", the in-library move is: add a
`socialProviders` entry (Google, GitHub-as-sign-in, Microsoft, etc.) or a
`genericOAuth` entry (any OIDC provider) — each a config block, matching the
existing `vercel`/`github` entries at `config.ts:104-121`.

**Can Clerk itself be the provider inside better-auth?** **[docs]** Clerk can
act as an OIDC provider (it exposes an issuer, JWKS, and OIDC discovery, and
you can add it as a connection), so in principle `genericOAuth` could be pointed
at a Clerk OIDC endpoint. This is speculative enough that I could not fully
verify the exact Clerk discovery URL/client-credential shape from the pages I
fetched; it is flagged in "Not verified". But it is **not necessary** to reach
the actual goal (more sign-in methods) — adding Google/GitHub/Microsoft provider
blocks, or a `genericOAuth` block for any OIDC IdP, achieves it with zero
platform change and nothing new to buy.

**What stays intact under Option A:** the MCP OIDC provider, the third-party
token flows, `resolve-session.ts`, every consumer listed above, and the six
auth tables. Because we add provider entries to the *same* library, `user.id`
and the `accounts`/`auth_sessions` shape are unchanged, so nobody re-links,
re-authorizes, or loses a session.

**What Option A actually costs:** (1) a config block per provider and the
appropriate OAuth app registered with that provider — the same kind of work
already done for Vercel and GitHub; (2) if the provider should be a *sign-in*
option rather than only a linked account, a second sign-in button and teaching
the UI which providers are sign-in-capable; (3) `resolve-session.ts:48`'s
hard-coded `authProvider: "vercel"` likely needs to become data-driven once
more than one provider can sign a user in — currently a caller asking "how did
this user authenticate" always gets `"vercel"` regardless of the actual
provider. That single string is a small but real cleanup.

**Verdict on Option A:** this is the honest recommendation (expanded in
Cost/lock-in and Recommendation). The reason we might want "Clerk *as a
provider*" disappears the moment we recognise better-auth already accepts
arbitrary OIDC providers. Adding sign-in methods is a config task, not a
platform swap.

---

## Option B — replace better-auth with Clerk

Option B means making Clerk the identity source and removing better-auth. On
the corrected premise this is not the primary reading, but it is the reading
the original "replace Login with Vercel with Clerk" phrasing invites, so it is
addressed on its own terms.

### What Clerk offers, and what we would use

**[docs]** Clerk's marketing surface (clerk.com/pricing, clerk.com/docs) is:
fully-hosted auth + user management; **social providers** ("social connections",
Google/GitHub/Facebook, up to 3 on Hobby, unlimited on paid); **session
management** (session tokens are JWTs, `getToken()` for a Bearer token,
custom session duration, device tracking/revocation, simultaneous sessions);
**custom session tokens / JWT templates** (custom claims and templates for
external services); **organizations** (multi-tenancy, roles, invitations);
**user metadata**; **webhooks** (delivered via Svix, signed, with retry/replay);
**machine auth** (API keys, M2M tokens); **passkeys, MFA, SSO/SAML/OIDC**
connections; **email/SMS codes and links**; prebuilt **UI components**.

Item by item, what this product would plausibly use vs not:

| Clerk capability | Use here? | Rationale |
| --- | --- | --- |
| Social providers (sign-in) | Yes (intent) | The actual goal — more sign-in methods. |
| Session management (JWT session tokens) | Replaces current usage | Today sessions are better-auth `auth_sessions` rows (`schema.ts:157-172`). |
| Custom JWT / session tokens | No | We have no third-party JWT consumer today; the MCP provider issues its own OAuth tokens. |
| Organizations | No | This product has users, not org tenant hierarchies in its auth layer. |
| User metadata | No/partial | We store profiles in our own `users` table (`schema.ts:114-125`); no need to move them into Clerk's blob. |
| Webhooks | Possible (later) | Useful if we ever need Clerk→our-hosted event sync; not required for the core question. |
| Passkeys / MFA / SAML / SSO | Not now | No requirement stated; available later within Clerk if wanted. |
| Act as OIDC provider for a third party | Unverified / unlikely | See "Not verified". |
| Prebuilt UI components | No | We have our own sign-in UI; adopting Clerk's would restyle the product. |

### What breaks

Replacing better-auth with Clerk is not a drop-in. Items in
"[codebase]" are read here; the breakage framing is **[inferred]** where it
project.

1. **[inferred, hard]** The **MCP OIDC provider** is gone. Everything in
   "The MCP OIDC provider" above depends on better-auth's `mcp` plugin and the
   `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables
   (`schema.ts:3332-3396`). Clerk is the *identity provider*, not an AS you
   embed in your MCP transport. This OAuth surface is live and used by the
   automated dispatch loop (`AGENTS.md:46-67`). Rebuilding it against Clerk
   means implementing the OAuth provider protocol ourselves and re-doing the
   F1–F3 consent hardening (`mcp-consent-hook.ts`). This is a large, security-
   sensitive reimplementation, not a config change.
2. **[codebase→inferred]** Every consumer of identity breaks at the seam where
   it imports better-auth. `resolve-session.ts`, `lib/github/token.ts:12`,
   `lib/vercel/token.ts:32,63`, `lib/auth/actions.ts:56`, the MCP file above,
   and the dozens of `getServerSession` call sites — all would need new
   plumbing backed by Clerk's SDK instead of better-auth.
3. **[inferred]** The dedicated **Vercel OAuth sign-in path** is not
   automatically reproduced. Clerk signs users in through *Clerk's* connections;
   Vercel OAuth is a better-auth provider entry (`config.ts:104-112`). Whether
   Vercel is exposed as a sign-in connection (and with the same
   `openid/email/profile` scopes and callback contract) is a Clerk-side
   configuration that I could not verify from the fetched pages.
4. **[inferred]** The second/third OAuth grants — the GitHub **user** token
   (used for repo access, `config.ts:113-121` + `linkSocial`) and the GitHub
   App installation tokens (`lib/github/app.ts`, which does **not** depend on
   better-auth and **would survive unchanged**). The GitHub user token, by
   contrast, is stored in better-auth's `accounts` table and read through
   `auth.api.getAccessToken` (`lib/github/token.ts:12`); under Clerk you would
   re-host that token storage and its auto-refresh yourself.
5. Lock-in is real: user identity, session state, and token storage move from
   "a table in our Postgres + an open-source library" to "a vendor's hosted
   service," with our own DB no longer the source of truth for sessions.

### Migration for existing users

**[inferred — no live migration exists to inspect, so this is roadmapped, not
a claim of a working procedure]** There are production `users` rows, `accounts`
rows (Vercel + linked GitHub tokens), `auth_sessions` rows, and MCP `oauth_*`
rows (schema.ts). Honest assessment:

- **User rows can be copied.** `users` (`schema.ts:114-125`) is plain data
  (id, username, email, avatar, admin flag, timestamps); `username` and
  `isAdmin` are app-level and would need to be placed either in Clerk user
  metadata or re-derived. Migration guides for Clerk pay-for-your-user-data
  exist **[docs]** but I did not verify their exact mechanism.
- **Sessions do not port.** `auth_sessions` are better-auth-issued tokens
  (`schema.ts:157-172`). Clerk issues its own session JWTs. Every active user
  session would need to **end and re-authenticate** — there is no way to
  transfer an existing better-auth session token into Clerk.
- **Linked OAuth providers ride on identity.** `accounts` rows (`schema.ts:128-154`)
  bind a provider (`vercel`, `github`) to a `user_id` and hold tokens scoped to
  a google/vendor app. Because account linking was `allowDifferentEmails: true`
  (`config.ts:100`) and GitHub is `linkSocial`-linked, porting "this user is
  also linked to GitHub account X" means either re-linking in Clerk or mapping
  external ids from the old `accounts` rows. If identity matching cannot be
  proven, users **re-link GitHub** — i.e. the repo-access grant is re-granted.
  This should be stated as a likely user-visible step, not a footnote:
  **existing users would realistically re-authenticate, and could need to
  re-grant GitHub repo access, after a swap.**
- **MCP consents/tokens** (`oauth_consents`, `oauth_access_tokens`,
  `oauth_applications`, schema.ts:3332-3396) are tied to `user_id` and would
  not survive a provider change; those are short-lived per-design, so the cost
  is re-authorization rather than migration.

### GitHub repo access

The **GitHub App installation** path (`lib/github/app.ts`) is independent of
better-auth and **survives an identity change untouched**. But the **GitHub
user OAuth token** that backs per-user repo access (`config.ts:113-121`,
`lib/github/token.ts`) lives in better-auth's `accounts` table; it is **coupled**
to the auth layer and would need re-homing. So the answer to "does GitHub
survive?" is: the App-based flow yes, the user-token flow no — it follows the
identity layer.

---

## Unifying with the CLI device flow

The sibling `free-pi` signs in from a CLI using GitHub OAuth **device code**
(`POST /auth/github/device`, `/auth/token`, `GET /me`) and verifies a hand-rolled
`jose` HS256 JWT. A shared identity layer would have to serve both a **browser
OAuth web app** (this repo) and a **device-code CLI flow** (that repo).

- **[docs]** better-auth's **Device Authorization** plugin implements RFC 8628
  — requesting a device/user code, a verification URI, polling until the user
  approves, and (composed with the OAuth Provider plugin) issuing OAuth access
  tokens to a public CLI client that cannot hold a client secret. This matches
  the `free-pi` shape directly: the flow is described in the docs as exactly
  the "command-line application" case. So a shared better-auth core **can**
  cover the device grant that `free-pi` currently hand-rolls with `jose`.
- The one browser-vs-CLI structural difference is real: remaining sessions are
  cookie-shaped in this repo and Bearer-token-shaped in the CLI. That is a
  consumption difference on top of the same underlying auth, not evidence that
  a single identity layer is impossible.
- On the **packaging thought** (offering this product under the `free-pi`
  umbrella): I can only state what shared identity would require — one
  authentication service both repos delegate to, one session/token model, and a
  device grant for CLI clients. Whether that packaging is desirable is a
  product/commercial decision that cannot be assessed honestly from the
  evidence available here, so I do not assess it.

---

## Two prerequisites Option A actually has

Raised in review and confirmed against the code. Option A remains the
recommendation, but "nothing breaks" was too strong: it is true for existing
users, and not automatically true for users who arrive through a new provider.

### 1. A new provider gives a user no Vercel or GitHub account row

`getUserVercelAuthInfo` calls
`auth.api.getAccessToken({ providerId: "vercel", userId })`
(`lib/vercel/token.ts:30-33`) and returns `null` when there is no token. The
GitHub user token is read the same way (`lib/github/token.ts:8-14`).

Both read the `accounts` table, which is populated per provider. A user who
signs in with Google therefore has **no `vercel` row and no `github` row**, so
every feature behind those tokens is unavailable to them until they link — and
the current UI treats Vercel as guaranteed, because until now it was.

So adding a sign-in provider is a config block **plus** a linking story: which
grants a new-provider user must complete before the product works for them,
and what each dependent surface does in the meantime. That is design work, not
configuration, and it should be settled before the second provider ships.

### 2. GitHub-as-sign-in would collapse the repo-consent boundary

`socialProviders.github` requests `scope: ["read:user", "user:email", "repo"]`
(`config.ts:119`). Today that is fine, because GitHub is only reached through
`linkSocial` — a deliberate, later, optional step, after the user has decided
they want repo features.

Turn that same entry into a sign-in button and **every sign-in demands `repo`
up front**. A visitor who only wants to look around must grant write access to
their repositories to get through the door. That is a real regression in the
consent boundary, and the code comment at `config.ts:115-117` already notes
that changing scopes forces existing users to reconnect.

If GitHub becomes a sign-in method it needs a **separate provider entry with
minimal scopes** (`read:user`, `user:email`), keeping the broad-scope entry for
the explicit repo-access grant. Google or another OIDC provider avoids the
question entirely, which is a point in its favour as the first addition.

---

## Cost and lock-in

**[docs: pricing read from clerk.com/pricing]** Clerk pricing (as published):

- **Hobby**: $0, up to 50,000 monthly retained users (MRU) per app, up to 3
  social connections, no MFA, fixed 7-day sessions, Clerk branding.
- **Pro**: $20/mo billed annually ($25 monthly), 50,000 MRU included, then
  pay-per-MRU: `$0.02`/MRU for 50,001–100,000, `$0.018` for 100,001–1,000,000,
  `$0.015` for 1,000,001–10,000,000, `$0.012` above. A user is "retained" only
  when they return 24h+ after signing up ("First Day Free").
- **Business**: $250/mo billed annually. **Enterprise**: custom (annual).
- Organizations/B2B add-on and Administration add-on: $100/mo each
  ($85 annual); billing add-on 0.7% of volume.
- Machine auth / M2M tokens are metered (e.g. M2M 2,500 creations +
  100,000 verifications/month).

The number that would settle our bill is the **monthly retained user (MRU)
count**, which is **unknown here** — there is no such metric in this repo and we
were told not to estimate it. The figure that settles it is: *how many users
return after their first day in a given month.* Below 50,000 MRU the
platform-vendor cost is $0 on Hobby; the moment it crosses 50,000, Pro starts
at $240/yr plus per-MRU overage. Naming the MRU is what would turn "free" into
an actual number.

**Today's identity layer has no per-user fee.** better-auth is an open-source
library ([codebase] imported at `config.ts:1`, `AGENTS.md:179`); the only costs
are the OAuth app credentials we already hold and the Postgres they are stored
in. Clerk adds a vendor relationship, per-seat/overage pricing, and moves
session/identity/token state to their hosted service.

**[inferred] Lock-in assessment:** the "audit trail" is that identity, session
state, and linked-provider tokens would no longer live in our own database but
in a third party's, which is the definition of increased switching cost — the 
subject of the next heading.

---

## Not verified

Genuinely open items, with what would settle each:

1. **Clerk's exact OIDC-provider surface for consumption by a third-party
   OAuth client.** I confirmed (a) Clerk can be added as an OIDC/SSO connection
   and (b) Clerk session tokens are JWTs with JWKS. I did **not** confirm the
   concrete `/.well-known/openid-configuration` URL, authorize/token endpoints,
   and client-credential shape needed to point better-auth's `genericOAuth` at
   Clerk. Would be settled by fetching a live Clerk app's OIDC discovery
   document, or Clerk's primary OIDC documentation.
2. **Whether Vercel can be exposed as a Clerk sign-in "connection" preserving
   the current scopes and callback.** Clerk social connections are
   Google/GitHub/Facebook by default; Vercel-as-a-Clerk-connection is not
   something I saw confirmed. Settled by the Clerk dashboard's connection list.
3. **Clerk's data-import mechanism** for an existing user dump (schema/columns,
   password-less OAuth-account mapping, HTTP vs manual). The docs mention
   migration/export assistance but not an exact procedure I could verify.
4. **The full contents of `apps/web/.env.example`.** This file could not be
   read in this session (the read would not be approved and we are headless).
   I confirmed auth env vars by grepping `process.env` usage in
   `apps/web/lib` (list in "Sign-in"). Any additional documented-but-unused
   auth vars there are unverified. Settled by reading the file.
5. **MRU / active-user count** for this product — the single number that
   determines Clerk's real cost. Unknown here and out of scope to invent.
6. **`free-pi` details beyond what was shared.** I could not read that repo
   from this sandbox; the device-flow/JWT description is secondhand (provided
   as corrected input), consistent with **[docs]** better-auth Device
   Authorization capabilities but not verified against the repo itself.
7. **better-auth version + exact loaded plugin behavior** (e.g. that the MCP /
   OAuth provider / generic-oauth features described are in the installed
   version). The docs describe them; the installed version was not
   diffed against them.

---

## Recommendation

> Tracked by issue #794. That issue carries the `authProvider` prerequisite
> described below and is the durable record for this decision.

**Do not replace better-auth with Clerk. Add sign-in methods inside
better-auth instead.**

The reasoning, weighed honestly:

- The stated goal — "more ways to sign in" — is met by the cheap path.
  **[docs]** better-auth already accepts arbitrary OIDC providers via its
  Generic OAuth plugin, and many social providers natively. Adding a provider
  is a config block beside `config.ts:104-121`, plus an OAuth app registered at
  the provider. If the specific desire is Clerk's look-and-feel or hosted
  dashboard rather than more methods, that is a different goal and would need a
  separate decision.
- Replacing better-auth **breaks the live MCP OIDC provider**, which is not a
  footnote. It is a working OAuth/OIDC AS embedded in our app and used by the
  automated dispatch loop. Rebuilding it against any vendor without an in-app
  AS product means implementing RFC 8414/9728 + consent + the F1–F3 hardening
  ourselves. That alone is more than the entire Option A work.
- Migration is not free: sessions don't transfer, linked GitHub/OAuth grants
  likely re-link, and identity joins a paid vendor with unknown cost until MRU
  is known. Today's layer is a library in our own Postgres at no per-user fee.
- The sibling CLI device flow already has a native better-auth primitive:
  the **Device Authorization** plugin (RFC 8628). A shared better-auth core
  can serve both the browser app here and the `free-pi` device-code CLI,
  without introducing a vendor.

**Concrete next steps if pursued:** (1) pick the first additional sign-in
method (Google and GitHub-as-sign-in are the two obvious candidates given the
existing GitHub config), (2) add it as a `socialProviders` entry
(`config.ts:104-121`) or a `genericOAuth` entry, (3) make
`resolve-session.ts:48`'s `authProvider: "vercel"` data-driven so the session
reflects the real provider, (4) only revisit Clerk if a hosted dashboard / the
specific Clerk feature set becomes a requirement — and then price it against a
known MRU, which does not exist yet.
