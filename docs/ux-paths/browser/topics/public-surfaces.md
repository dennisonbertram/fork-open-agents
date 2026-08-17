# Topic: Public & Alternate Surfaces

Shared Chats, Public Profiles, MCP Client Authorization, Mobile & Deploy-Your-Own —
everything reachable that is NOT the main signed-in desktop workspace.

Source read: `docs/ux-paths/browser/discovery.md`, plus the real route/component
code under `app/page.tsx`, `app/home-page.tsx`,
`components/auth/signed-out-hero.tsx`, `app/deploy-your-own/page.tsx`,
`app/[username]/page.tsx`, `app/u/[username]/page.tsx`,
`lib/db/public-usage-profile.ts`, `app/shared/[shareId]/*`,
`app/api/shared/[shareId]/*`, `app/mcp/login/page.tsx`,
`app/mcp/consent/page.tsx` + `mcp-consent-panel.tsx`,
`lib/auth/mcp-consent-hook.ts`, `lib/auth/config.ts`, and
`app/(mobile)/m/**` + `components/mobile/**`.

---

## STORY-1101: A cold visitor explores the marketing homepage before signing in

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: Priya, a developer evaluating agent-coding tools, has never used Open Agents and is not signed in.
**Goal**: Understand what the product does and decide whether to sign in.
**Preconditions**: No session cookie; visiting `https://open-agents.dev/` for the first time.
**Ideal path**: 4 steps — the page is a single scroll with one real CTA (Sign in with Vercel), so reading it top to bottom and clicking that button is both the fastest and the only intended path.

### Steps
1. Priya navigates to `/` → `app/page.tsx` calls `getServerSession()`; no session, so it renders `<HomePage hasSessionCookie={false} lastRepo={null} />`, whose unauthenticated branch renders `SignedOutHero`.
2. She reads the hero (`components/auth/signed-out-hero.tsx`): "Open Agents." headline, the one-line product description, and `ProductJourney` (from `lib/product-journey.ts`).
3. She scrolls past `AppMockup` (terminal/app mockup inside `Stage`), then `LandingFeatures` and `LandingBento` (the bento feature grid) → each section is presentational, no data fetching.
4. She reaches `LandingFooter`, clicks the moon/sun icon (`ThemeToggle`) to preview dark mode, then clicks "Sign in with Vercel" (`SignInButton`, `callbackUrl={PRODUCT_JOURNEY[0].href}`) → redirected into the Vercel OAuth flow.

### Variations
- She scrolls past the hero buttons first: `LandingNav`'s sign-in cluster is `invisible`/`aria-hidden` until an `IntersectionObserver` reports the hero buttons have scrolled out of view, at which point `showSignIn` flips true and the nav's own "Sign in with Vercel" + GitHub link fade in — a second, always-reachable entry point deeper in the page.
- She clicks "Open Source" (`GitHubLink`) instead, opening `https://github.com/dennisonbertram/fork-open-agents` in a new tab — she never signs in this visit.

### Edge Cases
- Vercel OAuth fails or is cancelled: better-auth redirects back to `/` with `?error=<code>`; `SignedOutHero` reads `useSearchParams().get("error")` and renders the `SignInDidNotCompleteBanner` ("Sign-in didn't complete. Try again below.") — the raw better-auth error code (e.g. `state_mismatch`) is deliberately never shown to the user.
- The client-side `/api/auth/info` check itself fails (not an OAuth error, a network blip): `HomePage` shows `AuthCtaError` with "We couldn't verify your session." and a Retry button, not the signed-out hero — a transient check failure must never look like a sign-out.

---

## STORY-1102: A signed-in user's old bookmark to `/` bounces them straight to their sessions

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: Marcus, a returning Open Agents user with an active session cookie.
**Goal**: Get back into the app quickly, even from a stale bookmark to the marketing root.
**Preconditions**: Signed in (`session?.user` truthy).
**Ideal path**: 1 step — the redirect is server-side and immediate; there is nothing to click.

### Steps
1. Marcus opens `open-agents.dev/` from an old bookmark → `app/page.tsx`'s server component calls `getServerSession()`, finds a user, and calls `redirect("/sessions")` before any landing-page HTML is sent → he lands on `/sessions`, never seeing the marketing page.

### Variations
- none found — this is a single unconditional server redirect with no branch for signed-in users on `/`.

### Edge Cases
- If the redirect happens but `getServerSession()` itself is flaky, the user simply gets the signed-out landing page for one request (fails toward showing marketing copy, not toward leaking another user's session) — there is no partial/broken state.

---

## STORY-1103: A self-hoster finds `/deploy-your-own` by direct link and deploys their own copy

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: Sam, a developer who wants to run Open Agents under their own Vercel account and GitHub App, arrived via a shared link (not through in-app navigation).
**Goal**: Deploy a working copy of Open Agents to their own Vercel project.
**Preconditions**: Has a Vercel account; not signed into this Open Agents instance (irrelevant — the page has no auth check).
**Ideal path**: 2 steps — the page is a single centered card with exactly one button; there is nothing else to configure here, all real configuration happens on Vercel's own import screen.

### Steps
1. Sam opens `/deploy-your-own` directly → `app/deploy-your-own/page.tsx` renders a static centered card: "Deploy your own" heading, one paragraph, and a single CTA.
2. He clicks "Deploy your own version of this template now" → opens `https://vercel.com/new/clone?...` in a new tab, pre-filled via `DEPLOY_TEMPLATE_URL`: `repository-url=https://github.com/dennisonbertram/fork-open-agents`, `products=[neon, upstash-kv]` integrations, `skippable-integrations=1`, and an `env` list of 12 required vars (`POSTGRES_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `NEXT_PUBLIC_GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`) with an `envDescription` explaining Neon can supply `POSTGRES_URL` automatically but the rest (secrets, OAuth/App credentials) must be filled in by hand.

### Variations
- none found — one CTA, one destination URL.

### Edge Cases
- **The page is an orphan in this app's own UI.** Nothing in `LandingNav` or `LandingFooter` links to `/deploy-your-own` (confirmed by search — no in-app `<Link href="/deploy-your-own">` anywhere), and the string does not appear in the repo's README either. The only ways in are a bookmark, a shared URL, or someone typing it directly.
- Sam skips one of the integration steps on Vercel's import screen (`skippable-integrations=1` permits this): his deploy succeeds but the app will be missing `POSTGRES_URL`/KV until he adds them manually — this page gives him no feedback either way since it never talks back to the deployed instance.

---

## STORY-1104: A colleague opens a shared chat link and reads through the run

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: Jordan, a teammate who does not use Open Agents, receives a `/shared/[shareId]` link in Slack from a colleague.
**Goal**: Understand what the agent did on this task without needing an account.
**Preconditions**: Has a valid, non-revoked `shareId`; not signed in (irrelevant — the page works either way).
**Ideal path**: 2 steps — it is a read-only page; opening the link and scrolling is the entire task.

### Steps
1. Jordan opens `open-agents.dev/shared/<shareId>` → `app/shared/[shareId]/page.tsx` resolves the share via `getShareByIdCached`, loads the chat, session, and the session owner's public identity (`username`/`name`/`avatarUrl` only — no email, no other PII), then renders `SharedChatContent`.
2. He reads the header — session title, `repoOwner/repoName` + branch (linked to GitHub), PR number/status badge (`open`/`merged`/`closed`) linked to the PR, model name/provider, and a "Shared by {name}" chip with avatar — then scrolls the message thread, which renders with the same `AssistantMessageGroups`/`ToolCall`/`ThinkingBlock` components as the authenticated chat view, just non-interactive (`isStreaming={false}` passed everywhere).

### Variations
- The share covers a chat with multiple sub-chats (`chats.length > 1`): each chat's messages are separated by a labeled divider showing `chat.title`.
- Jordan is himself signed into Open Agents under a different account: the page still renders identically; `ownerSessionHref` only appears for the actual owner (see STORY-1106).

### Edge Cases
- The chat has no repo (`session.repoOwner`/`repoName` null, a chat-only session): the repo/branch/PR row is omitted entirely; only the model chip shows.
- An assistant image attachment or `data-snippet` part renders using plain `<img>`/`SnippetChip` — same visual treatment as the authenticated view, no redaction (images and snippets are not env-file content, so `redactSharedEnvContent` does not touch them — see STORY-1105 for what it does touch).

---

## STORY-1105: SECURITY — a shared chat that touched a `.env` file does not leak its contents

**Type**: long
**Topic**: Public & Alternate Surfaces
**Persona**: Jordan, the same colleague from STORY-1104, specifically checking whether anything sensitive is exposed before forwarding the link further.
**Goal**: Confirm the shared chat is safe to circulate — no secrets visible to a reader without repo access.
**Preconditions**: The underlying session's agent read, wrote, or edited a file whose basename starts with `.env` (e.g. `.env`, `.env.local`) at some point in the chat, directly or inside a `task` subagent call.
**Ideal path**: 1 step to view, but the important work is inspecting every place secret-shaped content could have leaked — reasoning, not clicking, is the actual task here.

### Steps
1. Jordan opens the share link and scrolls to the tool call where the agent touched the env file. `redactSharedEnvContent` (`app/shared/[shareId]/redact-shared-env-content.ts`) has already rewritten the message server-side, before any HTML reaches his browser, so there is nothing to "leak and then hide" client-side.

### What Jordan CAN see
- That a `read`/`write`/`edit` tool call happened at all, its file path (e.g. `.env.local`), and its timing/duration.
- For a **read**: line-numbered placeholder text — each real line becomes `N: [redacted from shared page]`, preserving line count and the `N:` prefix format but not content.
- For a **write**: the tool call is visible but `content` is replaced line-for-line with `[content redacted from shared page]`.
- For an **edit**: both `oldString` and `newString` are replaced line-for-line with `[previous content redacted from shared page]` / `[updated content redacted from shared page]` respectively.
- The same redaction applies **inside a `task` (subagent) tool call's final output** — `sanitizeTaskOutput` walks the subagent's own message array and redacts any nested `read`/`write`/`edit` calls it made against an env-shaped path, including further-nested `task` calls (recursive).

### What Jordan CANNOT see (by design)
- The real content of any file whose basename starts with `.env` — the check is a basename match (`.env`, `.env.local`, `.env.production`, case-insensitive) via `redact-shared-env-content.ts`'s `isEnvFilePath`, tolerant of both `/` and `\` separators.

### Edge Cases (real gaps in this mechanism, not covered by redaction)
- **Bash tool output is not redacted.** `redactSharedEnvContent`'s `sanitizeMessagePart` only special-cases `tool-read`, `tool-write`, `tool-edit`, and `tool-task` part types. If the agent ran a shell command like `cat .env` or `echo $API_KEY` instead of using the `read` tool, that command's stdout renders unredacted in the shared view — this is a real gap in the mechanism, not something this page's UI hides another way.
- **Secrets pasted into assistant prose are not redacted.** If the assistant's own `text` part quotes a secret value (e.g. explaining "your key is `sk-...`"), that text renders as normal markdown — only the four sensitive tool-part types are sanitized, not free text.
- **Non-`.env`-named secret files are not redacted.** A file named `secrets.yaml`, `config/prod.json`, or `id_rsa` is not matched by `isEnvFilePath` and is shown in full if read/written/edited.
- **The markdown export (`GET /api/shared/[shareId]/markdown`, STORY-1109) reuses the identical `redactSharedEnvContent` function** on the same message data before building the document, so the redaction and its gaps are consistent across the HTML page and the markdown/plain-text export — nothing is redacted on one surface and exposed on the other.

---

## STORY-1106: The session owner opens their own shared link and jumps back to the private view

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: The session owner, revisiting a link they themselves shared earlier (e.g. clicking their own message in Slack).
**Goal**: Get back into the live, editable session rather than stay on the read-only shared page.
**Preconditions**: Signed in as the user who owns the underlying session; opening a `shareId` for one of their own chats.
**Ideal path**: 1 step — the page detects ownership and surfaces a direct shortcut, so there is no need to navigate to `/sessions` and search.

### Steps
1. The owner opens `/shared/[shareId]` while signed in → the server component compares `viewerSession.user.id === session.userId`; since they match, `ownerSessionHref` is set to `/sessions/{sessionId}/chats/{chatId}` and `SharedChatContent` renders a banner between the header and the messages: "You own this shared chat" / "Open the original session to keep working from your private view." with an "Open session →" button that navigates straight there.

### Variations
- none found — this banner only has the one action.

### Edge Cases
- If the owner is signed out (or signed in as a different account) when opening their own share link, `ownerSessionHref` stays `null` and the banner does not render — they see exactly what any other visitor sees, with no hint the chat is theirs.

---

## STORY-1107: A stranger opens a dead or revoked share link

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: A stranger with a mistyped, expired, or deliberately revoked `shareId`.
**Goal**: (Unintentional) — just clicked a bad link.
**Preconditions**: The `shareId` does not resolve to a `shares` row, or resolves but its `chatId`/`sessionId` no longer exist.
**Ideal path**: 1 step — there is no recovery path from inside this page; the only "path" is leaving.

### Steps
1. The stranger opens `/shared/<bad-id>` → `SharedPage` awaits `getShareByIdCached(shareId)`; when it returns `null`, or when the resolved `getChatById`/`getSessionByIdCached` calls come back empty, the page calls Next.js `notFound()` → renders `app/shared/[shareId]/not-found.tsx` if one existed, but **none exists for this route** (discovery.md confirms only the chat route and `/shared` have `error.tsx`; `not-found.tsx` only exists at the chat level), so this falls through to the framework's default 404.

### Variations
- The share row exists but the owner deleted the session/chat afterward: same `notFound()` outcome, indistinguishable from a never-existed share.
- The owner revoked sharing via "Revoke link" (`DELETE /api/sessions/:sessionId/chats/:chatId/share`, STORY-1104's ShareDialog): the row is deleted, so the next visit to that URL 404s the same way — revocation is immediate, not soft-deleted or grace-period'd.

### Edge Cases
- A runtime error partway through resolving the share (e.g. a DB blip after the share is found but before messages load) is caught by `app/shared/[shareId]/error.tsx` instead — a client component with "Something went wrong" and a "Try again" button that calls `reset()`, distinct from the 404 case above.

---

## STORY-1108: A colleague watches a shared chat that is still actively streaming

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: Jordan, watching a shared link to a task a teammate kicked off minutes ago that hasn't finished yet.
**Goal**: See the agent's progress update live without refreshing the page manually.
**Preconditions**: `sharedChat.activeStreamId != null` at page-load time (the underlying run is still in flight).
**Ideal path**: 1 step — the page self-updates; watching is the whole interaction.

### Steps
1. Jordan opens the share link mid-run → `isStreaming` is `true`, so `SharedChatContent` renders `SharedChatStatus` beneath the messages: an animated status word drawn deterministically from the `shareId` (`Pondering`/`Crafting`/`Vibing`/`Simmering`/`Marinating`/`Philosophising`/`Ruminating`, hashed so the same share always shows the same word) plus a live elapsed timer ticking every second from the last user message's timestamp.
2. Every 3 seconds (`POLL_INTERVAL_MS`), the component fetches `GET /api/shared/{shareId}/status`; on every successful poll it calls `router.refresh()` so newly-completed tool calls and text stream into view (a full server-component refresh, not a diff-patch), and stops polling once the endpoint reports `isStreaming: false`.

### Variations
- The run finishes between Jordan's page load and his next poll: the status indicator and timer disappear on the next `router.refresh()`, leaving the final message state — no "stream ended" toast or transition animation.

### Edge Cases
- A poll fails (transient network error): the `catch` block silently swallows it — "next poll will retry" — no error is shown to Jordan; the timer keeps ticking client-side regardless of poll success.

---

## STORY-1109: A teammate exports a shared chat as markdown instead of screenshotting it

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: A teammate who wants to paste the conversation into an internal wiki page or PR description.
**Goal**: Get a clean text/markdown copy of the shared conversation, not a screenshot.
**Preconditions**: Has a valid `shareId`.
**Ideal path**: 1 step — this is a plain HTTP GET, not a UI flow; there is no button for it in `SharedChatContent` itself, it is reached by URL or `curl`/fetch.

### Steps
1. The teammate requests `GET /api/shared/{shareId}/markdown` (optionally with `Accept: text/markdown` to get `content-type: text/markdown; charset=utf-8` instead of the default `text/plain`) → `app/api/shared/[shareId]/markdown/route.ts` rebuilds the conversation as YAML-frontmatter (`session_name`, `repo`, `branch`, `pr_url`, `pr_number`, `created_at`) followed by `## User` / `## Assistant` sections, each assistant turn preceded by an `<!-- tool_activity: duration=… tool_calls=N -->` HTML comment when hidden tool/reasoning activity happened before it.

### Variations
- none found — one endpoint, one document shape, content-negotiated by `Accept` header only.

### Edge Cases
- The `shareId`, its chat, or its session don't resolve: the route returns a **404 with a body**, `"Not found\n"`, using the same content-negotiated `content-type` — unlike the HTML page's `notFound()`, this is a real API response a script can check the status code on.
- The export runs the exact same `redactSharedEnvContent` pass as the HTML page (STORY-1105) — the security guarantees and gaps are identical between the two surfaces.

---

## STORY-1110: A stranger browses a public usage profile and filters it by date

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: Alex, a stranger who saw a link to someone's Open Agents profile on social media.
**Goal**: See how much this person has been building and with what models.
**Preconditions**: The target user has `publicUsageEnabled: true` in `userPreferences` (opt-in, default off).
**Ideal path**: 2 steps — land on the profile, then optionally narrow the date window; nothing else on the page is interactive.

### Steps
1. Alex opens `/u/<username>` (or equivalently `/<username>` — **verified identical**: `apps/web/app/u/[username]/page.tsx` is a one-line re-export, `export { default, generateMetadata } from "../../[username]/page";`, so both URLs render the exact same server component and produce the exact same output) → `getPublicUsageProfile(username, null)` returns `status: "ok"`, and the page renders avatar/name/`@username`, a left-rail stats block (Total tokens, Messages, Tool calls via `formatTokens`/`toLocaleString`), a `ContributionChart` of daily activity, and ranked lists (Agent split: Main vs Subagents; Top models, top 5; Code churn: lines added/removed/total).
2. Alex clicks a date preset — All time / 7d / 30d / 90d (`Link` to `?date=7d` etc.) — the page is a plain server-rendered link, so this is a full navigation, not client-side filtering; the active preset is highlighted via `profile.dateSelection.value` matching.

### Variations
- Alex instead hits a raw share of the profile with `?date=xyz` (some invalid value): `parsePublicUsageDate` fails, the page silently falls back to "All time" data and shows a small note: "Invalid date filter — showing all-time data."
- A section with zero data for the window (e.g. no model usage in the last 7 days) is omitted from the ranked-list grid entirely (`RankedList` returns `null` when `items.length === 0`) rather than showing an empty box.

### Edge Cases
- The profile has literally no usage yet (`hasUsage: false` and no models/churn): `hasRankedData` is false, so the whole ranked-list grid is skipped and only the header stats (all zero) and the (empty) contribution chart render.
- Two accounts could theoretically share a case-insensitive username collision: `pickPublicUsageUserCandidate` resolves it deterministically — exact-case match wins first, then most-recent `lastLoginAt`, then `id` as a final tiebreaker — so the same URL always resolves to the same profile.

---

## STORY-1111: A stranger hits a private profile vs. a profile that doesn't exist

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: A stranger trying two different usernames.
**Goal**: (Two separate attempts) view a colleague's usage profile.
**Preconditions**: One username belongs to a real user who has not enabled public usage; the other username belongs to no user at all.
**Ideal path**: 1 step each — both are dead ends, but they must look and behave differently, not collapse into the same generic error.

### Steps
1. **Username exists, profile not public**: visiting `/[username]` where the user has `publicUsageEnabled: false`/unset → `getPublicUsageProfile` returns `{ status: "disabled" }` → the page renders `ProfileDisabledView`: a **200 OK page** with "This profile is private" / "This user has not made their usage profile public." — deliberately not a 404, so the visitor learns the account is real but opted out, without the app confirming or denying that distinction being meaningfully different from "doesn't exist" at the HTTP layer (both render 200; only copy differs).
2. **Username matches no user row at all**: `pickPublicUsageUserCandidate` returns `{ found: false, reason: "not_found" }` → the page calls `notFound()` → standard Next.js 404.

### Variations
- none found.

### Edge Cases
- Case sensitivity: lookups are done against `lower(users.username)`, so `/AlexSmith` and `/alexsmith` resolve to the same profile (or the same "disabled"/"not found" outcome) — there is no case-sensitive miss.

---

## STORY-1112: The account owner turns on their public profile and shares the URL

**Type**: short
**Topic**: Public & Alternate Surfaces
**Persona**: The signed-in account owner, deciding to make their usage stats public for the first time.
**Goal**: Publish a public profile others can view, and get the shareable URL.
**Preconditions**: Signed in; `publicUsageEnabled` currently `false` (the default).
**Ideal path**: 2 steps — flip the switch, copy the URL; this is a Settings action that feeds the public surface, not itself the public surface.

### Steps
1. In `/settings` → Preferences, the owner toggles the "Publish a shareable wrapped page at `/u/username`" switch on → `preferences-section.tsx`'s `handlePublicUsageEnabledChange` calls `updatePreferences({ publicUsageEnabled: true })`.
2. A revealed sub-panel shows the read-only Public profile URL input (`/u/{username}`) with a "Copy" button (`handleCopyPublicProfileUrl`) → the owner copies it to share.

### Variations
- The owner later toggles it back off: `setCopiedPublicProfile(false)` resets the copied-state indicator, and any previously-shared `/u/username` link now serves `ProfileDisabledView` (STORY-1111) to everyone, immediately — there is no grace period.

### Edge Cases
- The Settings copy always frames the URL as `/u/username` (the canonical form the product surfaces to users), even though `/username` resolves identically — see STORY-1110 for the verified equivalence.

---

## STORY-1113: An external developer authorizes their MCP client against Open Agents

**Type**: long
**Topic**: Public & Alternate Surfaces
**Persona**: Priya, a developer wiring up a third-party MCP client (e.g. an agent IDE) to act on her Open Agents account.
**Goal**: Grant her MCP client exactly the access she intends, and no more.
**Preconditions**: The MCP client has already dynamically registered and initiated an OAuth authorize request with PKCE (`requirePKCE: true` is enforced server-side — a client that skips `code_challenge` is rejected before any of this UI renders).
**Ideal path**: 4 steps — sign-in and consent are two separate, unskippable gates by design; there is no shortcut through either.

### Steps
1. Priya's MCP client opens her browser to `GET /api/auth/mcp/authorize?...` (the better-auth `mcp` plugin's authorize endpoint) with `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, and `code_challenge`. She is not signed in, so better-auth redirects to `/mcp/login?<same query string>`.
2. `/mcp/login` (`app/mcp/login/page.tsx`) resolves the client via `loadRegisteredMcpClient(clientId)` and shows its real registered name + redirect host (never the raw, attacker-controllable `client_id` query value) with copy: "{Client name} ({host}) is requesting access to your Open Agents sessions over MCP." She clicks "Sign in with Vercel" (`callbackUrl` = the original `/api/auth/mcp/authorize?...` query string replayed verbatim), completes Vercel OAuth.
3. Back at the (now-authenticated) authorize endpoint, `forceMcpConsentPrompt` (`lib/auth/mcp-consent-hook.ts`) unconditionally injects `prompt: "consent"` into the query on **every** authorize call to `/mcp/authorize` — even if the client claims a prior approval — so better-auth always redirects to `/mcp/consent?consent_code=...&client_id=...&scope=...` (the code is also stashed in a signed `oidc_consent_prompt` cookie).
4. `McpConsentPanel` lists each requested scope in plain language via `SCOPE_DESCRIPTIONS`: `sessions:read` → "Read your sessions, chat previews, and diff summaries"; `sessions:write` → "Start and steer agent runs on your behalf. This runs code in a sandbox and consumes credits."; `agents:read` → "Read your background agents and their runs"; `agents:write` → "Create and modify your background agents"; `sandbox:exec` → "Execute commands in your sandboxes." Priya reviews the list and clicks **Approve** → `POST /api/auth/oauth2/consent { accept: true, consent_code }` → redirected to `data.redirectURI`, which hands the code back to her client, which exchanges it (with its PKCE verifier) at `/mcp/token` for a scoped access token.

### Variations
- Discovery-first client: instead of a hardcoded URL, the client first fetches `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` to learn the endpoints and `scopes_supported` (deliberately overridden to advertise the real 5 MCP scopes, since better-auth's own discovery default would otherwise advertise none and a spec-following client would request zero scopes and see no tools).
- `client_id` doesn't resolve to any registered client: `/mcp/login` shows neutral fallback copy ("An MCP client is requesting access... You will be asked to approve exactly what it can read after you sign in.") instead of a client name, rather than rendering unverified attacker-controlled text.

### Edge Cases
- **Consent-code replay across the two gaps this hook closes**, both defense-in-depth against a leaked/observed `consent_code`: (1) if something tries to redeem the code directly at `/mcp/token` before Priya has approved it, `refuseUnapprovedTokenRedemption` looks up the verification record's stashed `requireConsent` flag and throws `invalid_grant` — "This authorization code has not been approved by the user yet."; (2) if a POST to `/oauth2/consent` carries Priya's `consent_code` but comes from a *different* logged-in session, `refuseConsentForOtherUsers` compares the code's stored `userId` against the actual caller's session and throws `invalid_grant` — "This approval link belongs to a different account." — closing a gap where better-auth's own `/oauth2/consent` authenticates the caller but never checks the code belongs to them.
- Priya's approval link is old/expired or malformed (`consent_code` missing, or `loadPendingMcpConsent` returns non-`ready`): she sees plain text, not a broken form — "This approval link is missing required parameters..." or "...is invalid or has expired. Ask the MCP client to restart the connection."
- She opens the consent link while signed out: "Sign in to your Open Agents account, then reopen this approval link." — no auto-redirect back through `/mcp/login`, she must reopen the original link.

---

## STORY-1114: A user reads the requested scopes and DECLINES the MCP consent

**Type**: medium
**Topic**: Public & Alternate Surfaces
**Persona**: A security-conscious Open Agents user who does not fully trust the MCP client requesting access.
**Goal**: Refuse this client's requested scopes without leaving lingering access behind.
**Preconditions**: Signed in, on `/mcp/consent` with a valid, unexpired `consent_code` (same setup as STORY-1113 up to step 4).
**Ideal path**: 1 step — one button, immediate effect; there is no partial-grant or "pick which scopes" UI, it's all-or-nothing per this request.

### Steps
1. She reads the scope list — in particular `sessions:write` ("Start and steer agent runs on your behalf. This runs code in a sandbox and consumes credits.") and `sandbox:exec` ("Execute commands in your sandboxes") stand out as broad, code-execution-capable grants — and clicks **Deny** → `respond(false)` posts `{ accept: false, consent_code }` to `/api/auth/oauth2/consent`, and on success `window.location.href = data.redirectURI` sends her back to the client's `redirect_uri` carrying an OAuth error rather than a code; the client never receives a usable token.

### Variations
- none found — Deny and Approve are symmetric single-click actions against the same endpoint, differing only in the `accept` boolean.

### Edge Cases
- The `/api/auth/oauth2/consent` POST itself fails (network error, non-OK response): `status` becomes `"error"` and the panel shows "Something went wrong approving this request. Please try again." — both buttons stay disabled only while `status === "pending"`, so she can retry Deny immediately.
- Because `forceMcpConsentPrompt` forces `prompt=consent` on every single authorize call (STORY-1113 step 3), declining here does not create a standing "always ask" preference to manage later — the next authorize attempt from any client, including this same one, always shows this screen fresh.

---

## STORY-1115: A mobile user checks on a running session and reads through the chat

**Type**: long
**Topic**: Public & Alternate Surfaces
**Persona**: Jordan, away from their desk, checking progress on an agent task from their phone.
**Goal**: See what's happening across their sessions and read one in detail, from a phone-sized screen.
**Preconditions**: Signed in; has at least one active and one waiting-on-approval session.
**Ideal path**: 3 steps — the mobile IA is deliberately narrow (3 tabs + one pushed screen), so there's exactly one way to get from "what's going on" to "read this one."
**Alternate paths**: none — mobile has no search, no keyboard shortcuts, no secondary navigation.

### Steps
1. Jordan opens `/m` on their phone → `app/(mobile)/m/layout.tsx` (the route-group-wide auth guard) checks `getServerSession()`; authenticated, so it renders `(tabs)/layout.tsx`'s scroll area + `MobileTabBar` (fixed bottom nav: Activity / **+** New / Me, the center "New" rendered as a raised FAB-style primary button) around the `MobileActivityScreen`.
2. `MobileActivityScreen` loads real sessions via `useSessions({ includeArchived: false })`, sorts them attention-first (working → waiting → idle → done → error, via `sortActivity`), and shows filter chips with live counts (All/Working/Waiting/Done) computed from the *unfiltered* list so counts don't shift as Jordan filters. He taps the "Waiting" chip to see just the session that needs his input.
3. He taps that session's row → `router.push('/m/chat/{latestChatId}')` (mobile addresses chats by `chatId` only, not `sessionId + chatId` like desktop) → `app/(mobile)/m/chat/[chatId]/page.tsx` resolves the owning session server-side, confirms `sessionRecord.userId === session.user.id`, and renders `MobileChatScreen` full-screen, **outside** the `(tabs)` layout — no bottom tab bar overlaps the chat, replaced by `MobileChatHeader`'s back-chevron.

### Variations
- The session has a pending tool approval: `findPendingApproval(messages)` detects it and `MobileToolApprovalBar` is pinned directly above `MobileComposer`, with its own Approve/Deny wired to the same `addToolApprovalResponse` the desktop approval UI uses — the *decision* surface is shared, only the chrome is mobile-specific.
- Jordan taps the model pill (`ModelSelectorCompact`) above the composer to switch models mid-chat — the one piece of session configuration mobile chat exposes inline.

### Edge Cases (what mobile genuinely cannot do that desktop can)
- **No file mentions, no slash commands, no attachments, no voice input.** `MobileComposer` is a single auto-growing `Textarea` plus Send/Stop — the component's own comment marks attachments explicitly unbuilt: `// TODO seam: file attach not wired — requires a mobile upload endpoint`. Desktop's composer supports `@`-file mentions, `/` slash commands, image/text attachments, and voice→`/api/transcribe`; none of that exists here.
- **No diff, Files, or PR panel.** `MobileChatHeader` accepts an optional `onOverflow` prop for a "⋮" menu, but `MobileChatScreen` never passes one, so the button never renders — there is no path from `/m/chat/[chatId]` to view changed files, commit, or manage the PR. Reviewing a diff requires switching to desktop.
- **Tapping into someone else's chat ID redirects, it doesn't error.** If `sessionRecord.userId !== session.user.id`, the page does `redirect("/m")` rather than a 403/404 — an ownership mismatch just bounces back to the Activity list.
- **Signed-out access hits `/`, not `/get-started`.** Unlike desktop's `requireOnboarded()` gate (which routes to `/get-started` for missing GitHub link/App installation), `m/layout.tsx` only checks for a session and redirects straight to `/` — mobile has no onboarding flow of its own; a brand-new user still has to complete GitHub connection on desktop first.

---

## STORY-1116: A mobile user starts a new session from their phone

**Type**: long
**Topic**: Public & Alternate Surfaces
**Persona**: Sam, wanting to kick off a quick coding task from their phone before a meeting.
**Goal**: Start a new session against a repo (or a chat-only session) from mobile.
**Preconditions**: Signed in; has GitHub linked with at least one installation for the repo path.
**Ideal path**: 4 steps — task text, pick a mode, (if repo mode) pick repo + branch, submit; every field has a sane default so the shortest real path only touches what's required.

### Steps
1. Sam taps the center **+** tab → `/m/new` → `MobileNewSessionScreen` renders a task `Textarea`, `MobileSuggestionChips` (tap-to-fill prompt starters), a two-button "Chat only" / "With repo" toggle, and (collapsed by default) an "Advanced" section for Auto commit & push / Auto create PR.
2. He types a task, taps "With repo" → the installation selector appears only if he has more than one GitHub installation; repos load via `useInstallationRepos`, he taps one.
3. `useRepoDefaults` fires and pre-fills the branch from the repo's configured default the moment a repo is picked (`BranchSelectorCompact` still lets him override to an existing branch or a new one) — Sam accepts the default and taps **Start session**.
4. `buildCreateSessionInput` assembles the payload (repo mode requires a fully-resolved `repoSelection` — button stays disabled otherwise, "silently falling back to a chat-only session" is explicitly guarded against) → `useSessions().createSession` → on success, the task text is stashed in `sessionStorage` under `mobile-chat-prefill:{chat.id}` and Sam is routed to `/m/chat/{chat.id}`, where `MobileChatScreen` reads and clears that key on mount and auto-sends it as the first message into the (still-empty) conversation.

### Variations
- Sam picks "Chat only" instead: `repoSelection` stays `null`, the repo/branch UI never renders, and step 4's payload creates a plain chat session — same submit button, same auto-send-prefill mechanic on landing in `/m/chat/[chatId]`.
- Sam expands "Advanced" and flips Auto commit & push / Auto create PR: these are tri-state (`null` = inherit) — his explicit toggle wins over the repo's configured default, which wins over his global preference default, mirroring desktop's precedence exactly.

### Edge Cases (what mobile's New form omits vs. desktop's `SessionStarter`)
- **No runtime mode selector.** Desktop's session creation form lets the user choose `classic` vs `managed_runtime`; `buildCreateSessionInput`/`MobileNewSessionScreen` has no such control — every mobile-created session takes whatever the default runtime mode is.
- **No Vercel project link and no full/shallow clone toggle.** Both are present in desktop's `SessionStarter` (per discovery.md's session-creation feature map) and absent from the mobile form entirely — not hidden behind "Advanced," just not built.
- **GitHub not connected:** the repo list area shows "Connect GitHub in Settings to use repositories." with no in-flow way to start the GitHub App install from `/m/new` — Sam would have to leave mobile (or at least leave this screen) to connect it.
- **Repo list load failure is distinguished from "no repos.**" A failed `/api/github/installations` or repo fetch shows "Couldn't load your repositories. This is a load failure, not an empty account." with a Retry button, rather than silently rendering an empty repo list that would read as "you have no repos."
- **Optimistic chat-ID race:** because the chat is created client-side and routed to immediately, `/m/chat/[chatId]` retries the chat lookup up to 50 times at 100ms intervals (`isOptimisticChatId` detects the UUID shape) before giving up and redirecting back to `/m` — covering the gap between navigation and the row actually landing in the database.
