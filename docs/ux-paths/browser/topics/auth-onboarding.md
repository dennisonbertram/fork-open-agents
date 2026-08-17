# Topic: Authentication, Onboarding & GitHub App Connection

> Generated from code inspection of `apps/web` (Next.js App Router, better-auth
> 1.6, GitHub App install flow). Grounded in: `app/page.tsx`, `app/home-page.tsx`,
> `components/auth/*`, `app/get-started/*`, `lib/auth/config.ts`,
> `lib/github/connect-status.ts`, `lib/github/urls.ts`, `app/api/github/post-link`,
> `app/api/github/app/install`, `app/api/github/app/callback`,
> `app/sessions/require-onboarded.ts`, `app/settings/accounts-section.tsx`,
> `components/github-reconnect-dialog.tsx`, `components/github-reconnect-gate.tsx`,
> `app/providers.tsx`, `components/repo-selector-compact.tsx`,
> `app/api/github/repos/_lib/create-empty-repo.ts`.

---

## STORY-101: First-time founder connects everything and starts her first Session

**Type**: long
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Priya Patel, engineering lead at a seed-stage startup, has just heard about Open Agents from a friend and wants to see if it can automate a PR review for her repo `acme-widgets/checkout-service`.
**Goal**: Go from a cold landing-page visit to a working Session against her real repository.
**Preconditions**: Signed out, no Vercel account session, no GitHub account linked, no prior installation. Clean browser (no leftover `github_app_install_state` cookies).
**Ideal path**: 6 — (1) click "Sign in with Vercel", (2) approve on Vercel, (3) click "Connect GitHub", (4) approve GitHub OAuth scopes, (5) pick account + select repos on GitHub's install screen, (6) click "Install". Everything else (post-link sync, callback sync, onboarding-gate check) is server-driven redirect chaining, not a user decision.
**Alternate paths**: Sticky nav "Sign in with Vercel" button (appears on scroll, same `callbackUrl`) instead of the hero button — identical downstream flow. Also reachable if she instead clicks "Choose repositories" inside the session-creation repo picker after landing on `/sessions` some other way (see STORY-110) — but she has no session yet, so that path isn't available here.

### Steps
1. Priya lands on `/` signed out → sees `SignedOutHero`: headline "Open Agents.", subhead about durable cloud Sessions, and the hero row with **Sign in with Vercel** (primary) next to a ghost **Open Source** GitHub link. She hesitates a beat — *"why Vercel and not just GitHub?"* — and reads the small print underneath: "Why Vercel? It's the identity provider for Open Agents — one account to sign in, no separate password to create." That resolves the hesitation.
2. She clicks **Sign in with Vercel** → button shows a spinner and "Signing in..." → `authClient.signIn.social({ provider: "vercel", callbackURL: "/get-started?step=github&next=/sessions" })` redirects her to Vercel's OAuth consent screen.
3. She approves the Open Agents Vercel OAuth app → Vercel redirects to `/api/auth/callback/vercel` → better-auth creates her user record (username derived from her Vercel profile) and redirects to the `callbackURL`: `/get-started?step=github&next=/sessions`.
4. `GetStartedPage` (server component) confirms she has a session; `needsOnboarding()` is true (no GitHub link, 0 installations) → renders `GetStartedFlow`.
5. She sees the two-panel `/get-started` screen: left panel shows the dark "Open Agents" wordmark, a one-line product description, and the 4-step `ProductJourney` checklist (Connect GitHub → Start a Session → Create an Automation → Inspect a Run) as inert (non-clickable) text since GitHub isn't linked yet. Right panel: "Get Started" heading, "Authentication prerequisite / Signed in with Vercel" section already showing her Vercel avatar, name and email in a connected-looking card — *she reassures herself: "OK, step 0 is already done."*
6. Below it, "1. Connect GitHub" — the not-linked branch: copy reads "Connect your GitHub account to verify your identity (step 1 of 2). Next you'll install the Open Agents GitHub App and choose which repositories it can access." and an outline **Connect GitHub** button with a GitHub icon.
7. She clicks **Connect GitHub** → button swaps to a spinning loader → `authClient.linkSocial({ provider: "github", callbackURL: "/api/github/post-link?next=/sessions" })` redirects to GitHub's OAuth consent screen requesting `read:user`, `user:email`, `repo`.
8. On GitHub, she reviews the requested scopes (she pauses on `repo` — *"that's a lot of access"* — but the earlier copy already told her why: "verify your identity... next you'll choose which repositories") and clicks **Authorize**.
9. GitHub redirects to better-auth's `/api/auth/callback/github`, which links the GitHub account to her existing user, then redirects to `/api/github/post-link?next=/sessions`.
10. `post-link` route: fetches her fresh GitHub token, resolves her username, calls `syncUserInstallations` — finds 0 installations (expected, she hasn't installed the App yet) — and since no installations exist in the DB either, redirects to `/api/github/app/install?next=/sessions`.
11. `install` route: confirms she's linked, no `target_id`/`reconnect` param, re-syncs (still 0), then redirects to `https://github.com/apps/open-agents/installations/new/permissions?state=<generated>` and sets two short-lived httpOnly cookies (`github_app_install_redirect_to=/sessions`, `github_app_install_state=<state>`).
12. On GitHub's hosted install screen she picks her personal account as the install target, chooses **Only select repositories**, and searches for `checkout-service`, selecting `acme-widgets/checkout-service`.
13. She clicks **Install** → GitHub redirects to `/api/github/app/callback?installation_id=48213077&setup_action=install&state=<state>`.
14. `callback` route validates the state cookie matches (timing-safe compare), fetches her token, calls `syncUserInstallations` again — this time it finds 1 installation — sets `githubStatus = "app_installed"`. Since `app_installed` is a success status, `resolveGitHubReturnTarget` sends her straight to the original `next` target with the status appended: `/sessions?github=app_installed` (cookies cleared).
15. `SessionsLayout` (server) re-runs `requireOnboarded(userId)` — now `needsOnboarding()` is false (linked + 1 installation) — passes through, renders the Sessions shell.
16. Priya lands on `/sessions` inside the workspace. She notices the URL still carries `?github=app_installed` in the address bar but **no toast or banner acknowledges it** — the `useGitHubReturnToast` confirmation hook only exists on `/settings/connections`, not on `/sessions`. She has to infer success from now seeing the session-creation UI rather than being told explicitly. Minor "did that work?" beat before she proceeds.
17. She opens the session composer, picks `acme-widgets` → `checkout-service` from the repo picker (now populated since the installation synced), and starts her first Session.

### Variations
- If she'd clicked **Open Source** instead of **Sign in with Vercel** on the landing page, she'd land on the public GitHub repo in a new tab and have to come back — a plausible false start for a skeptical first-time visitor.
- If GitHub's install screen offers **All repositories** instead of "Only select," `repositorySelection` becomes `"all"` and later shows a globe icon (not the funnel icon) on `/settings/connections`.

### Edge Cases
- If she closes the GitHub install tab instead of clicking Install, `callback` never fires; she's stuck on `/get-started` step 1 showing "linked but no install" until she retries (see STORY-106).
- If GitHub's install redirect drops the `installation_id` (some setup_action flows omit it) but nothing was actually installed, `callback` falls into the `no_action`/`missing_installation_id=1` branch, not `app_installed`.

---

## STORY-102: DevOps engineer installs the App org-wide with "All repositories"

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Marcus Webb, DevOps engineer at Fenwick Robotics, already has a personal GitHub App installation from testing solo and now wants every repo under the `fenwick-robotics` GitHub org available to his whole team.
**Goal**: Add a second (org-level) GitHub App installation covering all of Fenwick Robotics' repos, without disturbing his existing personal installation.
**Preconditions**: Signed in, GitHub linked, already has 1 personal installation (`hasGitHubInstallations = true`), is an owner of the `fenwick-robotics` GitHub org.
**Ideal path**: 4 — (1) click "Add GitHub account" from Connections, (2) pick the org on GitHub's target picker, (3) choose "All repositories", (4) click "Install".
**Alternate paths**: From `/get-started?step=github` he'd land on the "connected" branch (already has an install) with just a "Start a Session" button and no visible "add another account" affordance — the org-install entry point effectively lives only on `/settings/connections`, not on the get-started screen. Also reachable via the `startGitHubInstallForOrg(githubId)` per-org "Install" button if the org already appears in his accounts list as "not installed" (e.g. GitHub already knows about the org membership from a prior sync).

### Steps
1. Marcus goes to `/settings/connections` directly (bookmarked) → `AccountsSection` loads, shows `ConnectedState`: his GitHub avatar, green-dot **Connected** dropdown, and a collapsed "Installed in 1/1 accounts" toggle (auto-collapsed since coverage is complete).
2. He expands the accounts list and clicks **Add GitHub account** (ghost button with a `+` icon) → `startGitHubInstallFromSettings()` navigates to `/api/github/app/install?next=/settings/connections`.
3. `install` route: he's linked, has ≥1 existing installation, no `target_id` → falls through to the "already has installations" branch → redirects to `https://github.com/apps/open-agents/installations/select_target?state=<state>` (GitHub's own account/org picker, not an Open Agents screen).
4. On GitHub, Marcus selects the `fenwick-robotics` organization from the target list.
5. GitHub's install screen for the org appears; because Fenwick Robotics doesn't restrict third-party app installs for owners, he can choose directly — he picks **All repositories** (so new repos his team creates later are automatically covered) and clicks **Install**.
6. GitHub redirects to `/api/github/app/callback?installation_id=91004421&setup_action=install&state=<state>` → sync finds 2 installations now → `githubStatus = "app_installed"` → success status → redirects to `next` (`/settings/connections`) with `?github=app_installed`.
7. Back on `/settings/connections`, `useGitHubReturnToast` (which *does* run on this page) fires `toast.success("GitHub App installed", { description: "Repository access is now configured for the selected account." })`, and the URL is cleaned via `history.replaceState` (the `github` and `missing_installation_id` params are stripped).
8. The accounts list now auto-refreshes to "Installed in 2/2 accounts," with a new `fenwick-robotics` row showing a green **Globe** icon (tooltip: "All Repositories") linking out to GitHub's installation-settings page for that org.

### Variations
- If Fenwick Robotics has "Restrict third-party application access" enabled and Marcus is a member but not an owner, GitHub shows its own request-for-approval screen instead of the install screen — same downstream `callback` handling, but `setup_action=request` (see STORY-104).
- If he instead chooses **Only select repositories** and picks `fenwick-robotics/telemetry-pipeline` and `fenwick-robotics/fleet-api`, the org row later shows the amber **ListFilter** icon (tooltip: "Select Repositories").

### Edge Cases
- If Marcus is not an owner/admin of `fenwick-robotics` and the org has restricted installs entirely (no self-service), GitHub's picker may not list the org as installable at all — he'd need an org owner to run this flow themselves; Open Agents has no in-app way to detect or explain this ahead of time.

---

## STORY-103: Returning, fully-connected user signs in again and hits an unnecessary extra click

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Dana Osei, an indie hacker who already fully onboarded weeks ago for her `tidepool-notes` app, signed out at the end of a work session, and is now signing back in the next morning.
**Goal**: Get back to `/sessions` as fast as possible to resume work.
**Preconditions**: Signed out (but her user record, linked GitHub account, and 1 installation all still exist in the DB). Landing on `/`.
**Ideal path**: 2 — click "Sign in with Vercel", approve on Vercel, land directly on `/sessions` since nothing about her account needs setup. A fully onboarded returning user should never see the onboarding screen again.
**Alternate paths**: none found — every sign-in entry point (hero button, sticky nav button) hardcodes the same `callbackUrl`, so there is no route that skips `/get-started` on sign-in even when onboarding is already complete.

### Steps
1. Dana clicks **Sign in with Vercel** on the landing hero → approves on Vercel → redirected to `/api/auth/callback/vercel` → better-auth resolves her existing user → redirects to the hardcoded `callbackURL`, `/get-started?step=github&next=/sessions` (this is `PRODUCT_JOURNEY[0].href`, the same URL used for a brand-new user).
2. `GetStartedPage` checks `needsOnboarding()` — it's `false` for her — but the redirect-skip condition is `!onboarding && requestedStep !== "github"`. Since `requestedStep === "github"` (baked into every sign-in button's callback URL), the condition is `false`, so **no redirect happens** — she is served the full `GetStartedFlow` UI anyway.
3. She sees the "GitHub connected" success card (her avatar, "@dana-osei", green check) — a beat of *"wait, didn't I already do this?"* — and has to click **Start a Session** to actually reach `/sessions`.
4. `router.push("/sessions")` fires; `requireOnboarded()` passes instantly; she's finally in her workspace.

### Variations
- If she instead types `open-agents.dev` in a new tab while already signed in, `app/page.tsx` (server) redirects her straight to `/sessions` with zero extra clicks — the friction only exists on the *sign-in* path, not on revisiting the root URL while a session cookie is already valid.

### Edge Cases
- None — this is a deterministic, always-reproducible extra step for every returning user who signs out and back in, not an edge case. It's a real redundancy: the same "GitHub connected" information Dana just needs to skip past also appears identically on `/settings/connections` and inside the `ProductJourney` checklist, none of which auto-advance her.

---

## STORY-104: Org admin approval required — installation request sits pending

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Alex Chen, a senior engineer at Northwind Labs who wants to install Open Agents for the `northwind-labs` org but is not an org owner — Northwind restricts third-party GitHub App installs to admin approval.
**Goal**: Request installation approval for the org and understand what happens next.
**Preconditions**: Signed in, GitHub linked, no installations yet, member (non-owner) of an org with restricted app installs.
**Ideal path**: 5 — (1) Connect GitHub, (2) authorize GitHub OAuth, (3) pick the org on GitHub's install/request screen, (4) select repos, (5) click "Request". The pending-approval wait itself is not a UI step; it's an async event outside the app.
**Alternate paths**: He could also start this from `/settings/connections` → "Connect" (`NotConnectedState`) → same `linkSocial` → `post-link` → `install` chain, landing on `/settings/connections` instead of `/get-started` at the end.

### Steps
1. Alex signs in, lands on `/get-started?step=github&next=/sessions`, clicks **Connect GitHub**, authorizes on GitHub.
2. `post-link` syncs 0 installations → redirects to `/api/github/app/install?next=/sessions` → GitHub's install picker.
3. He selects the `northwind-labs` org. Because the org restricts installs, GitHub shows a **request** flow instead of a direct install screen — he picks the repos he wants (`northwind-labs/pricing-engine`, `northwind-labs/billing-api`) and clicks **Request**.
4. GitHub redirects to `/api/github/app/callback?setup_action=request&state=<state>` — note: **no `installation_id`** is present yet, since nothing is installed. `callback` route: sync finds 0 installations, but `setupAction === "request"` takes precedence in the status-resolution order, so `githubStatus = "request_sent"` (this branch is checked before the `installationId` check).
5. `request_sent` is not a success status, so he lands on `/get-started?github=request_sent&step=github&next=/sessions`.
6. He sees the amber, clock-icon `GitHubStatusNotice`: **"Installation approval pending"** — "An org admin needs to approve the installation request. **This page will not update automatically — check back after it's approved.**" No retry link is shown for this status (`showRetry: false`).
7. Below the notice, because he still has no installation, `GitHubConnectStep` falls into the "linked but no install" branch too — he sees the "Install GitHub App" button *again*, which could tempt him to click it a second time and file a duplicate request. He hesitates: *"Do I click this again, or just wait?"* The copy doesn't explicitly say not to re-request.
8. He closes the tab and waits. Two days later, an org owner approves the request in GitHub's own UI (outside Open Agents entirely — there is no in-app approval surface).
9. Alex returns to `/get-started?step=github` (bookmarked or via the product-journey link) — `useSession` now reports `hasGitHubInstallations: true` — `GitHubConnectStep` renders the "connected" branch immediately, no notice needed since he arrived without a `github=` param this time.

### Variations
- If he checks `/settings/connections` instead while waiting, the org row shows up as `installStatus: "not_installed"` with a small ghost **Install** button — clicking it just re-runs the same request flow rather than showing "pending" state explicitly; the app has no persisted "request pending" indicator anywhere.

### Edge Cases
- If the org owner denies the request on GitHub, there's no webhook-driven notice back to Open Agents at all — Alex only discovers the denial by trying "Install GitHub App" again and getting prompted through the same request flow, with no explanation that a prior request was rejected.

---

## STORY-105: Vercel sign-in is interrupted mid-flow

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Jordan Reyes, a contractor working from a shared client laptop with an aggressive corporate proxy that sometimes drops OAuth redirects.
**Goal**: Sign in with Vercel despite a flaky network interruption.
**Preconditions**: Signed out, landing on `/`.
**Ideal path**: 2 — click "Sign in with Vercel", approve on Vercel, land on `/sessions`. The interruption is an environmental failure, not a designed step.
**Alternate paths**: none found — there is exactly one sign-in entry with an error-recovery variant (the same button re-rendering its own inline error), and a second, separate error surface (the landing-page banner) for the specific case of a provider-side redirect failure.

### Steps
1. Jordan clicks **Sign in with Vercel** → redirected to Vercel's OAuth screen.
2. The proxy interferes and better-auth can't complete the state exchange; better-auth appends `?error=state_mismatch` (an internal better-auth code, deliberately not surfaced verbatim) to the `errorCallbackURL`, which is set to the current landing page origin+pathname (`resolveErrorCallbackUrl()` in `sign-in-button.tsx`).
3. Jordan lands back on `/?error=state_mismatch`. `SignedOutHero` reads `searchParams.get("error")` and renders `SignInDidNotCompleteBanner`: a `role="alert"` red-tinted box reading **"Sign-in didn't complete. Try again below."** — deliberately plain-language, no raw error code shown.
4. He clicks **Sign in with Vercel** again → succeeds this time → lands on `/get-started?step=github&next=/sessions` (or straight to `/sessions` if he already has an account, per STORY-103's caveat).

### Variations
- If the failure happens *client-side* before any redirect (e.g. `authClient.signIn.social` itself throws, network down), `SignInButton`'s own local error state renders inline instead: `AuthCtaError` with "Sign-in didn't start. Try again." and a "Try again" link — a different, more immediate error surface than the page-level banner.

### Edge Cases
- If Jordan bookmarks or shares the `?error=state_mismatch` URL, anyone loading it signed-out sees the same banner even though nothing just failed for them — the error state is purely URL-driven with no expiry.

---

## STORY-106: User links GitHub but backs out of installing the App

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Theo Marsh, a cautious engineer evaluating Open Agents on behalf of his team, wants to link his identity first and think about repo access before granting it.
**Goal**: Complete step 1 (GitHub OAuth) without yet committing to installing the App.
**Preconditions**: Signed in via Vercel, GitHub not yet linked.
**Ideal path**: 3 — link GitHub, land back at "install the App" step, decide later. (Getting to a *safe*, resumable stopping point after linking is itself the desired outcome here — not full completion.)
**Alternate paths**: none found for "pause after linking" — the only way back into the flow at the same point is to reload `/get-started`.

### Steps
1. Theo clicks **Connect GitHub** on `/get-started`, authorizes on GitHub's OAuth screen.
2. `post-link` syncs 0 installations → chains to `/api/github/app/install?next=/sessions` → GitHub's install screen loads.
3. Theo reads the requested permissions on GitHub's install screen, decides he wants to check with his team first, and simply **closes the browser tab** without clicking Install or Cancel.
4. Nothing further happens server-side — no callback ever fires, so no status is recorded. His account is now in the "linked, no installation" sub-state.
5. Later that day he reopens `open-agents.dev` — since he's still signed in, `app/page.tsx` redirects him to `/sessions` — but `requireOnboarded()` in `SessionsLayout` immediately catches `needsOnboarding() === true` and redirects to `/get-started?next=%2Fsessions` (the hardcoded `ONBOARDING_GATE_TARGET`).
6. This time there's no `step=github` or `github=` param at all — `GetStartedFlow` computes `shouldShowInstallStep = !forceReconnect && hasGitHubAccount && !hasGitHubInstallations` → true — he lands directly on the "linked but no install" branch: "Your GitHub identity is verified. Next, install the Open Agents GitHub App..." with an **Install GitHub App** button. No confusing "no_action" notice this time since he arrived organically, not via a `github=` redirect.
7. He clicks **Install GitHub App**, this time follows through on GitHub, selects `theo-marsh/prototype-cli`, clicks Install, and lands back on `/sessions?github=app_installed`.

### Variations
- If instead he'd clicked **Cancel** on GitHub's install screen (rather than just closing the tab), GitHub redirects back to the callback URL with `setup_action` present but no `installation_id` — `callback` computes `githubStatus = "no_action"`, `missingInstallationId = true`, landing him on `/get-started?github=no_action&missing_installation_id=1&step=github&next=%2Fsessions` with the neutral notice: **"No changes made — You returned from GitHub without installing the app."**

### Edge Cases
- If Theo's `github_app_install_state` cookie expires (15-minute `maxAge`) before he comes back to finish, a stale retry would fail state validation and produce `invalid_state` ("Connection interrupted") instead of quietly resuming — he'd have to start the install step over via the "Install GitHub App" button again, which mints a fresh state.

---

## STORY-107: Sam re-authenticates after IT rotates GitHub App permissions

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Sam Okafor, a backend engineer whose company's IT/security team ran a quarterly GitHub App audit and uninstalled the Open Agents App from the org as part of cleanup, without telling engineering.
**Goal**: Get his repository access working again after it silently breaks.
**Preconditions**: Was previously fully connected (linked + 1 org installation); the GitHub-side installation has since been deleted by an admin. Sam is mid-session in the app when this surfaces.
**Ideal path**: 3 — dismiss/notice the reconnect prompt, click "Reconnect GitHub", pick the org and reinstall on GitHub's picker.
**Alternate paths**: (a) `/settings/connections` → **Re-authenticate** button in the connection dropdown. (b) The global `GitHubReconnectGate` modal's **Reconnect GitHub** link (routes to `/settings/connections`, which is (a)). (c) The repo picker's own "Reconnect GitHub" card if he's mid-session-creation when this happens. All three ultimately hit the same `/api/github/app/install?reconnect=1` or `linkSocial` calls, just from different trigger points — a genuine three-surface redundancy worth flagging.

### Steps
1. Sam is on `/sessions`, unaware anything changed. In the background, `Providers` has `GitHubReconnectGate` mounted (via `useGitHubConnectionStatus`, polling `/api/github/connection-status`, `dedupingInterval: 30s`, revalidates on focus).
2. On his next tab focus, the hook re-fetches; `connection-status` route finds 1 installation row in the DB but `syncUserInstallations` against GitHub now returns 0 (GitHub no longer reports it) → `reconnectRequired = true`, `syncedInstallationsCount === 0` → `status: "reconnect_required"`, `reason: "installations_missing"`.
3. `GitHubReconnectGate` checks `pathname !== "/get-started"` and `pathname !== "/settings/connections"` — since he's on `/sessions`, the gate renders a **blocking modal** (`showCloseButton={false}`, no way to dismiss): title "Reconnect GitHub", description "GitHub no longer reports your app installation. This usually happens after app permission changes or an installation being invalidated. Reconnect now to restore repository access and keep using the app." — Sam can't click anything else on the page; his first thought is *"did I break something?"*
4. He clicks the only button, **Reconnect GitHub**, which is a plain `Link` to `/settings/connections`.
5. On `/settings/connections`, `AccountsSection` shows `ConnectedState` with `reconnectRequired: true` — an inline amber warning under his username ("Your GitHub connection has been disconnected.") and the header button switches to an amber-dot **Reconnect** dropdown.
6. He opens the dropdown and clicks **Re-authenticate** → `startGitHubReconnect("installations_missing")` — since the reason is specifically `installations_missing`, this branch skips the OAuth re-link entirely and goes straight to `/api/github/app/install?next=/settings/connections&reconnect=1`.
7. `install` route: `reconnect === "1"` → looks up his own GitHub account id (`getGitHubAccountId`) and redirects straight to `https://github.com/apps/open-agents/installations/new/permissions?state=<state>&target_id=<his personal account id>` — **note: reconnect mode only ever targets his personal account, not the org that was actually uninstalled**, which is the wrong target for Sam's actual problem.
8. Sam realizes the install screen is offering to install to his personal account, not `northwind-labs` where the App was actually removed — he has to back out and instead use the **"Add GitHub account"** flow (STORY-102) to reinstall to the org specifically, since the auto-targeted reconnect path doesn't help his case.
9. Once he reinstalls (to the org, via the general "select_target" picker), `callback` syncs successfully, the reconnect dialog stops appearing, and the amber warning on `/settings/connections` clears.

### Variations
- If his `reason` had been `token_unavailable` or `sync_auth_failed` instead, step 6's `startGitHubReconnect` branch would call `authClient.linkSocial(...)` directly (full OAuth re-link) rather than jumping to the App install screen — a meaningfully different remediation path depending on *why* the connection broke, exposed only through the description text, not the button label (both cases render the same "Re-authenticate" label).

### Edge Cases
- If Sam disconnects instead of reconnecting (`Disconnect` in the dropdown), the confirmation dialog explicitly warns: "This revokes this app's access to your GitHub account and removes your local connection. **The GitHub App installation itself stays on GitHub** — you can reconnect at any time," with a link out to GitHub's own installed-apps settings page to fully remove it there.

---

## STORY-108: Global reconnect dialog interrupts an active chat session

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Renee Castillo, mid-conversation with an agent inside a Session, has no idea her company's GitHub token was just invalidated by a security rotation.
**Goal**: Understand why she's suddenly blocked and get back to work.
**Preconditions**: Actively viewing `/sessions/<id>/chats/<id>`; GitHub connection just became `reconnect_required` (`token_unavailable`) between polls.
**Ideal path**: 2 — dialog appears, click "Reconnect GitHub", complete OAuth re-link, return to work. A well-designed flow would let this happen in a background tab/popup instead of blocking the whole app, but that's not what exists.
**Alternate paths**: none found — this is a single-purpose blocking modal with exactly one action.

### Steps
1. Mid-chat, `useGitHubConnectionStatus`'s next revalidation (on window focus) returns `reason: "token_unavailable"`. Since her current pathname is neither `/get-started` nor `/settings/connections`, `GitHubReconnectGate` renders the dialog on top of her chat.
2. The chat behind it is still fully rendered (per the discovery notes, a transient auth-check failure doesn't unmount authenticated UI) — but she can't interact with it; the dialog has no close button and `open` is hardcoded `true` whenever `reconnectRequired` is true. She can't dismiss it and keep working, even to finish typing a message.
3. She clicks the only escape hatch, **Reconnect GitHub**, which routes her *away* from her chat to `/settings/connections` — losing her place in the conversation view (though her draft message, if any, is preserved by the composer's own local state, not by this flow).
4. On `/settings/connections`, since her reason is `token_unavailable`, `startGitHubReconnect` calls `authClient.linkSocial({ provider: "github", callbackURL: "/api/github/post-link?next=/settings/connections" })` directly — she re-authorizes on GitHub, returns, and the connection clears.
5. She manually navigates back to her Session/chat via the sidebar to resume where she left off.

### Edge Cases
- If she happens to be on `/get-started` or `/settings/connections` already when the status flips, the gate is explicitly suppressed on those two routes (avoiding a dialog-on-top-of-the-recovery-UI loop) — but everywhere else in the app, including deep inside a chat, the dialog can appear with zero warning.

---

## STORY-109: Self-hosted deployment is missing its GitHub App configuration

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Yuki Tanaka, evaluating a freshly `/deploy-your-own` self-hosted instance of Open Agents for her team, hasn't yet set the `NEXT_PUBLIC_GITHUB_APP_SLUG` environment variable on her deployment.
**Goal**: Onboard onto her own deployment.
**Preconditions**: Signed in via Vercel on her self-hosted instance, GitHub not linked, `NEXT_PUBLIC_GITHUB_APP_SLUG` unset on the server.
**Ideal path**: N/A — this deployment is genuinely broken until an operator sets the env var; the "ideal" outcome is a fast, unambiguous dead-end message, which is what happens.
**Alternate paths**: She'd hit the identical `app_not_configured` status whether she trips it from `/get-started`'s "Install GitHub App" button or from `/settings/connections`'s "Connect" button — both eventually call `/api/github/app/install`.

### Steps
1. Yuki completes Vercel sign-in and GitHub OAuth linking normally (those don't depend on the App slug) — `post-link` syncs 0 installations and redirects her to `/api/github/app/install?next=/sessions`.
2. `install` route checks `process.env.NEXT_PUBLIC_GITHUB_APP_SLUG` — it's unset — so before doing anything else it redirects to `resolveGitHubReturnTarget("app_not_configured", ...)`, landing her on `/get-started?github=app_not_configured&step=github&next=%2Fsessions`.
3. She sees the orange, triangle-icon `GitHubStatusNotice`: **"GitHub App isn't configured"** — "This Open Agents deployment doesn't have a GitHub App configured yet. Contact an administrator." (`role="alert"`, no retry link — retrying would just hit the same wall).
4. Below the notice, because she's linked but has no installation, she still sees the normal "Install GitHub App" button — clicking it just repeats the same dead end.
5. She has no in-app path forward; she has to go find (or become) the operator, set the env var, and redeploy.

### Edge Cases
- Because this status is emitted *before* any GitHub redirect happens, no cookies are set and nothing needs cleanup — it's a clean, cheap failure, not a partially-committed one.

---

## STORY-110: Mid-session-creation install, bypassing `/get-started` entirely

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Marcus Webb (from STORY-102) — this time it's a teammate, Nia Brooks, who somehow already has a Vercel+session but zero GitHub installations, and jumps straight into starting a new Session.
**Goal**: Pick a repo for a new Session without ever consciously visiting the "Get Started" page.
**Preconditions**: Signed in, GitHub linked, zero installations. Sitting in the new-Session repo picker (`RepoSelectorCompact`, e.g. inside the home-page `SessionStarter` or a "new session" dialog).
**Ideal path**: 3 — click "Choose repositories" in the repo picker card, complete GitHub's install screen, land back with the picker now populated.
**Alternate paths**: The `requireOnboarded()` gate would have caught her on `/sessions` and routed her through `/get-started` first if she'd navigated there normally — this story is the case where she reaches a repo picker *without* passing through that gate (e.g., the home page, which does not call `requireOnboarded()`).

### Steps
1. Nia is on the home page (`/`, already authenticated so she sees the `SessionStarter`, not `SignedOutHero`) and opens the repo picker to start a Session.
2. `RepoSelectorCompact` checks `installations.length === 0` (after loading) → renders a `GitHubActionCard`: title "Install GitHub App", description "Install the GitHub App to choose which repositories are available.", button **Choose repositories** — a self-contained call-to-action that never mentions "/get-started" at all.
3. She clicks **Choose repositories** → `startGitHubInstall()` navigates to `/api/github/app/install?next=%2F` (current path, the home page, is the `next` target — not `/sessions`).
4. `install` route redirects her to GitHub's install picker (she's already linked, so no `not_linked` detour) → she selects her account, chooses **Only select repositories** → `nia-brooks/design-tokens` → clicks Install.
5. `callback` syncs 1 installation, `app_installed` success status → redirects to `next` (`/`) with `?github=app_installed`.
6. Back on the home page, the repo picker's `useSWR` for installations re-fetches and now shows `nia-brooks` as an available owner with `design-tokens` in the repo list — she never saw `/get-started` at any point in this journey.

### Edge Cases
- If Nia had **not** yet linked GitHub at all (`!hasGitHub`), the same card instead reads "Continue on GitHub to choose which repositories are available." / "Install GitHub App" — but clicking it still hits `/api/github/app/install`, which (per `install/route.ts`'s `not_linked` guard) bounces her to `/get-started?github=not_linked&step=github&next=%2F` instead of straight to GitHub — so an unlinked user *does* eventually see `/get-started`, just as a mid-flow detour rather than a starting point.

---

## STORY-111: Repository creation hits the typed `github_scope_required` error

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Theo Marsh (from STORY-106), now fully connected, wants to spin up a brand-new empty repo `northwind-labs/scratch-experiments` directly from the session-creation "Create repository" dialog rather than picking an existing one.
**Goal**: Create a new GitHub repo through Open Agents and start a Session against it.
**Preconditions**: Signed in, GitHub linked, App installed on `northwind-labs` — but the org's GitHub App installation was configured without "Repository creation"/Administration permission (an org-admin setting Theo doesn't control).
**Ideal path**: 3 — open "Create repository" dialog, fill name + visibility, submit. The scope shortfall is a permissions problem outside the ideal path, not a step count issue.
**Alternate paths**: none found for repo creation itself — there are two separate dialog components in the codebase (`create-repository-dialog.tsx` and `create-repo-dialog.tsx`) that both POST to the same `/api/github/repos` endpoint, a duplication worth flagging even though it isn't user-visible as two different flows.

### Steps
1. Theo opens the repo picker for a new Session, clicks "Create new repository," and the create-repository dialog opens (owner: `northwind-labs`, repo name field, private/public toggle, optional description).
2. He types `scratch-experiments`, leaves it private, and clicks **Create**.
3. `submitCreateRepository` POSTs `{ repoName: "scratch-experiments", isPrivate: true, owner: "northwind-labs" }` to `/api/github/repos`.
4. Server-side, `createEmptyRepo` calls `octokit.rest.repos.createInOrg(...)` — GitHub returns a 403 (the installation token lacks repo-creation/Administration scope for the org) — `create-empty-repo.ts` maps this to `{ errorKind: "github_scope_required", status: 403, error: "GitHub rejected the request. Reconnect GitHub to grant repository creation access, then try again. If reconnecting offers no new permission, the GitHub App needs repository Administration access enabled by an administrator." }`.
5. The dialog's inline error area renders that exact message as plain red text — no "Reconnect" button embedded in the dialog itself, just prose telling him to go reconnect manually. Theo's first reaction: *"reconnect... where?"* — the message names the action but doesn't link to `/settings/connections`.
6. He navigates to `/settings/connections` himself, clicks **Re-authenticate** in the dropdown, re-links GitHub — but since the underlying blocker is an org *permission* setting, not his OAuth token, reconnecting changes nothing.
7. He retries "Create repository" with the same inputs — same 403, same `github_scope_required` error again — now he understands (from the second sentence in the copy) that he actually needs an org admin to grant Administration access to the App installation on GitHub's side, something no button in Open Agents can do for him.

### Variations
- If GitHub instead returns 422 (name collision), the same code path returns `errorKind: "repo_name_taken"` with a friendlier, actionable message ("A repository named ... already exists under northwind-labs.") — a much shorter, self-service fix than the scope error.

### Edge Cases
- If GitHub returns a 404 instead of 403 for the same underlying permission problem (GitHub's API is inconsistent about which code it uses here), `create-empty-repo.ts` explicitly treats both identically, producing the same `github_scope_required` copy — so Theo's experience doesn't depend on which of the two GitHub returns.

---

## STORY-112: Typing `/get-started` directly when already fully onboarded

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Dana Osei (from STORY-103) again, this time curious what the onboarding page looks like now, types `/get-started` straight into the address bar out of curiosity rather than arriving via a sign-in redirect.
**Goal**: Just look at the page — not really trying to "get started" again.
**Preconditions**: Fully signed in, linked, installed. Navigating directly to `open-agents.dev/get-started` (no query params at all).
**Ideal path**: 0 — she never sees the onboarding UI; this is the correctly-optimized case in the codebase.
**Alternate paths**: none found — this is the one entry point that *does* short-circuit correctly, in direct contrast to STORY-103's sign-in-button entry point.

### Steps
1. Dana types the URL and hits enter → `GetStartedPage` (server): session exists, `needsOnboarding()` is `false`, and — crucially — `requestedStep` is `null` this time (no `?step=github` in a bare URL), so the condition `!onboarding && requestedStep !== "github"` evaluates `true`.
2. She's immediately `redirect()`-ed server-side to `sanitizeInternalRedirect(requestedNext, "/sessions")` — since `next` is also absent, this resolves to the fallback `/sessions`. She never sees any part of the get-started UI; the redirect is instant and server-rendered.

### Edge Cases
- If she instead types `/get-started?step=github` (perhaps recalling the sign-in redirect URL she saw once), she reproduces exactly STORY-103's "extra click" experience even though she navigated there manually — the page cannot distinguish "arrived via sign-in button" from "typed the URL with the same query string."

---

## STORY-113: Disconnecting GitHub and rediscovering the still-live installation

**Type**: medium
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Dana Osei, cleaning up her account before handing `tidepool-notes` off to a co-founder, wants to remove Open Agents' access to her personal GitHub temporarily.
**Goal**: Disconnect GitHub from Open Agents, confirm session-creation is blocked, then reconnect and confirm nothing needs to be reinstalled.
**Preconditions**: Fully connected (linked + 1 personal installation). On `/settings/connections`.
**Ideal path**: 5 — (1) open the Connected dropdown, (2) click Disconnect, (3) confirm in the dialog, (4) later click Connect again, (5) re-authorize on GitHub — no reinstall needed since GitHub still has the App installed.
**Alternate paths**: none found for disconnect itself (single destructive action, one entry point). Reconnect-after-disconnect can go through either the `/settings/connections` "Connect" button (`NotConnectedState`) or through hitting the onboarding gate again via `/sessions`.

### Steps
1. Dana opens the green-dot **Connected** dropdown on `/settings/connections` and clicks **Disconnect** (destructive-styled item).
2. A confirmation dialog opens: "Disconnect GitHub?" with body text explicitly clarifying "This revokes this app's access to your GitHub account and removes your local connection. **The GitHub App installation itself stays on GitHub** — you can reconnect at any time," plus a link to manage installations on GitHub directly. She reads it and understands this won't touch the actual GitHub App install.
3. She clicks the destructive **Disconnect** button → `unlinkGitHub()` runs, deleting her local account-link row and her local installation rows (`deleteGitHubAccountLink`, `deleteInstallationsByUserId`) — note this deletes Open Agents' *record* of the installation, not the installation on GitHub itself.
4. On success, `mutate("/api/auth/info")` and the connection-status/install-status queries all refresh; a `toast.success("GitHub disconnected")` fires; the section now renders `NotConnectedState`: "No GitHub account connected" with an outline **Connect** button.
5. Out of curiosity, she navigates to `/sessions` — `requireOnboarded()` now sees `needsOnboarding() === true` (both checks fail post-disconnect) and redirects her to `/get-started?next=%2Fsessions`, exactly as if she'd never onboarded — the "1 of 2 steps" not-linked copy shows again.
6. She clicks **Connect GitHub**, re-authorizes on GitHub's OAuth screen (same `read:user user:email repo` scopes — GitHub remembers the prior grant, so this is typically a fast "already authorized" bounce, not a fresh consent screen).
7. `post-link` fetches her fresh token, calls `syncUserInstallations` — since the App installation was **never actually removed from GitHub**, the sync immediately finds her 1 pre-existing installation again — `count > 0` → redirects straight to `resolveGitHubReturnTarget("account_connected", "/sessions", ...)` — she's back to fully connected **without ever seeing GitHub's install screen again**.

### Edge Cases
- If she'd instead gone to GitHub directly and uninstalled the App (following the dialog's own "Manage installations on GitHub" link) before reconnecting, step 7's sync would find 0 installations and route her through the full install screen again — the "no reinstall needed" shortcut only holds if she disconnects *only* inside Open Agents.

---

## STORY-114: A stale session's silent 401 triggers a full global sign-out mid-workflow

**Type**: long
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Priya Patel (from STORY-101), weeks later, has left an Open Agents tab open overnight on her laptop; her better-auth session cookie has since expired server-side.
**Goal**: (Unintentionally) discover she's been signed out, then get back into her workspace.
**Preconditions**: Was previously fully onboarded and mid-Session. Her auth session has expired server-side but her browser tab is still open showing the last-rendered UI.
**Ideal path**: 2 — see a clear "you've been signed out" state, click "Sign in with Vercel," land right back where she was. What actually happens takes more like 4-5 real actions and offers no clear explanation.
**Alternate paths**: none found — there is exactly one global-401 handler (`Providers`' `SWRConfig.onError`), so however she trips it, the outcome is identical.

### Steps
1. Priya returns to her laptop the next morning; her Open Agents tab still shows yesterday's chat and session UI (nothing has visibly changed — SWR's cached data is still rendered).
2. She clicks into the composer to type a follow-up message. This triggers some data fetch (e.g., the session's SWR-backed data revalidating) that hits an API route requiring auth.
3. The server returns 401 with `{ error: "Not authenticated", errorKind: "unauthorized" }`. The client's `fetcher` throws a `FetchError` with `status: 401` and `message: "Not authenticated"`.
4. `Providers`' `SWRConfig` `onError` handler fires: it checks `error instanceof FetchError && error.status === 401 && error.message === "Not authenticated"` — true, and `signingOut.current` is `false` — so it flips a guard flag and calls `authClient.signOut()`.
5. Whether or not that call succeeds, the `.finally()` always runs: resets the guard, `router.replace("/")`, `router.refresh()`. Priya's screen abruptly replaces her chat with the signed-out landing page — no toast, no "your session expired" message, no chance to see what she was about to send. Her half-typed composer draft is gone with the navigation.
6. She's a little startled (*"did I get logged out? did something break?"*) — the landing page gives no explanation, just the normal `SignedOutHero` as if she were a first-time visitor.
7. She clicks **Sign in with Vercel** again → Vercel recognizes her (likely a fast re-consent or silent bounce since she's still authenticated with Vercel itself) → redirects to `/api/auth/callback/vercel` → new better-auth session created → redirects to `/get-started?step=github&next=/sessions`.
8. Exactly as in STORY-103, because her GitHub link and installation both still exist in the DB, `needsOnboarding()` is false — but `requestedStep === "github"` still forces the full `GetStartedFlow` render rather than an immediate redirect.
9. She sees the "GitHub connected" success card again, clicks **Start a Session** to finally land on `/sessions`.
10. `/sessions` loads her session list; she has to manually find her way back to the specific session and chat she was in — there was no `next` parameter carrying her exact prior URL (the sign-in `callbackUrl` only ever targets `/sessions`, generically, not her deep link), so she has to re-navigate through the sidebar to find `checkout-service` and reopen her chat.
11. She re-reads the chat history to reconstruct what she was about to say, and re-types her message.

### Variations
- If the 401 had instead occurred while she was on a page with no active SWR-backed authenticated fetch in flight (e.g., a fully static settings subpage she'd left idle), the sign-out wouldn't trigger until *something* attempts a fetch — meaning the "you're signed out" moment can be arbitrarily delayed past the actual expiry, not tied to any visible timer.
- Per the `useSession` hook's documented nuance, a *different* kind of failure (500, network blip, dependency outage) on `/api/auth/info` does **not** trigger this global sign-out and does **not** unmount her authenticated UI — only an exact 401/"Not authenticated" match does. A transient DB hiccup instead shows the `AuthCtaError` "We couldn't verify your session." with a manual retry, leaving her chat visible underneath.

### Edge Cases
- If two SWR requests both 401 in quick succession, the `signingOut.current` ref guard prevents `authClient.signOut()` from being called twice, but both still ultimately call `router.replace("/")` — harmless double-navigation, not a double sign-out call.

---

## STORY-115: Signing out from the home-page header

**Type**: short
**Topic**: Authentication, Onboarding & GitHub App Connection
**Persona**: Priya Patel, done for the day, wants to sign out of Open Agents on a laptop she's about to hand to a colleague.
**Goal**: End her session cleanly and confirm she's actually signed out.
**Preconditions**: Signed in, sitting on the home page (`/`) with sessions in her `SessionDrawer`.
**Ideal path**: 2 — open the avatar menu, click "Log out". Landing on the signed-out landing page is sufficient confirmation.
**Alternate paths**: The identical action is also pinned at the bottom of the two-level `/settings` shell ("Sign out," rendered twice in the source for the expanded vs. collapsed nav states) and, on mobile, at the bottom of the "Me" tab (`mobile-me-screen.tsx`, calling `authClient.signOut()` directly rather than the server action) — three separate sign-out entry points sharing the same intent, two of which use different code paths (server action vs. client `authClient.signOut()`).

### Steps
1. Priya clicks her avatar in the top-right corner of the home-page header (`UserAvatarDropdown`) → a dropdown opens with **Settings** (with a gear icon) and, below a separator, a destructive-styled **Log out** item (red text, `LogOut` icon).
2. She clicks **Log out** → the `signOut` server action runs: it looks up her session, best-effort revokes her Vercel OAuth token via Vercel's `/login/oauth/token/revoke` endpoint (swallowing any failure so a revoke error can't block sign-out), calls `auth.api.signOut()` to end the better-auth session server-side, and finally `redirect("/")`.
3. She lands back on `/`, which — now that `getServerSession()` returns nothing — renders `SignedOutHero`, confirming she's signed out. She hands the laptop to her colleague.

### Edge Cases
- If the Vercel token revoke call fails (network issue, Vercel API hiccup), the `catch` block only logs the error server-side — sign-out still proceeds and she still lands on the landing page as if everything succeeded, with no visible difference to her.