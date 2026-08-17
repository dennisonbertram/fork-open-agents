# Failure, Empty & Gated States — UX Journey Stories

Generated against the running app described in `docs/ux-paths/browser/discovery.md`.
Every error kind, flag name, and empty-state copy string below is read from the
actual source, not invented. File paths are relative to `apps/web/` unless noted.

---

## STORY-1201: The chat error boundary is a dead end when the error is not transient

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Priya, mid-flow on a client demo, watching her session's chat panel go blank after a component throw.
**Goal**: Recover the chat she was mid-conversation in without losing her place.
**Preconditions**: A render-time throw inside the `[sessionId]/chats/[chatId]` route subtree (e.g. a malformed tool-call payload crashing a renderer).
**Ideal path**: 1 — the boundary should either recover automatically or hand the user a next step; today it hands her exactly one button.
**Alternate paths**: Reload the whole tab (outside the boundary's `reset`), which re-runs the full route from scratch instead of just the error segment.

### Steps
1. A component under the chat route throws → `app/sessions/[sessionId]/chats/[chatId]/error.tsx` catches it, logs `"Chat page error:"` to `console.error`, and renders `"Something went wrong"` with a single outlined "Try again" button.
2. Priya clicks "Try again" → `reset()` re-renders the segment. If the throw was caused by bad server data (not a transient render glitch), the same component throws again immediately.
3. She is stuck: no error detail, no digest, no "go home" or "back to sessions" link, nothing distinguishing "try again might work" from "this will never work." The only way out is the browser back button or manually navigating to `/sessions`.

### Variations
- If the throw is genuinely transient (e.g. a one-off null-deref during a re-render), "Try again" silently fixes it and the user never notices anything was wrong beyond a flash.

### Edge Cases
- The boundary has no `digest`/error-id surfaced to the user at all, so if Priya reports "chat crashed" to support, there's nothing in the UI she can hand them — only what made it to server logs via `console.error`.
- **Finding**: the boundary tells the user WHAT happened ("something went wrong") but not WHY, and its only WHAT-NEXT is a retry with no fallback if retry doesn't work. This is a partial dead end for any non-transient failure.

---

## STORY-1202: The shared-chat error boundary strands a signed-out visitor with no way back

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Tom, a prospect who got a `/shared/[shareId]` link from a sales rep and has no Open Agents account.
**Goal**: View the shared session someone sent him.
**Preconditions**: The shared page throws (e.g. a redaction step fails, or the share record is in a state the renderer doesn't expect).
**Ideal path**: 1 — for a signed-out visitor with no app to navigate back into, the boundary is the entire experience; it needs to end somewhere useful.
**Alternate paths**: none found — there is no nav chrome on `/shared/[shareId]` to fall back on.

### Steps
1. `app/shared/[shareId]/error.tsx` catches the throw, logs `"Shared page error:"`, and renders the identical minimal UI as the chat boundary: `"Something went wrong"` + outlined "Try again" button, centered on a bare background.
2. Tom clicks "Try again." If the underlying cause persists (e.g. a data shape the redaction logic can't handle), it throws again.
3. Unlike Priya in STORY-1201, Tom has no sidebar, no `/sessions` to navigate to, and no account — the reset button is the only affordance on the page. There is no link back to the marketing site or an explanation of what a "shared session" even is.

### Variations
- Compare to a *working* shared page: no error, full read-only session view with env redaction per the discovery doc.

### Edge Cases
- Because this is a signed-out, no-chrome surface, a dead-end error here is worse than STORY-1201's: an internal user can navigate away via the app shell; an external visitor evaluating the product has nowhere to go except closing the tab. **Finding**: identical boundary code was reused for two very different audiences (authenticated internal user vs. anonymous external visitor) without adjusting the recovery affordance for the audience that has no app shell to fall back on.

---

## STORY-1203: A missing session falls through to Next's unbranded 404 — no boundary exists

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: Marcus, who bookmarked `/sessions/abc123` weeks ago; the session was since deleted.
**Goal**: Reopen the session he bookmarked.
**Preconditions**: `sessionId` no longer resolves to a row in `sessions` (deleted, or never existed).
**Ideal path**: 2 — one page load to hit the 404, one action (typing a URL or using history) to get back into the app, since nothing on the page itself links back in.
**Alternate paths**: none found — no `not-found.tsx` exists anywhere between this route and the app root.

### Steps
1. Marcus opens `/sessions/abc123`. `app/sessions/[sessionId]/page.tsx` runs: `getServerSession()` confirms he's signed in, `getSessionByIdCached(sessionId)` returns `null`, so the route calls `notFound()` (`app/sessions/[sessionId]/page.tsx:22-24`).
2. Next.js walks up looking for the nearest `not-found.tsx`: none at `app/sessions/[sessionId]/`, none at `app/sessions/`, none at `app/` (confirmed: only `app/sessions/[sessionId]/chats/[chatId]/not-found.tsx` exists, scoped to the chat segment two levels deeper — it does not apply here since Marcus never reaches that segment).
3. Next.js renders its own built-in "This page could not be found" page — no Open Agents branding, no sidebar, no link back to `/sessions`.
4. Marcus's only way back in is to edit the URL bar himself or use browser history. Nothing on the page tells him whether the session was deleted, whether he mistyped the URL, or whether something is broken.

### Variations
- If `sessionRecord.userId !== session.user.id` (Marcus is signed in as someone else and hits another user's session id), the route `redirect("/")`s instead of 404ing (`app/sessions/[sessionId]/page.tsx:26-28`) — a different, friendlier outcome for the "wrong owner" case than for the "doesn't exist" case, even though both are the same information-hiding goal.
- The equivalent miss one level deeper, at `/sessions/[sessionId]/chats/[missingChatId]`, gets the dedicated `ChatNotFound` boundary (STORY-1204) with a "New Chat" button — the exact same underlying event (dangling id) has a designed recovery path one route segment later and none at all here.

### Edge Cases
- Any other route calling bare `notFound()` without a scoped `not-found.tsx` above it inherits this same unbranded dead end — confirmed present at minimum for `/repos/[owner]/[repo]` (`access.ok` check) and the flag-gated routes in STORY-1205's `notFound()` branches, none of which have their own `not-found.tsx`.
- **Finding**: this is exactly the "at least one story lands somewhere with no boundary" case — the product has a well-designed not-found experience one level down (chat) and nothing at all one level up (session), for the same underlying failure mode (dangling id).

---

## STORY-1204: The chat not-found boundary is the one dead-end recovery done right

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Jae, who had a chat tab open, deleted that chat from another tab, then clicked back to the first tab.
**Goal**: Get back to a working chat in the same session.
**Preconditions**: `chatId` no longer exists under a session Jae still has access to.
**Ideal path**: 1 — land on the boundary, click one button, be in a working chat.
**Alternate paths**: switch to a different existing chat tab in the sidebar instead of creating a new one.

### Steps
1. Jae's stale tab re-renders against a deleted `chatId`. `app/sessions/[sessionId]/chats/[chatId]/not-found.tsx` renders: a `MessageSquarePlus` icon, "Chat not found," and "This chat may have been deleted or doesn't exist. Start a new one to continue working," plus a "New Chat" button.
2. He clicks "New Chat" → `createChat()` (from `useSessionLayout`) creates a chat and `switchChat(chat.id)` navigates him into it immediately.
3. Jae is working again inside the same session, no re-navigation to `/sessions` required.

### Variations
- none found — the boundary has exactly one action and it always resolves the dead end.

### Edge Cases
- This boundary tells Jae WHAT happened ("chat not found"), a plausible WHY ("deleted or doesn't exist"), and WHAT TO DO ("start a new one") with a working button — contrast directly with STORY-1201 (same directory tree, but the sibling `error.tsx` gives none of that).

---

## STORY-1205: Three feature flags, three different ways of telling the user "no"

**Type**: long
**Topic**: Failure, Empty & Gated States
**Persona**: Devon, an ordinary authenticated user (not an admin) on a deployment where `OPEN_AGENTS_EXPOSE_GTM=false`, `AGENT_LOOPS_ENABLED=false`, and admin tools are naturally off since he isn't an admin.
**Goal**: Explore three parts of the product he's heard about — GTM tools, Agent Loops, and admin settings — to see what they do.
**Preconditions**: Signed in as a non-admin user on a deployment with the above flags off.
**Ideal path**: 3 — one visit per surface, each should tell him plainly whether it's "not for you" or "not turned on here," with no dead ends. In practice the three surfaces disagree on how much to tell him.
**Alternate paths**: none found for reaching any of the three surfaces other than direct URL navigation, since none of them appear in nav when disabled.

### Steps
1. Devon navigates to `/gtm`. `app/gtm/layout.tsx` checks `isProductSurfaceExposed("gtm")` (backed by `OPEN_AGENTS_EXPOSE_GTM` in `lib/product-surfaces/config.ts`) and calls `notFound()` with no explanation at all — same unbranded 404 as STORY-1203, indistinguishable from a typo'd URL. He cannot tell whether GTM tools don't exist, are broken, or are simply off for him.
2. Devon navigates to `/loops/new`. `isAgentLoopsEnabled()` is false, so instead of `notFound()` the page renders normally with a visible block: **"Loops are disabled" / "Agent Loops are not enabled in this deployment. Set `AGENT_LOOPS_ENABLED=true` to enable them."** (`app/loops/new/page.tsx:56-64`). This names the exact environment variable to a user who has no access to environment variables and no admin role — actionable for nobody actually reading it.
3. Devon navigates to `/settings/admin`. `AdminContent` checks `isAdmin` and — since he isn't one — renders `AdminAccessGate`: **"Admin tools" / "This area is for workspace admins. You don't have access — that's expected for most people,"** with a "Back to settings" button (`app/settings/admin/admin-access-gate.tsx`). This is the most honest of the three: it names what the area is, why he can't see it, normalizes it ("expected for most people"), and gives a working way out.

### Variations
- The *background dispatch layer* for a loop run that does hit `feature_disabled` gets yet a fourth register of copy — admin-appropriate and correctly deflected to an admin: **"The loops feature is disabled on this deployment." / "Ask your workspace administrator to enable the loops feature flag."** (`app/loops/error-copy.ts:145-150`, `getLoopErrorCopy("feature_disabled")`). This is the right words in the wrong place — it never reaches the `/loops/new` page Devon actually visited, which instead prints the raw env var name.

### Edge Cases
- Compare all four outcomes for what is functionally the same event ("this capability is off"): silent 404 (GTM), raw env var leaked to a powerless user (loops creation page), correctly-worded but differently-located admin-pointed copy (loop run error), and an honest scoped gate with a recovery link (admin settings). **Finding**: the product has already solved this problem once (the admin gate) and once more in the error-copy layer (`feature_disabled`), but neither pattern was reused for the two flag checks a plain user is most likely to hit directly by URL or by clicking "New loop."

---

## STORY-1206: The session-creation repo picker tells three different kinds of empty apart — mostly

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: Aisha, setting up her first repo-scoped session right after installing the GitHub App on a subset of her org's repos.
**Goal**: Pick a repository to scope her new session to.
**Preconditions**: GitHub App installed with `repositorySelection: "selected"`, and Aisha's account has access to zero of the repos actually granted (a common misconfiguration right after installing).
**Ideal path**: 1 — the empty state should immediately tell her this is an installation-scope problem, not "you have no repos."
**Alternate paths**: retype the search to broaden it (won't help — the problem is installation scope, not the search term).

### Steps
1. Aisha opens the repo combobox in the new-session dialog (`components/repo-selector.tsx`). While repos are loading, `CommandEmpty` shows `"Loading..."`.
2. The fetch resolves with zero repos and her installation's `repositorySelection === "selected"`. `isScopedEmpty(selectedInstallation?.repositorySelection, repos.length)` is true (`components/repo-picker-scope-empty-state.tsx:27-32`), so instead of a bare "no repos" message she sees: **"This installation only covers selected repositories."** plus a "Manage access" link straight to `selectedInstallation.installationUrl` (`components/repo-selector.tsx:350-366`) — she now knows exactly what to fix and where.
3. She clicks "Manage access," adds the repos she needs on GitHub's installation-settings page, returns, and re-opens the picker — repos now populate.

### Variations
- If the fetch itself fails (network/API error), `CommandEmpty` instead shows `FRIENDLY_REPOS_ERROR_COPY` ("We couldn't load your repositories.") with a Retry button (`components/repo-picker-scope-empty-state.tsx:80-93`) — never the raw `Error.message`, and distinct from the scoped-empty copy.
- If her installation is `"all"`-scope and she genuinely has zero repos, or if she types a search term that matches nothing, both collapse to the same generic **"No repositories found."** string (`components/repo-selector.tsx:367-369`) — the picker does not distinguish "you have nothing" from "your search matched nothing," unlike its sibling `github-repository-combobox.tsx`, whose equivalent fallback is phrased as **"No matching repositories found."** (search-aware wording, same underlying gap).

### Edge Cases
- **Finding**: the three-way split this component actually implements (loading / error+retry / scoped-empty+manage-access / generic) correctly separates "gated by installation scope" from everything else, but still conflates "empty because you're new" with "empty because your search matched nothing" inside that last generic bucket — the exact conflation the product elsewhere (STORY-1207, STORY-1215) is careful to avoid.

---

## STORY-1207: Automations list — three empty states that must not be confused, one of which has no working retry button

**Type**: long
**Topic**: Failure, Empty & Gated States
**Persona**: Nora, who runs `/automations` weekly to audit her team's background agents and loops.
**Goal**: Review all automations across both sources, then narrow to just the ones on a repo that's been failing.
**Preconditions**: A mix of healthy and unhealthy automation definitions across `background_agent` and `agent_loop` sources.
**Ideal path**: 3 — load the page (all automations visible), apply a filter, read the result — each step should read unambiguously.
**Alternate paths**: clear filters via the "Clear" link next to Apply instead of navigating to `/automations` directly.

### Steps
1. Nora loads `/automations` with no filters and automations exist → she sees `{response.total} automations`, each card showing kind, native status, and — if `configurationHealth === "invalid"` — a red "Needs attention" badge (`app/automations/automations-list.tsx:134-138`). This is the *healthy, populated* state; no ambiguity.
2. She filters by `repository=acme/broken-repo` and `state=failed`, and it matches zero automations. Because `activeFilters` is true, the empty section reads: **"No automations match these filters"** / **"Clear the filters or retry after the unavailable source recovers."** with a **"Clear filters"** button linking back to bare `/automations` (`app/automations/automations-list.tsx:383-406`). This is explicitly *not* the "create your first automation" copy — the code branches `filteredOrIncomplete ? "No automations match these filters" : "No automations configured"` specifically to keep the two apart.
3. She clears the filter and, on a fresh deployment with genuinely zero automations configured, would instead see **"No automations configured"** / **"Create a single-step automation to review pull requests, implement issues, or respond to webhooks."** with a **"Create automation"** button — the new-user case, never shown to Nora here because she has data.
4. Separately, if the `agent_loop` source is entirely `"failed"` (backend outage) while `background_agent` is also down, `allUnavailable` is true and Nora instead sees a red-bordered section: **"Automations could not be loaded"** / **"The definition sources are unavailable. Retry this page; no configuration was changed."** — but this section has no button at all, only prose telling her to retry the page herself (`app/automations/automations-list.tsx:372-382`).

### Variations
- A *partial* gap — one source `"disabled"` (multi-step off) while the other is fine — shows an amber notice banner instead of blocking the list: **"Multi-step automations are disabled in this deployment. Single-step automations remain available."** (`SourceNotice`, `app/automations/automations-list.tsx:75-96`), and the "Multi-step" create button in the header becomes an inert `aria-disabled` pill labeled "Multi-step unavailable" rather than a dead link.
- A source `"failed"` (not fully down, but this source specifically errored) shows: **"{Single-step|Multi-step} automations are temporarily unavailable."**

### Edge Cases
- **Finding**: step 4's "Automations could not be loaded" section tells Nora WHAT happened and reassures her WHY it's safe ("no configuration was changed"), but its WHAT-NEXT is text-only ("Retry this page") with no actual retry control — every other empty/error branch on this same page (filtered-empty, error+retry in the repo picker, learnings, leaderboard) pairs its message with a clickable action; this one doesn't, so browsers without an obvious refresh affordance (e.g. some in-app webviews) leave Nora stuck.
- The `requestId` shown next to the results heading (`Request {response.requestId.slice(0, 8)}`) is a nice touch for support escalation, but it is only rendered in the *populated* branch — not in the `allUnavailable` failure branch where an operator would most want a correlation id to hand to support.

---

## STORY-1208: A partially-invalid automation source surfaces per-item, not just as a banner

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Nora again, same weekly audit, this time on a source with a handful of malformed definitions rather than a full outage.
**Goal**: Find which specific automations are misconfigured without reading every one.
**Preconditions**: `invalidItemCount > 0` for one source (`lib/automations/store.ts:46`, `errorKind: "automation_definition_invalid"`).
**Ideal path**: 1 — scan the list, spot the flagged cards immediately.
**Alternate paths**: none found — there's no dedicated "show only invalid" filter; she has to scan.

### Steps
1. The page-level amber notice reads: **"{Single-step|Multi-step} automations include {invalidItemCount} configuration{s} that could not be fully read."** (`SourceNotice`, `app/automations/automations-list.tsx:85-95`) — Nora now knows *some* items are broken, but not which.
2. Scrolling the list, each affected automation's own card carries a red **"Needs attention"** pill next to its status badge (`configurationHealth === "invalid"` → `app/automations/automations-list.tsx:134-138`) — she can now scan visually instead of opening every card.
3. She opens one flagged card's detail/edit view to see the specific validation problem (not exercised here — outside this component).

### Variations
- If zero items are invalid, no banner and no pills render — the healthy path from STORY-1207 step 1.

### Edge Cases
- The banner gives a count but not identity; the per-card badge gives identity but not the reason. Nora has to open each flagged card to learn *why* it's invalid — reasonable for a handful of items, would not scale to dozens.

---

## STORY-1209: Archived-session lockout explains itself, but its own way out isn't in reach

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: Ravi, who archived a session last week and now wants to reopen it via a link a teammate sent.
**Goal**: Send one more message to resume the conversation.
**Preconditions**: `session.status === "archived"`.
**Ideal path**: 2 — read the disabled-state explanation, then act on it — but the action isn't where the explanation is.
**Alternate paths**: switch to the sidebar and unarchive from there without ever hovering the composer.

### Steps
1. Ravi opens the archived session's chat. The composer textarea and attach-files button are `disabled={isArchived}` (`session-chat-content.tsx:4927`, `:4941`), and a blurred overlay sits over the whole input area: **"This session is archived. Unarchive it to resume."** (`SandboxInputOverlay`, `session-chat-content.tsx:1042-1054`). Every mutating control — send, resend, delete message, voice recording, dev server tools — carries the same `isArchived` guard (`session-chat-content.tsx:4997`, `:5016`, `:5064`, `:5134`, `:5212`).
2. He tries to click into the message box — nothing happens, it's disabled; the overlay text told him what to do ("Unarchive it to resume") but the overlay itself has no button.
3. To actually unarchive, Ravi has to go to the left sidebar, find the session in `components/inbox-sidebar.tsx`, and use its per-session "Unarchive session" action (`inbox-sidebar.tsx:464`, `:481`) — a different panel from the one that told him what to do.
4. Once unarchived, the overlay disappears and every control re-enables.

### Variations
- If the archive is still mid-transition (a sandbox pause was in flight when archiving started), the overlay instead reads: **"Sandbox pause in progress. Unarchive will be available in a few seconds."** (`session-chat-content.tsx:1048-1049`) — correctly distinguishes "you can't unarchive yet" from "you can unarchive now," which matters because clicking Unarchive before the pause finishes would otherwise race the archive operation.
- Sandbox tools specifically get their own reason string, `"Archived sessions cannot run sandbox tools."` (`runtimeToolsDisabledReason`, `session-chat-content.tsx:3620-3621`), separate from the composer's overlay text — both correct, but two different strings for what reads to the user as one state.

### Edge Cases
- **Finding**: the lockout correctly tells Ravi WHAT (every control disabled) and WHY (archived) and even WHAT TO DO ("unarchive it"), but the control that does that is not co-located with the message — he has to already know sessions have a sidebar-level archive toggle. A first-time user hitting an archived session cold has no guarantee they'll find it.

---

## STORY-1210: The MCP run lock is the lockout done right — reason, scope, and a guarded escape hatch

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Ellen, whose CI pipeline runs an MCP-driven agent against her session, and who opens the browser mid-run out of curiosity.
**Goal**: Understand why she can't type in the composer, and take control if she needs to.
**Preconditions**: `activeRunSource === "mcp"` and the run is currently streaming (`shouldLockComposer`, `session-chat-mcp-run-lock.tsx:24-34`).
**Ideal path**: 2 — read the lock notice, decide, confirm if taking over.
**Alternate paths**: leave the tab and let the MCP run finish on its own, never taking over.

### Steps
1. Ellen opens the session. The composer is locked (`disabled={isArchived || composerLock.locked}`, `session-chat-content.tsx:4927`) and an amber notice explains, in place, right where she'd expect to type: **"This session is being driven by an MCP client" / "A remote agent is waiting on this run. The composer is disabled until you take over."** with a "Take over" button (`McpRunLockNotice`, `session-chat-mcp-run-lock.tsx:69-137`).
2. She clicks "Take over." The notice switches to a confirmation state — icon changes to a warning triangle, copy becomes: **"This is a remote agent's run." / "Taking over will steer or interrupt the run another client started and is waiting on. Are you sure?"** with "Cancel" and a destructive-styled "Take over" (`session-chat-mcp-run-lock.tsx:98-107`, `:121-133`).
3. She confirms → `onTakeOver()` fires, `takenOver` flips true, `shouldLockComposer` now returns false, and the composer unlocks for her to type.
4. If instead the MCP run ends naturally while she's looking, `useMcpComposerLock`'s effect resets `takenOver` to false the moment `runIsLiveMcp` goes false (`session-chat-mcp-run-lock.tsx:52-56`) — the lock re-arms cleanly for the *next* headless run rather than leaking a stale "already taken over" state.

### Variations
- If Ellen never clicks "Take over," the composer simply stays locked until the MCP run ends on its own, with no ambiguity about who's driving.

### Edge Cases
- Unlike STORY-1209's archived lockout, every part of this lockout — the reason, the risk warning, and the resolving action — lives in one place, at the point of friction. **Finding**: this is the reference pattern the archived-session overlay (STORY-1209) should have followed.

---

## STORY-1211: The admin gate distinguishes "you're not an admin" from "we couldn't check"

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: Sam, a real workspace admin, whose auth check happens to fail transiently (e.g. a slow `/api/auth/info` call) right as he opens `/settings/admin`.
**Goal**: Reach the danger-zone token-revocation tools he uses occasionally.
**Preconditions**: Sam is genuinely `isAdmin: true`, but the client-side session check errors on this particular load.
**Ideal path**: 1 — a transient check failure should never look like a permissions denial to someone who actually has the permission.
**Alternate paths**: refresh the page, which re-runs the check and (assuming the transient failure clears) succeeds.

### Steps
1. Sam opens `/settings/admin`. `AdminContent` calls `useSession()`, gets `{ isAdmin, loading, isError, retry }`.
2. While `loading` is true, nothing renders (`admin-content.tsx:161-163`) — no flash of either the tools or the gate.
3. The auth check errors. Per the comment at `admin-content.tsx:165-166` — *"a failed auth check is not 'you are not an admin'. Showing the access gate here would tell a real admin they lost their access"* — the component does NOT fall through to `AdminAccessGate`. It renders `AuthCtaError` instead: **"We couldn't verify your admin access."** with a "Try again" link that calls `retry` (`components/auth/auth-cta-error.tsx`).
4. Sam clicks "Try again," the check succeeds this time, and `AdminPageContent` (the real danger-zone UI: revoke GitHub tokens, revoke Vercel tokens) renders.

### Variations
- If Sam were genuinely not an admin, the same component renders `AdminAccessGate` instead — a different, calmer message ("This area is for workspace admins... that's expected for most people") that never implies something is broken (STORY-1205 covers that gate directly).

### Edge Cases
- This is the same `isError`-vs-`!isAdmin` discipline the top-level auth nuance (STORY-1212) requires globally, applied specifically to a gate whose failure mode (falsely telling an admin they lost access) would be actively alarming rather than just inconvenient.

---

## STORY-1212: A transient auth hiccup must not sign the user out from under them

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: Grace, on a flaky hotel wifi, mid-way through reviewing a diff when one background SWR request briefly fails.
**Goal**: Keep working without being kicked back to the landing page over a blip.
**Preconditions**: An authenticated SWR-backed view already has cached data rendered; a subsequent request errors.
**Ideal path**: 1 — the app should distinguish "this one request failed" from "you are logged out," and only act on the latter.
**Alternate paths**: none found — this is a passive background behavior, not something Grace triggers directly.

### Steps
1. Grace is on `/sessions/.../chats/...` with data already loaded from earlier successful fetches (cached in SWR).
2. One background request on a flaky connection fails with a network error, a 500, or a 403 — anything that isn't specifically "401 + message 'Not authenticated.'"
3. `Providers`' `SWRConfig` `onError` handler (`app/providers.tsx:109-131`) checks `error instanceof FetchError && error.status === 401 && error.message === "Not authenticated"` (`FetchError` from `lib/swr.ts`). This condition is false for Grace's failure, so `handleError` does nothing — no sign-out, no redirect, no unmount. Her already-rendered UI and cached data stay exactly as they were; the failed request just leaves that one piece of data stale until the next successful revalidation.
4. Wifi recovers, the next SWR revalidation succeeds, and everything catches up silently — Grace never noticed.

### Variations
- If instead the request genuinely fails with 401 and the exact message `"Not authenticated"` (a real session expiry), the same handler sets `signingOut.current = true`, calls `authClient.signOut()`, and on completion (success or failure) does `router.replace("/")` + `router.refresh()` — the one case where unmounting authenticated UI is correct.
- The `signingOut` ref guards against re-entrancy: if multiple 401s land in a burst, only the first drives the sign-out flow.

### Edge Cases
- **Finding**: the gate is a strict string-and-status match (`status === 401 && message === "Not authenticated"`), not just `status === 401` — a 401 with a different message (e.g. a route-specific "unauthorized" body that doesn't use that exact copy) would NOT trigger sign-out under this check. That's the safe direction to fail (never signs out too eagerly), but it does mean some legitimately-expired-session 401s from routes with different copy would leave Grace looking authenticated in the UI while individual requests keep failing behind the scenes, with nothing telling her to re-authenticate.

---

## STORY-1213: `retry-after` is computed correctly on the server and then never read on the client

**Type**: long
**Topic**: Failure, Empty & Gated States
**Persona**: Wen, iterating quickly on a new skill, clicking "Generate with AI" several times in under a minute while tuning her prompt.
**Goal**: Get an AI-drafted skill body she likes.
**Preconditions**: Wen's requests to `/api/settings/skills/generate` cross the configured rate-limit threshold.
**Ideal path**: 1 — she should be told exactly how long to wait so her next click succeeds instead of failing again.
**Alternate paths**: wait an arbitrary amount of time and retry blind, or give up and edit the skill body by hand.

### Steps
1. Wen clicks "Generate with AI" one too many times. The server's `checkRateLimit` trips: `rateLimitResponse(retryAfterMs)` computes `retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))` and returns `apiError("rate_limited", "Too many requests", { retryAfterSeconds })` (`lib/rate-limit.ts:81-85`), which sets both a JSON body field `retryAfterSeconds` **and** a `Retry-After` HTTP header (`lib/api/error-response.ts:79-93`) — the server did its job correctly and precisely.
2. The client's `handleGenerate` in `skill-editor-dialog.tsx` reads the response: `!response.ok` → `toast.error(readApiError(data, "Couldn't generate a draft. Try again.").message)` (`skill-editor-dialog.tsx:118-121`). `readApiError` does parse `retryAfterSeconds` off the body (`lib/api/read-api-error.ts:60`, `:69-73`) — the field survives the round trip — but `handleGenerate` only ever reads `.message` off the result, discarding `.retryAfterSeconds` entirely.
3. Wen sees a toast: **"Too many requests."** No countdown, no "try again in N seconds," nothing distinguishing this from any other failure. She has no information to act on.
4. She waits a guess amount of time (or none) and clicks again. If she guessed short, she's rate-limited again with the identical toast.

### Variations
- The same gap applies to every other route that shares `checkRateLimit`: `/api/sessions` (session creation), `/api/generate-pr`, `/api/generate-title`, `/api/github/repos`, `/api/sandbox`, `/api/sandbox/extend`, `/api/sessions/[sessionId]/checks/fix`, `/api/sessions/[sessionId]/generate-commit-message`, and `/api/transcribe` — confirmed by grep, no `.tsx` file anywhere in the app reads `retryAfterSeconds` from a parsed error body outside of tests.
- The `Retry-After` HTTP header is also set correctly and also unread — no client fetch wrapper in the app inspects response headers on error paths, only the JSON body via `readApiError`.

### Edge Cases
- **Finding**: this is a fully-built, unused affordance — `ApiErrorBody.retryAfterSeconds` and `ReadApiErrorResult.retryAfterSeconds` both exist, are correctly populated end to end, and are dropped at the very last step (every call site reads `.message` and discards the rest). The fix is UI-only: no server or contract change needed, just surfacing a field that's already there.

---

## STORY-1214: A Redis outage in production turns "create a session" into a confusing 503

**Type**: medium
**Topic**: Failure, Empty & Gated States
**Persona**: an on-call engineer, Yusuf, trying to spin up a session to investigate an incident, during the same infra blip that's causing the incident (Redis is unreachable).
**Goal**: Create a new session against the affected repo to start debugging.
**Preconditions**: `NODE_ENV === "production"`, Redis is down or the connection times out, and `checkRateLimit` is invoked on a request Yusuf makes (session creation, PR/commit-message generation, transcription, or skill generation all share this path).
**Ideal path**: 1 — the message should tell him the real cause (infra dependency down) so he doesn't waste time thinking he personally hit a rate limit.
**Alternate paths**: none found — every route behind `checkRateLimit` fails the same way when Redis is unreachable; there's no bypass.

### Steps
1. Yusuf's request reaches a route guarded by `checkRateLimit`. `getSharedRedisClient()` either returns `null` (no `REDIS_URL` configured) or the Redis operation throws inside `withTimeout` (`lib/rate-limit.ts:143-152`).
2. Because `process.env.NODE_ENV === "production"`, `rateLimitUnavailableResponse()` does NOT fail open — it returns `apiError("upstream_unavailable", "Rate limit unavailable", { headers: { "Retry-After": "30" } })` (`lib/rate-limit.ts:125-133`). Note: unlike the direct rate-limit-tripped case, this path does not set `retryAfterSeconds` in the JSON body, only the raw header — so even if a future client read `retryAfterSeconds` from the body (fixing STORY-1213), this specific failure mode still wouldn't carry it there.
3. Yusuf's client-side code surfaces whatever generic error-toast pattern that route uses, showing **"Rate limit unavailable"** — worded as if a rate limit is the problem, when the actual cause is an unrelated infrastructure dependency being down. Nothing in the message says "Redis," "infrastructure," or "not you."
4. Session creation (and every other route sharing this guard) is unavailable for as long as Redis stays unreachable — this is a deliberate fail-closed design (rate limiting must not silently disable itself in production), but the user-facing wording doesn't communicate that trade-off.

### Variations
- In non-production environments, the same Redis failure fails open (`rateLimitUnavailableResponse` returns `null` when `NODE_ENV !== "production"`, `lib/rate-limit.ts:126-128`) — local/dev/preview users never see this at all, which also means this failure mode gets essentially no exercise before it hits production.

### Edge Cases
- **Finding**: "Rate limit unavailable" is accurate to the internal mechanism (the rate limiter, specifically, is what's unavailable) but misleading to a user reading it as "you are being rate limited" — the two are opposite failure modes (too many requests vs. the limiter itself being broken) sharing confusingly similar wording, and only the `errorKind` (`upstream_unavailable` vs `rate_limited`) actually distinguishes them, which no UI surfaces to the human.

---

## STORY-1215: The leaderboard's two empty reasons — a template for gated-vs-new done right

**Type**: short
**Topic**: Failure, Empty & Gated States
**Persona**: Two people on the same team: Lin (personal Gmail account, no work-email domain) and her teammate Omar (work email, but week one of using the product).
**Goal**: Both want to see how they and their team stack up on agent usage.
**Preconditions**: Lin's account has no eligible work-email domain; Omar's domain is eligible but nobody on the team has usage yet.
**Ideal path**: 1 each — the two very different reasons for "empty" should read as different messages, not the same "no data" shrug.
**Alternate paths**: Lin re-signs-in with a work account to become eligible; Omar just waits for usage to accrue — neither path is a CTA the component offers, by design.

### Steps
1. Lin opens the leaderboard. `LeaderboardEmptyState` is given `reason="no-domain"` and renders: **"No leaderboard yet"** / **"Leaderboards are grouped by work email domain. Sign in with your work account to join your team's board."** (`app/settings/leaderboard-empty-state.tsx:23-24`) — no button, because the fix (switching accounts) isn't a click-in-place action, and the code's own comment explains the omission is deliberate: *"the user has no eligible work-email domain (no misleading CTA)"*.
2. Omar opens the same page. `LeaderboardEmptyState` is given `reason="no-data"` and renders the same title but different body: **"The leaderboard ranks people in your workspace by agent usage. As you and your teammates run agents, you'll show up here."** — also no button, because there's nothing to click; usage has to accrue.

### Variations
- Both states share the same `Trophy` icon and `"No leaderboard yet"` title deliberately (both really are "nothing to show yet"), but the *description* is the one thing that carries the WHY, and it never conflates "you personally are excluded" with "nobody has data yet."

### Edge Cases
- **Finding**: this is the cleanest "empty because gated" vs. "empty because new" split found anywhere in this pass — contrast with STORY-1206's repo picker, which still conflates "you have zero repos" with "your search matched none" in its generic fallback string.

---

## STORY-1216: A background agent can be fully configured and permanently silent if `BACKGROUND_AGENTS_ENABLED` is off — with no user-facing signal at the point of failure

**Type**: long
**Topic**: Failure, Empty & Gated States
**Persona**: Priya (different session from STORY-1201), setting up her first background agent to auto-review PRs on a repo, on a deployment where the platform operator has not yet flipped `BACKGROUND_AGENTS_ENABLED=true`.
**Goal**: Configure a background agent that reviews every new PR on her repo.
**Preconditions**: `BACKGROUND_AGENTS_ENABLED` is unset or `"false"` in the deployment's environment; Priya has no reason to know this.
**Ideal path**: 1 — the moment she saves a trigger that will never fire, something should tell her so, at the point where she's configuring it.
**Alternate paths**: she happens to notice the readiness panel on the same builder page and reads it correctly (covered in Variations) — the one path where she does find out.

### Steps
1. Priya goes through `/repos/[owner]/[repo]/agents/new`, fills in instructions, model, tool allowlist, and a `pull_request` trigger, and saves. Nothing in `new-agent-builder.tsx`'s save path checks `BACKGROUND_AGENTS_ENABLED` — the flag only gates the *dispatch* layer (`lib/background-agents/dispatcher.ts:209`, `:362`, `:609`, `:804`, and `lib/background-agents/executor.ts:665`), not agent creation or editing.
2. The agent saves successfully, shows as configured with triggers enabled in the UI, exactly like a fully working agent.
3. A PR opens on her repo. The webhook reaches `dispatchBackgroundTriggerEvent`, which checks `isBackgroundAgentsEnabled()` first thing and, since it's false, returns `{ enabled: false, matched: 0, created: 0, duplicates: 0, runIds: [], loopRunIds: [] }` (`lib/background-agents/dispatcher.ts:209-218`) — no run is created, no error is logged anywhere Priya can see, no notification fires. From her side, absolutely nothing happens; there is no "run" to look at because a run object was never created.
4. Priya waits, assumes the agent is just slow or the trigger conditions weren't met, and has no path to discover the real cause from the run list (`/runs`) because there's no run to inspect — the failure happened before a run record could exist.

### Variations
- The one place this flag's state IS visible to Priya: the same `new-agent-builder.tsx` page renders a `ReadinessVerdict` panel (`new-agent-builder.tsx:9`, `:69-85`) sourced from `getBackgroundAgentReadiness()`, whose `feature_flag` check reports `status: "disabled"` with `detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch."` when the flag is off (`lib/background-agents/readiness.ts:89-96`) — if she scrolls to and reads that panel *before* saving, she'd see it. But nothing forces her to; the save button is not gated on readiness being green, and the panel's language ("gates trigger dispatch") assumes operator vocabulary a first-time non-admin user configuring her own agent may not parse as "this will never run."
- Compare to STORY-1205's loops flag: at least `/loops/new` visibly blocks the creation UI with "Loops are disabled" text when its flag is off. Background agents' creation flow has no equivalent hard stop — it lets you build something that will never execute.

### Edge Cases
- **Finding**: this is the quietest gate in the app. Every other flag/gate story in this file (GTM's 404, loops' env-var text, the admin gate, the archived-session overlay, the MCP lock) tells the user something, even if imperfectly. This one tells the user nothing at the moment of the actual failure (trigger dispatch) and something easy to miss, phrased for operators, at a moment before failure (the readiness panel) that isn't enforced as a precondition for saving.
