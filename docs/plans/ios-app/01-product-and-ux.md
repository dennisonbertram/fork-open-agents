# 01 — Product & UX Specification

Part of the iOS app build plan. Siblings: `00-overview.md`, `02-api-contract-and-networking.md`, `03-architecture.md`, `04-auth.md`, `05-streaming-chat-engine.md`, `06-testing-strategy.md`, `07-observability.md`, `08-ci-cd-release.md`, `09-step-by-step-build-guide.md`.

Sources of truth: `docs/plans/ios-app/research/09-web-ux-inventory.md` (feature inventory, UX lessons), `docs/plans/ios-app/research/26-design-research.md` (design system, pillars, signature interactions), `docs/plans/ios-app/research/04-api-settings-usage-misc.md` (settings/usage/sharing APIs). API paths verified against `apps/web/app/api/*` on 2026-06-10.

Canonical stack (restated, decided elsewhere — never re-decide): Xcode 26.x, Swift 6.2 strict concurrency, SwiftUI-only with `@Observable` MVVM, minimum iOS 26.0 / iPadOS 26.0 (native Liquid Glass), GRDB persistence, XcodeGen, swift-openapi-generator 1.12.2, Swift Testing, swift-snapshot-testing 1.18.x, thin XCUITest smoke suite, GitHub Actions `macos-26`, TestFlight via App Store Connect API keys.

---

## 1. Product definition and v1 scope

Open Agents for iOS is a **companion client for running and supervising coding agents**: start work on a repo, watch the agent stream, unblock it (answer questions, approve edits), review diffs, and ship the PR — from a phone or iPad. The web app remains the authoring/operator console for power configuration.

The design's center of gravity is the streamed agent run — the web product review called it "the single best-loved surface" (`09-web-ux-inventory.md` §A3). iOS must make it *better* than the web, not merely present.

### 1.1 v1 scope table

| Area | In v1 | Out of v1 (stays on web; link out) |
|---|---|---|
| Auth | Sign in with Apple + Continue with Vercel (`ASWebAuthenticationSession`, bearer plugin — see `04-auth.md`); GitHub connect/reconnect; sign out; account deletion | Admin token revocation |
| Sessions | Inbox (Active/Archive, repo-grouped), create (New Chat / Start Session, repo+branch+title), rename, archive/unarchive | Per-session Vercel project sync selection (use server default) |
| Chat | Streaming transcript, resume after backgrounding, stop, attachments (photo/camera/paste-as-file), voice dictation, AskUserQuestion morph, edit-approval Approve/Deny, model picker, tool-call cards, cost/duration badges, fork, share links | Slash commands, `@` file mentions, snippet comments, multi-chat tab strip beyond switcher, skills toggles, Composio profile selection (shown read-only), workflow picker (server catalog is all-disabled today) |
| Git | File tree + read-only file viewer, unified diff (live + cached), commit & push with AI message, branch guard, PR create/status/checks/merge (squash/merge/rebase), Fix errors / Fix conflicts hand-off | Split diffs on iPhone, discard hunks, `.diff` download, force-merge |
| Sandbox | Lifecycle status surface, one-tap Resume, extend | Dev-server start/stop, browser checks, runtime inspector, code-server (`/codespace`) |
| Background agents | Run feed, run detail (proof grid + timeline + outputs), agent enable/disable toggle, manual Test dispatch | Agent authoring/editing (cron, conditions, instructions) |
| Settings | Profile, Preferences subset, Connections, Models (default model), Usage, Notifications, Delete account | Composio/skills/runtime-profile/model-variant/inference-profile authoring, leaderboard, admin |
| Net-new mobile | Push notifications, Live Activity for in-flight runs, share-sheet export, universal links, biometric app lock, offline reading | Widgets, App Intents/Siri (v1.1 candidates) |

Rationale for the split: `09-web-ux-inventory.md` §C (desktop-ish vs mobile-shining flows). Verified Build is out of v1 entirely; its plan-approval push is a v1.5 candidate.

---

## 2. Information architecture and navigation

### 2.1 iPhone: four labeled tabs

`TabView` with text labels (never icon-only — Linear lesson, `26-design-research.md` §4.4). Order and symbols are fixed:

| # | Tab | SF Symbol | Root screen |
|---|---|---|---|
| 1 | Sessions | `bubble.left.and.bubble.right` | SCR-10 Sessions Inbox |
| 2 | Repos | `folder` | SCR-20 Repos List |
| 3 | Agents | `sparkles` | SCR-30 Agents Home |
| 4 | Settings | `gearshape` | SCR-40 Settings Root |

- Selected state uses the `.fill` symbol variant. Tint `AccentPrimary`.
- `tabBarMinimizeBehavior(.onScrollDown)` enabled on the Sessions stack only (long transcripts shrink chrome; the composer never minimizes).
- Search is bottom-aligned `searchable` on the Sessions stack (Slack thumb-zone lesson).
- The **live-run status strip** (S2 "Heartbeat", §9) renders as a `TabViewBottomAccessory` above the tab bar whenever any chat is streaming and the user is not viewing it. It is the cross-tab connective tissue.

### 2.2 Navigation stacks (screen graph)

| From | Push/present | To |
|---|---|---|
| SCR-10 Sessions Inbox | push | SCR-12 Chat Workspace |
| SCR-10 | sheet | SCR-11 New Session |
| SCR-12 | sheet (full-height, compact) / inspector (regular) | SCR-16 Git Panel |
| SCR-12 | sheet | SCR-13 Session Info & Chat Switcher |
| SCR-12 | sheet | SCR-14 Model Picker |
| SCR-12 | sheet | SCR-15 Run Options |
| SCR-12 | sheet | SCR-17 Share Link |
| SCR-16a Files | push (within panel) | SCR-16b File Viewer |
| SCR-20 Repos | push | SCR-21 Repo Detail |
| SCR-21 | push | SCR-12 (existing session) or sheet SCR-11 (prefilled repo) |
| SCR-30 Agents Home | push | SCR-31 Background Run Detail |
| SCR-30 | push | SCR-32 Background Agent Detail |
| SCR-40 Settings | push | SCR-41…SCR-46 |
| SCR-41 Profile | push | SCR-47 Delete Account |
| (deep link, any state) | full-screen | SCR-50 Shared Chat Viewer |
| (deep link, signed out) | full-screen | SCR-51 Sign-in Gate |

### 2.3 iPad: `NavigationSplitView` (two columns)

- Sidebar = Sessions Inbox (SCR-10). Detail = Chat Workspace (SCR-12). Style `.balanced`, `columnVisibility` bound to state.
- The Git Panel (SCR-16) is a **trailing inspector** inside the detail column at regular width (`.inspector(isPresented:)`, default width 420pt), not a third navigation column.
- Repos/Agents/Settings tabs keep the same `TabView` root; on iPadOS 26 `TabView` adapts to the sidebar representation automatically.
- **Branch on `horizontalSizeClass` only — never `UIDevice` idiom.** iPadOS 26 free-form windows make compact width on iPad the common case; every screen must work at iPhone width.
- Menu-bar commands declared via the SwiftUI `Commands` API (one declaration feeds the iPad menu bar and the hold-Cmd HUD). Shortcut table in §6.2.

### 2.4 Deep links and universal links

Universal links (associated domain = the deployed web host) and the custom scheme `openagents://` (auth callback only, per `04-auth.md`):

| URL path | Opens | Signed-out behavior |
|---|---|---|
| `/shared/{shareId}` | SCR-50 Shared Chat Viewer | Opens anyway (public endpoint — no auth needed) |
| `/sessions/{sessionId}/chats/{chatId}` | SCR-12 | SCR-51 gate, destination preserved |
| `/sessions/{sessionId}` | SCR-12 (first chat) | SCR-51 gate, destination preserved |
| `/background-runs/{runId}` | SCR-31 | SCR-51 gate, destination preserved |
| `/{owner}/{repo}` (two path segments, not a reserved word) | SCR-11 prefilled with that repo | SCR-51 gate, destination preserved |

Rule (UX lesson B12): a signed-out deep link must **never** silently bounce; it always shows SCR-51 with the destination preserved and restored after sign-in.

---

## 3. Design system

The full rationale lives in `26-design-research.md`. This section restates the binding rules so a weak model can apply them without reading the research. All tokens live in `ios/Packages/OpenAgentsDesignSystem`; feature code references tokens by name only.

### 3.1 Pillars (PR checklist lines)

| Pillar | Rule | Grep-able don'ts |
|---|---|---|
| **P1 Content opaque, chrome glass** | Glass only on surfaces in the §3.5 map; content layer stays opaque | No `.glassEffect` on bubbles/tool rows/code blocks/cards/cells; no `.ultraThinMaterial` fake glass; no custom toolbar backgrounds; never glass over glass |
| **P2 The stream is sacred** | Only the in-flight message mutates; UI updates coalesced at 50–100 ms; one alive-indicator on screen; pin-to-bottom per §5.3 | No animated text appends; no per-token haptics; no auto-scroll while user is scrolled up; earlier rows never change height mid-stream |
| **P3 One hand on iPhone, two modes on iPad** | Composer, send/stop, jump pill, search in the bottom half; layouts branch on `horizontalSizeClass` | No primary actions only in the top toolbar; no `UIDevice` idiom checks |
| **P4 The system is the design system** | Text styles only; semantic colors + the §3.2 tokens only; SF Symbols only; standard `List`/`Form`/`NavigationSplitView` | No custom fonts; no hex outside `Colors.xcassets`; no `Font.system(size:)` outside the token file; no custom nav/tab implementations |
| **P5 Status is always honest** | Every async op shows pending → running → success/error with the §5.4 status model; errors auto-expand; color always paired with glyph + word | No unlabeled spinners; no optimistic success; no silently swallowed failures |
| **P6 Restraint is the brand** | One accent; two haptics per run; zero decoration | No gradients/confetti/mascots; no haptics outside §3.7; no sounds outside notification settings |

### 3.2 Color tokens (the only custom colors in the app)

Twelve asset-catalog color sets in `ios/Packages/OpenAgentsDesignSystem/Sources/OpenAgentsDesignSystem/Resources/Colors.xcassets`, exposed as `Color.oa*` statics. Everything else is system semantic color (`Color.primary`/`.secondary`, `UIColor.systemBackground` family, `UIColor.separator`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `AccentPrimary` | `#5856D6` | `#5E5CE6` | Tint, links, send button, selected states, caret |
| `StatusRunning` | `#007AFF` | `#0A84FF` | Spinners, running dots, live strip |
| `StatusSuccess` | `#34C759` | `#30D158` | Checkmarks, success badges |
| `StatusWarning` | `#FF9500` | `#FF9F0A` | Degraded sandbox, expiring auth, cached-data banners |
| `StatusError` | `#FF3B30` | `#FF453A` | Failures, stop button, destructive |
| `CodeBackground` | `#F6F6F8` | `#1C1C1E` | Code blocks, stdout, diff base |
| `CodeBorder` | `#E3E3E8` | `#3A3A3C` | 0.5pt code/diff hairline |
| `DiffAddedBg` | `#E6F4EA` | `#0F2E1A` | Added-line background |
| `DiffRemovedBg` | `#FCEBEA` | `#3A1212` | Removed-line background |
| `DiffAddedAccent` | `#1A7F37` | `#3FB950` | `+` gutter glyphs, intraline added spans |
| `DiffRemovedAccent` | `#CF222E` | `#F85149` | `-` gutter glyphs, intraline removed spans |
| `BubbleUser` | `#ECECF4` | `#2C2C2E` | User bubble fill (assistant messages have **no** bubble) |

Every token must pass WCAG AA (4.5:1 body, 3:1 large) against its documented background in both modes — enforced by a unit test in the DesignSystem package (`06-testing-strategy.md`). Dark values for diff tokens are starting proposals; tune values, keep names.

### 3.3 Typography tokens

SF Pro via text styles only; SF Mono via `design: .monospaced`. No point sizes in feature code.

| Token | Definition | Use |
|---|---|---|
| `Type.screenTitle` | `.largeTitle` | Navigation large titles only |
| `Type.sessionTitle` | `.headline` | Session titles in lists, message sender line |
| `Type.message` | `.body` | Message text, form rows |
| `Type.toolRow` | `.callout` | Tool-call row titles |
| `Type.code` | `Font.system(.callout, design: .monospaced)` | Code, diffs, logs, paths, SHAs, branch names |
| `Type.metadata` | `.subheadline` + `.secondary` | Repo/branch metadata |
| `Type.timestamp` | `.footnote` + `.secondary` | Timestamps, tool summaries |
| `Type.badge` | `.caption`; cost/duration `.caption2.monospacedDigit()` | Pills, chips, badges |

`.monospacedDigit()` is mandatory on every in-place-updating numeral (elapsed timers, token/cost counters).

### 3.4 Spacing and metrics tokens

| Token | Value | Use |
|---|---|---|
| `OASpacing.xs/sm/md/lg/xl` | 4 / 8 / 12 / 16 / 24 | Only spacing values allowed in feature code |
| `OARadius.chip` | 8 | Attachment/suggestion chips, badges |
| `OARadius.block` | 8 | Code blocks, diff containers |
| `OARadius.card` | 12 | Tool rows, status cards, empty-state cards |
| `OARadius.bubble` | 18 | User bubbles (`.continuous` corners) |
| `OARadius.composer` | 24 | Composer glass container |
| `MinHit` | 44×44 pt | Every tappable; enforce with padded `.contentShape(Rectangle())` |
| Hairline | 0.5 pt | All borders |
| Transcript measure | ≤ 672 pt | Max text column on iPad regular width; center beyond |
| Tool row min height | 44 pt | Collapsed state |
| Status strip height | 48 pt | S2 accessory |

### 3.5 Liquid Glass usage map (exhaustive)

| Surface | Treatment |
|---|---|
| Tab bar, nav/toolbars, sheet chrome, alerts, context menus | System glass — automatic; do not touch |
| Composer container (field + attach + mic + send) | Custom glass: one `GlassEffectContainer`, `.glassEffect(.regular, in: .rect(cornerRadius: 24))`; morph host for S3 |
| Live-run status strip | Glass (system `TabViewBottomAccessory` styling) |
| Jump-to-now pill | Glass capsule, `.interactive()` |
| Stop button during a run | Glass capsule, `StatusError` tint — the app's **only** tinted glass |
| Transcript, message text, user bubbles | Opaque (`systemBackground` / `BubbleUser`) |
| Tool rows, tool-summary bar | Opaque (`secondarySystemBackground`) |
| Code blocks, stdout, diffs | Opaque (`CodeBackground`) |
| Inbox rows, repo dashboards, settings forms, onboarding | Opaque (system grouped backgrounds) |
| Empty-state suggestion chips | Opaque `secondarySystemBackground` capsules |

Rules: never stack glass on glass; adjacent custom glass shares one `GlassEffectContainer`; prefer `.regular` everywhere (the transcript is dense text — worst case for `.clear`); morphs use `glassEffectID(_:in:)` with a shared `@Namespace`; never fake glass with blur (Reduce Transparency support comes free only via system APIs).

### 3.6 Dark mode

- Design dark-first, verify light. The system semantic backgrounds encode base-vs-elevated automatically (dark base `#000000`, elevations `#1C1C1E`/`#2C2C2E`).
- Cards/panels separate by elevation (`secondarySystemBackground`), not borders, in dark mode.
- Syntax-highlight themes are two custom themes (light/dark) tied to §3.2 tokens — never a stock highlight.js theme.
- Snapshot tests record every DesignSystem component in both modes.

### 3.7 Haptics map (exhaustive — anything unlisted gets none)

Only API: SwiftUI `.sensoryFeedback(_:trigger:)`.

| Event | Feedback |
|---|---|
| Message sent | `.impact(weight: .light)` |
| Agent run completed successfully | `.success` (once, on terminal stream event) |
| Agent run failed / stream error | `.error` |
| Destructive confirm presented (archive, discard, close chat, delete account) | `.warning` on presentation, not the act |
| Stop button engaged | `.stop` |
| Blocking request arrives (AskUserQuestion or edit-approval — composer/card morph) | `.impact(weight: .medium)` |
| Pull-to-refresh trigger, picker detents | `.selection` |

Forbidden: haptics per token, per tool-call transition, on scroll, or without a visible state change. A multi-tool run produces exactly two haptics: send and completion.

### 3.8 Motion rules

Springs only; presets per event. Anything not in this table uses untouched system transitions.

| Event | Animation | Notes |
|---|---|---|
| Send message (S1) | `.bouncy(duration: 0.35, extraBounce: 0.1)` | The only bouncy spring in the app |
| Tool row expand/collapse | `.snappy(duration: 0.2)` | Chevron rotates 90° in the same spring |
| Tool group collapse | `.smooth(duration: 0.3)` | |
| Run-completion fold-in (S4) | `.smooth(duration: 0.3)` | One grouped settle |
| Jump-to-now pill in/out (S5) | `.snappy(duration: 0.2)`, scale 0.9→1.0 + opacity | |
| Scroll-to-bottom on pill tap | `.smooth(duration: 0.3)` | No animation under Reduce Motion |
| Composer ↔ question morph (S3) | System glass morph via `glassEffectID` | Chips stagger `.snappy(duration: 0.2)`, 40 ms apart |
| Status-strip pulse (S2) | `easeInOut` 0.8 Hz, opacity 1.0↔0.4, `.repeatForever` | Static under Reduce Motion |
| Streaming caret blink | `easeInOut(duration: 0.6)` autoreversing | Allowed under Reduce Motion (sub-1 Hz opacity) |
| Shimmer placeholder | `TimelineView` gradient sweep, 1.2 s period | Static fill under Reduce Motion |
| Copy-button checkmark swap | `.snappy(duration: 0.2)`, `contentTransition(.symbolEffect(.replace))` | Reverts after 1.5 s |
| Skeleton → content | `.opacity` crossfade 0.2 s | Never slide |
| Streaming text append | **none** | P2 |

Reduce Motion (`@Environment(\.accessibilityReduceMotion)`): movement transitions become `.opacity` crossfades; S1 travel dropped; S2 pulse static; springs replaced with short `easeInOut`.

### 3.9 Iconography

SF Symbols only; monochrome default; fills mark selection. Fixed vocabulary (extend only via design review): sessions `bubble.left.and.bubble.right` · repos `folder` · agents `sparkles` · settings `gearshape` · tool-read `doc.text` · tool-edit `pencil` · tool-write `doc.badge.plus` · tool-shell `terminal` · tool-fetch `globe` · tool-task `person.2` · commit `arrow.triangle.branch` *(verify in SF Symbols app; fallback `arrow.branch`)* · PR `arrow.triangle.pull` · diff `plus.forwardslash.minus` · success `checkmark.circle.fill` · error `xmark.circle.fill` · warning `exclamationmark.triangle.fill` · stop `stop.fill` · send `arrow.up.circle.fill` · mic `mic` · attach `plus` · jump `chevron.down` · share `square.and.arrow.up` · offline `wifi.slash`.

App icon: layered Icon Composer artwork (default/dark/clear/tinted variants), indigo-on-dark glyph from the `sparkles` + terminal-prompt motif, no wordmark.

---

## 4. Screen inventory

### 4.0 Shared state conventions (apply to every screen)

| State | Treatment | Standard copy |
|---|---|---|
| Loading (structured list/form) | `redacted(reason: .placeholder)` skeleton matching final layout; no spinner | — |
| Loading (indeterminate sub-second) | Small labeled spinner | "Checking…" (or precise verb) |
| Empty | Designed surface: one SF Symbol (symbol-scale, no art), one sentence, one primary CTA | Per-screen below |
| Error (recoverable fetch) | Inline error card: `exclamationmark.triangle.fill` in `StatusError` + message + `Retry` button. Card replaces only the failed panel, never the screen (lesson B2: isolate every panel) | "Couldn't load {thing}." + button "Retry" |
| Error (401) | Full-screen gate | "Your session expired. Sign in again to continue." + button "Sign In" |
| Error (429) | Inline banner, auto-dismiss on success | "Too many requests. Try again in a moment." |
| Offline (cached data available) | Show cached content + amber banner pinned under nav bar: `wifi.slash` + text | "You're offline — showing saved data from {relative time}." |
| Offline (no cache) | Empty-style surface | "You're offline. This screen needs a connection." + button "Retry" |

Every mutating call shows a visible success or failure signal (lesson B4 — silent API failures are the worst failure). Every disabled control has a reason, surfaced as a context-menu line or inline footnote (lesson B7), e.g. "Create PR is locked until you commit changes."

All vocabulary is task language, never builder language (lesson B1): say "workspace is paused", not "sandbox hibernated"; "Your own API key", not "inference profile". The word "sandbox" never appears in user-facing copy — use "workspace".

---

### Onboarding group

#### SCR-01 Welcome

- **Purpose:** the single unavoidable sign-in wall; nothing else.
- **Layout:** centered app glyph (88 pt), title, tagline, two buttons stacked, legal footer. Opaque `systemBackground`.
- **Copy:** Title: **"Open Agents"**. Tagline: **"Your coding agents, anywhere."** Buttons: **"Sign in with Apple"** (system `SignInWithAppleButton`, `.black`/`.white` per mode), **"Continue with Vercel"** (`.glassProminent` button style). Footer: **"Privacy Policy"** · **"Terms of Service"** (links).
- **States:** no loading/empty. Error (auth failed/cancelled): inline footnote under buttons — **"Sign-in didn't finish. Try again."** (cancel produces no error). Offline: buttons disabled + footnote **"You're offline. Connect to sign in."**
- **Interactions:** both buttons launch `ASWebAuthenticationSession` per `04-auth.md` → SCR-02.

#### SCR-02 Auth In Progress

- **Purpose:** non-blank handoff state while the web auth session and token exchange run.
- **Layout:** app glyph + small labeled spinner. Copy: **"Signing you in…"**
- **States:** error (token exchange failed): **"Something went wrong signing you in."** + button **"Try Again"** (returns to SCR-01). Must survive process death: relaunch mid-flow returns to SCR-01 cleanly.

#### SCR-03 Connect GitHub

- **Purpose:** conditional onboarding step mirroring web `/get-started?step=github`; shown when the signed-in account lacks a GitHub connection or App installation (`GET /api/github/connection-status`).
- **Layout:** glyph `folder.badge.gearshape`, title, one explanatory paragraph, primary CTA, secondary escape.
- **Copy:** Title: **"Connect GitHub"**. Body: **"Agents need repository access to read code and open pull requests. You choose which repositories."** Primary: **"Connect GitHub"**. Secondary: **"Not now"** (lands in Sessions with New Chat mode available — app is usable before GitHub connects).
- **States:** loading: skeleton over the body while connection status loads. Error: standard inline error card. `request_sent` (org admin approval pending): replace CTA with static row — **"Waiting for an admin to approve access to {org}."**
- **Interactions:** CTA opens the GitHub OAuth/App-install flow in `ASWebAuthenticationSession`; on return, re-check `GET /api/github/connection-status` and advance.

#### SCR-51 Sign-in Gate (deep-link interstitial)

- **Purpose:** preserve deep-link destinations when signed out (lesson B12).
- **Copy:** Title: **"Sign in to view this"**. Body: **"This {link type — "session", "run", "page"} belongs to an Open Agents account."** Button: **"Sign In"**. After sign-in, navigate to the preserved destination.

---

### Sessions tab

#### SCR-10 Sessions Inbox

- **Purpose:** triage surface — every session, grouped by repo, with live status. Web parity: `apps/web/components/inbox-sidebar.tsx`.
- **Layout:** large title **"Sessions"**; segmented control **Active | Archive** (with counts, e.g. "Active 12"); `List` with repo-name section headers (`owner/repo` in `Type.metadata`); bottom-aligned `searchable` (prompt: **"Search sessions"**); trailing nav-bar `+` button (44 pt) opening SCR-11. Row anatomy: session title (`Type.sessionTitle`, `lineLimit(2)`), repo/branch line (`Type.metadata`), trailing column: relative time (`Type.timestamp`) + status glyph — streaming = pulsing `StatusRunning` dot, unread = `AccentPrimary` dot, PR state = `arrow.triangle.pull` tinted green (open) / purple (merged) / red (closed).
- **Data:** `GET /api/sessions` (poll/refresh per `02-api-contract-and-networking.md`); cached in GRDB for offline.
- **States:** Loading: 8 skeleton rows. Empty (Active, first run): the **invitation empty state** — focused mini-composer card titled **"Start your first session"**, placeholder **"Pick a repo and describe what to build…"**, plus three suggestion chips: **"Fix a failing test"**, **"Explain this repo"**, **"Start from a GitHub issue"** (each opens SCR-11 with the prompt prefilled). Empty (Archive): **"No archived sessions."** Empty (search): **"No sessions match “{query}”."** Error: standard card. Offline: cached list + amber banner.
- **Interactions:** tap row → SCR-12. Swipe leading → **Archive** (`archivebox`) / **Unarchive**. Swipe trailing → **Rename** (inline alert with text field; empty input keeps the old name). Context menu: Rename, Archive/Unarchive, Copy Link, Share. Pull-to-refresh (`.selection` haptic at trigger). Repo section headers expose a context-menu **"New session in {repo}"**. Renames propagate immediately to any open SCR-12 header (lesson B15 — single source of truth for session metadata).

#### SCR-11 New Session (sheet)

- **Purpose:** create work. Web parity: `apps/web/components/session-starter.tsx`.
- **Layout:** sheet with title **"New Session"**, a two-option mode control with one-line descriptions (lesson B13), then mode-dependent form, then a prompt field, then the primary button.
  - Mode A **"Agent Session"** — caption: **"The agent works on a repository in a cloud workspace."**
  - Mode B **"Chat Only"** — caption: **"Brainstorm without a repository. No workspace."**
- **Form (Agent Session):** Repo picker row (pushes a searchable list; org filter menu; private repos show `lock.fill`; footer link **"Manage repository access"** → SCR-43; first 25 repos per page). Branch picker row — default **"New branch (auto)"** with caption **"A new branch like mb/3f9a2c10 will be created — {default branch} is untouched."** (lesson B10), or search existing branches (`GET /api/github/branches`, 50-limit). Title field — placeholder **"Session name (optional)"**, footer **"Leave blank for a random name."** Switching modes never resets the repo selection (web bug, lesson B13).
- **Prompt field:** multiline, placeholder **"What should the agent do?"** Mic button included (same dictation behavior as SCR-12 composer).
- **Primary button:** **"Start Session"** / **"Start Chat"**. Disabled until (Agent Session: repo chosen) or (Chat Only: prompt or attachment present); disabled state shows footnote with the reason.
- **Data:** `POST /api/sessions`, then send the first message via `POST /api/chat`.
- **States:** repo list loading: skeleton rows. Repo list empty: **"No repositories. Connect GitHub or install the GitHub App on an organization."** + button **"Manage Access"**. GitHub token expired (`reconnectRequired`): inline banner **"GitHub connection expired."** + button **"Reconnect"** (→ web `?step=github` flow in `ASWebAuthenticationSession`). Create error: alert **"Couldn't create the session."** + body from server `error` + **"Try Again"** / **"Cancel"**. 429: **"You're creating sessions too quickly. Wait a minute and try again."** (server limit 10/min). 403 bot-protection: **"Request blocked. Try again from this device in a moment."** Offline: form disabled + offline banner.
- **Success:** dismiss sheet, push SCR-12, fire S1 for the first message.

#### SCR-12 Chat Workspace (the core screen)

- **Purpose:** watch, steer, and unblock an agent run. Full behavior spec in §5; this entry covers chrome and states.
- **Layout (compact):** nav bar: back, session title (tap → SCR-13), trailing `square.and.arrow.up` (SCR-17) and `ellipsis.circle` menu (Rename, Archive, Fork from last message, Open on Web). Below nav: **workspace status row** (see below). Center: transcript (§5). Bottom: composer (§5.1). A **"Code"** toolbar button (symbol `plus.forwardslash.minus`, with changed-file count badge) opens SCR-16.
- **Workspace status row:** one-line opaque strip under the nav bar showing sandbox lifecycle as glyph + word + color (P5): `Creating workspace…` (`StatusRunning`) · `Active` (`StatusSuccess`, auto-hides after 4 s) · `Paused` (`StatusWarning`) + trailing button **"Resume"** · `Resuming…` (`StatusRunning`) · `Failed` (`StatusError`) + **"Retry"**. Data: `GET /api/sandbox/status`; resume via `PUT /api/sandbox/snapshot`. Returning to a paused workspace is the *common* case on mobile — Resume is always one tap (lesson, research §C).
- **States:** Loading: cached transcript from GRDB renders instantly; if none, skeleton message rows. Empty (new chat): suggestion chips above composer (same three as SCR-10 empty). Stream error: error row in transcript (§5.8) — composer always re-enables on terminal state (lesson B3). Offline: cached transcript + amber banner **"You're offline — showing saved messages."**; composer disabled with footnote **"Reconnect to send messages."** Archived: all inputs disabled; banner **"This chat is archived."** + button **"Unarchive to resume"**.
- **Interactions:** §5. On `scenePhase` → `.active`, recovery checks `activeStreamId` and resumes the stream (`GET /api/chat/{chatId}/stream`) with an honest elapsed timer from the last user message (web STORY-029; `05-streaming-chat-engine.md`).

#### SCR-13 Session Info & Chat Switcher (sheet)

- **Purpose:** session metadata + switching among a session's chats (replaces the web's tab strip on compact).
- **Layout:** grouped list. Section "Session": title row (tap to rename inline), repo/branch rows (copyable via context menu), created date. Section "Chats": one row per chat — title, model pill, streaming dot; checkmark on current. Footer button **"New Chat in this Session"**. Section "Danger": **"Archive Session"** (red, confirmation dialog: title **"Archive this session?"**, body **"You can unarchive it later from the Archive tab."**, confirm **"Archive"**, cancel **"Cancel"** — `.warning` haptic on presentation).
- **States:** loading skeleton; error card; offline shows cached values.

#### SCR-14 Model Picker (sheet)

- **Purpose:** per-chat model selection. Web parity STORY-030; the web's broken tap-to-select is the cautionary tale (lesson B5) — the *touch* path is the tested path.
- **Layout:** searchable list grouped by provider. Each row: model display name, caption with context-window + relative cost hint, trailing checkmark for current. Curated set (the user's `enabledModelIds` / Custom Model Set) shows first under header **"Your models"**; full catalog under **"All models"** behind a disclosure (lesson B17 — never dump ~200 ungrouped models). Variants tagged with a `caption` badge; profile-backed models suffixed **"via your API key"**. A missing/retired current model stays visible, flagged **"Unavailable — pick a replacement."**
- **Data:** `GET /api/models`; selection persists to the chat per `02-api-contract-and-networking.md`.
- **States:** loading skeleton; error card; empty search **"No models match “{query}”."**; offline: read-only with banner.
- **Interactions:** single tap selects, shows checkmark, dismisses after 250 ms. Selection failure → row reverts + toast **"Couldn't switch model."** (never silently keep the wrong state).

#### SCR-15 Run Options (sheet)

- **Purpose:** the overflow home for everything the web crams into its 7-control composer toolbar (lesson, walker #221). The composer itself holds only field/attach/mic/send.
- **Layout:** grouped list. Rows: **Model** (current name, → SCR-14) · **Tools** (read-only Composio profile name or "None", footer **"Manage tool connections on the web."**) · **Runtime** (read-only profile display name, footer **"Runtime profiles are managed on the web."**) · **Auto-commit & push** (toggle, per-session override) · **Auto-create PR** (toggle; disabled until auto-commit is on, footnote **"Requires Auto-commit & push."** — lesson B7).
- **States:** standard. Toggle write failure: revert + toast **"Couldn't save. Try again."**

#### SCR-16 Git Panel (sheet on compact / inspector on regular)

Container with a segmented control: **Files | Diff | Changes | PR**. Title: repo short name + branch (`Type.metadata`). Each segment is failure-isolated (lesson B2 — a Files crash must never take down Diff or chat).

**SCR-16a Files**

- **Purpose:** browse the workspace tree. Data: `GET /api/sessions/{sessionId}/files`.
- **Layout:** indented disclosure list; folder rows `folder`, file rows `doc.text`; modified files show an `AccentPrimary` dot. Toolbar refresh button.
- **States:** loading skeleton tree. Empty: **"No files yet."** Workspace paused: cached tree (GRDB) + amber banner **"Workspace is paused — showing saved files."** + **"Resume"** button (the web lacks this fallback; iOS caches both files and diff — lesson B14). Error: per-panel card **"Couldn't load files."** + Retry; malformed entries are skipped, never crash the panel.
- **Interactions:** tap file → SCR-16b.

**SCR-16b File Viewer**

- **Purpose:** read one file. Data: `GET /api/sessions/{sessionId}/files/content`.
- **Layout:** monospaced (`Type.code`) scrolling view in a `CodeBackground` container; header: file path (middle-truncated, copyable), Raw/Pretty toggle for `.md`, copy button. Syntax highlighting per §5.5 rules.
- **States:** loading spinner ("Loading file…"); empty file: centered **"This file is empty."**; binary/too large: **"Can't preview this file."**; paused workspace with cache: cached content + amber banner; without cache: **"Workspace is paused. Resume to read this file."** + **"Resume"**.

**SCR-16c Diff**

- **Purpose:** review changes. Unified only on iPhone (canonical; split is a later iPad-regular option). Data: `GET /api/sessions/{sessionId}/diff`, offline fallback `GET /api/sessions/{sessionId}/diff/cached`.
- **Layout:** scope control: **Uncommitted | All changes** with footer **"vs origin/{base}"**. File list with per-file `+N −M` counts (`DiffAddedAccent`/`DiffRemovedAccent`); tapping a file scrolls to its section. Sticky per-file headers; a `list.bullet` toolbar button opens a **file-jump menu** (our improvement over GitHub Mobile). Rendering spec: §5.6. Generated/lock-file bodies collapsed by default under **"Generated file — tap to expand"**.
- **States:** loading skeleton. Empty: **"No changes yet."** Cached/offline: amber `StatusWarning` banner **"Viewing saved changes — workspace is offline (saved {relative time})."** Error: panel card + Retry.

**SCR-16d Changes (commit & push)**

- **Purpose:** ship work-in-progress. Data: `GET /api/sessions/{sessionId}/git/status`, `POST .../git/commit`, `POST .../generate-commit-message`, `POST .../git/branch`.
- **Layout:** changed-file summary count; message field (placeholder **"Commit message (optional)"**) with **"Generate"** button (AI message via the generate endpoint, result editable); primary button **"Commit & Push"**.
- **Base-branch guard:** when on the base branch, replace the form with a card — **"You're on {branch}. Create a working branch before committing."** + button **"Create Branch"** (lesson B10).
- **States:** committing: button shows labeled spinner **"Committing…"**. Success: green pill **"Pushed {shortSHA}"** with **"View on GitHub"** link; `.success` is *not* fired (run-completion owns success haptics — §3.7). Failure: inline error with server message + Retry. Nothing to commit: **"No uncommitted changes."** Paused workspace: form disabled + **"Resume the workspace to commit."** + Resume button.

**SCR-16e Pull Request**

- **Purpose:** create, monitor, and merge the session PR. Data: `GET/POST /api/sessions/{sessionId}/git/pr`, `.../pr/generate`, `.../pr/readiness`, `.../pr/merge`, `.../pr/close`, `POST /api/sessions/{sessionId}/checks/fix`.
- **Layout (no PR yet):** locked until a commit exists — card **"Commit your changes first, then open a pull request."** (mirrors the web's good disabled-reason pattern). Once committed: **"Create Pull Request"** button → AI-generated title/body (editable), **"Draft"** toggle, then **"Open PR"**.
- **Layout (PR exists):** header `#N {title}` linking to GitHub; status badge open/merged/closed (green/purple/red + word); checks list (each: name, glyph + word + color per P5); merge controls: method menu (**Squash and merge** default · **Merge** · **Rebase**) + **"Delete branch after merge"** toggle + primary **"Squash & Archive"** (merges then archives the session). Failing checks: button **"Fix Errors"** — caption **"Hands the failures back to the agent."** Conflicts: card **"This branch has conflicts."** + button **"Fix Conflicts"** (agent resolves).
- **States:** readiness polling shows labeled spinner **"Checking…"**; merge in flight: **"Merging…"**; merge success: status flips to merged + S4-style settle (no extra haptic); errors inline with server message + Retry. Offline: read-only cached PR state + banner.

#### SCR-17 Share Link (sheet)

- **Purpose:** create/copy/revoke the chat's public read-only link. Data: `GET/POST/DELETE /api/sessions/{sessionId}/chats/{chatId}/share`.
- **Layout:** explanation first (the web hid all of this — lesson B6/B19): **"Anyone with the link can read this chat. Secrets in .env files are hidden automatically."** If no link: button **"Create Link"**. If link exists: the URL in a copyable row, buttons **"Copy Link"**, **"Share…"** (system share sheet, includes a **"Markdown transcript"** item backed by `GET /api/shared/{shareId}/markdown`), and **"Revoke Link"** (red; confirmation: **"Revoke this link? Anyone using it will lose access."** / **"Revoke"** / **"Cancel"**).
- **States:** standard; create/revoke failures inline with Retry.

---

### Repos tab

#### SCR-20 Repos List

- **Purpose:** entry point by repository. Data: `GET /api/github/installations/repos` (+ orgs).
- **Layout:** large title **"Repos"**; searchable list grouped by org; row: repo name, `lock.fill` if private, caption with active-session count; trailing chevron.
- **States:** loading skeletons. Empty: glyph `folder`, **"No repositories"**, **"Connect GitHub to give agents access to your code."**, button **"Connect GitHub"** (→ SCR-43). Reconnect-required banner as in SCR-11. Error card; offline cached + banner.
- **Interactions:** tap → SCR-21. Context menu: **"New session"** (→ SCR-11 prefilled).

#### SCR-21 Repo Detail

- **Purpose:** glanceable repo dashboard (subset of web `/repos/[owner]/[repo]`). Data: `GET /api/repos/{owner}/{repo}/dashboard`.
- **Layout:** title `{repo}` with `{owner}` caption; primary button **"New Session"**; then failure-isolated cards: **Sessions** (active sessions in this repo → SCR-12), **Open PRs** (status + checks glyphs; rows link to SCR-12 when session-backed, else GitHub), **Background Agents** (name + enabled toggle + last-run glyph → SCR-32), **Recent Runs** (→ SCR-31).
- **States:** each card loads/fails independently (skeleton → content or per-card error with Retry — lesson B2). Whole-screen error only when the dashboard endpoint itself 404s/fails: **"Couldn't load this repo."** Offline: cached cards + banner.

---

### Agents tab

#### SCR-30 Agents Home

- **Purpose:** monitor background automation — the best mobile fit in the product (research §A7). Authoring stays on web.
- **Layout:** large title **"Agents"**. Section **"Recent runs"**: reverse-chron run rows — status glyph + word (`Queued`/`Running`/`Succeeded`/`Failed` in P5 colors), agent name, repo, trigger kind, relative time, duration. Section **"Your agents"**: per-agent rows — name, repo, trigger summary (e.g. "On pull request"), enabled toggle. Data: `GET /api/background-agent-runs`, `GET /api/background-agents`.
- **States:** loading skeletons per section. Empty (no agents): glyph `sparkles`, **"No background agents"**, **"Create agents on the web — runs and results will show up here."**, button **"Open Web Settings"** (opens `{host}/settings/background-agents` in Safari). Empty (no runs): **"No runs yet."** Error per section; offline cached + banner.
- **Interactions:** run row → SCR-31; agent row → SCR-32; toggle writes `PATCH /api/background-agents/{agentId}` with revert-on-failure toast **"Couldn't update the agent."**; pull-to-refresh.

#### SCR-31 Background Run Detail

- **Purpose:** full run forensics, read-mostly. Web parity `/background-runs/[runId]` (STORY-139-149). Data: `GET /api/background-agent-runs/{runId}`; poll every 2 s while `queued`/`running`.
- **Layout:** title **"Run"** + status badge. **Proof grid** (2-column key-value): Status, Trigger, Repo, Ref, Workspace, Permissions, Checks, Output, Duration, Cost. **Timeline**: vertical event list (glyph + label + `Type.timestamp`), live-appending while running. **Output**: stdout/stderr in code blocks (§5.5 rendering); failed runs auto-expand stderr (P5). **Outputs** card: **"Open PR"** / comment links. **Debug IDs** card: run/request/workflow/idempotency IDs, each row copyable (lesson B20).
- **States:** loading skeleton grid. Error: **"Couldn't load this run."** + Retry. 404/not-owned: **"This run doesn't exist or belongs to another account."** Offline: cached snapshot + banner (polling suspended).

#### SCR-32 Background Agent Detail

- **Purpose:** read-only config + control surface for one agent.
- **Layout:** title = agent name. Card: trigger, conditions, output mode with derived-permission explanation — **"Ready PR output — this agent can write code and open pull requests."** (lesson B20). Toggle **"Enabled"**. Button **"Run Test"** (`POST /api/background-agents/{agentId}/test` → navigates to SCR-31). Run history list → SCR-31. Footer: **"Edit this agent on the web."** + link.
- **States:** standard; test-dispatch failure: alert **"Couldn't start a test run."** + server message.

---

### Settings tab

#### SCR-40 Settings Root

- **Layout:** large title **"Settings"**; grouped `List`. Section "Account": Profile (SCR-41), Connections (SCR-43). Section "Defaults": Preferences (SCR-42), Models (SCR-44). Section "Insights": Usage (SCR-45). Section "App": Notifications (SCR-46), **"App Lock"** toggle (Face ID gate via `LocalAuthentication`; footer **"Require Face ID when opening the app."**), **"Open Web Settings"** (external link for everything not on iOS: Composio, Skills, Runtime profiles, Background-agent authoring, Leaderboard, Admin). Footer: app version + build (copyable).
- **States:** instant render (local + cached prefs); rows that need network handle their own states.

#### SCR-41 Profile & Account

- **Purpose:** identity, usage snapshot, sign out, account deletion.
- **Layout:** avatar + name + username + email (read-only, Vercel-synced). Usage snapshot card: this week's tokens/cost/messages (from `GET /api/usage`) + **"See All Usage"** (→ SCR-45). Toggle **"Public usage profile"** (writes `publicUsageEnabled` via `PATCH /api/settings/preferences`) with **"Copy Public Link"** row when enabled (`{host}/u/{username}`). Buttons: **"Sign Out"** (confirmation: **"Sign out of Open Agents?"** / **"Sign Out"** / **"Cancel"**), **"Delete Account…"** (red, → SCR-47).
- **States:** standard; preference write failures revert + toast **"Couldn't save. Try again."**

#### SCR-42 Preferences

- **Purpose:** the mobile-relevant subset of `user_preferences` (`apps/web/app/api/settings/preferences/route.ts`).
- **Layout (grouped form):**
  - **Diff style:** picker `Unified | Split` → `defaultDiffMode` (Split applies on iPad regular width only; footer **"iPhone always shows unified diffs."**).
  - **Auto-commit & push** toggle → `autoCommitPush`.
  - **Auto-create PR** toggle → `autoCreatePr`; disabled with footnote **"Requires Auto-commit & push."** when the dependency is off (lesson B7). When an auto-PR is skipped server-side, the chat surfaces **"PR skipped: {reason}"** as a transcript event (lesson B18).
  - **Appearance:** picker `System | Light | Dark` (local to device; web theme is per-browser, not synced).
- **States:** loading skeleton form; each PATCH failure reverts the control + toast.

#### SCR-43 Connections

- **Purpose:** GitHub + Vercel connection management. Web parity `/settings/connections`.
- **Layout:** **GitHub** card: status (`Connected as {login}` / `Not connected` / `Connection expired`), buttons **"Connect"** / **"Reconnect"** / **"Disconnect"** (confirmation dialog with Cancel always present — lesson B19), row **"Manage repository access"** (GitHub App install page in `ASWebAuthenticationSession`). **Vercel** card: **"Managed"** read-only — footer **"Your Vercel account is your Open Agents sign-in and can't be disconnected here."**
- **States:** loading skeleton; status fetch error card; action failures inline.

#### SCR-44 Models

- **Purpose:** account default model. Data: `defaultModelId` via preferences PATCH; catalog from `GET /api/models`.
- **Layout:** row **"Default model"** (current name → picker identical to SCR-14). Footer: **"Variants and your own API keys are managed on the web."**
- **States:** standard.

#### SCR-45 Usage

- **Purpose:** glanceable stats (share-bait). Data: `GET /api/usage` (default 280-day lookback; range query `?from=&to=`), `GET /api/usage/rank`.
- **Layout:** range control: **7D | 30D | All**. Headline cards: Tokens, Cost, Messages, Tool calls (all `.monospacedDigit()`). Contribution heatmap (Swift Charts). Insights rows: tracked PRs, merge rate, largest turn, avg tokens/turn, cache-hit ratio. Rank row when non-null: **"Your rank today: #​{rank} of {total} at {domain}"** (hidden when `/api/usage/rank` returns null).
- **States:** loading skeletons; empty: **"No usage yet. Start a session to see stats here."**; error card; offline cached + banner.

#### SCR-46 Notifications

- **Purpose:** per-event push toggles (net-new; server fan-out per `07-observability.md`).
- **Layout:** master toggle **"Allow Notifications"** (drives the system prompt / deep-links to system settings when denied — row **"Open iOS Settings"** with footer **"Notifications are turned off for Open Agents in iOS Settings."**). Event toggles: **"Agent finished or failed"** · **"Agent needs an answer"** · **"Edit approval requested"** · **"PR checks completed"** · **"Background runs"**. Footer: **"Notifications arrive only when the app is closed or you're in another chat."**
- **States:** standard; registration failure: inline **"Couldn't register this device for notifications."** + Retry.

#### SCR-47 Delete Account

- **Purpose:** App Store guideline 5.1.1(v) compliance; endpoint per `04-auth.md`.
- **Layout:** warning card: **"Deleting your account removes your sessions, chats, usage history, and connections from Open Agents. Your GitHub repositories are not affected. This can't be undone."** Confirmation field: **"Type DELETE to confirm"**. Red button **"Delete My Account"** (disabled until the field matches; `.warning` haptic on the final confirmation dialog).
- **States:** deleting: full-screen labeled spinner **"Deleting your account…"**; failure: alert **"Couldn't delete your account."** + server message + **"Try Again"**; success: wipe local store, return to SCR-01.

---

### Public surfaces

#### SCR-50 Shared Chat Viewer

- **Purpose:** read-only public chat — recipients already open these links on phones (web STORY-127). Data: server-rendered web equivalent of `/shared/{shareId}`; native render uses the messages payload per `02-api-contract-and-networking.md` plus `GET /api/shared/{shareId}/status` (3 s poll while `isStreaming`).
- **Layout:** no app chrome beyond a close button and a **"Open in App"**/sign-in affordance; repo/branch/PR badges; owner attribution; transcript with collapsible reasoning/tool rows (§5.4, read-only); while live: playful status word + elapsed timer. Owner viewing their own share: banner **"You own this share."**
- **States:** loading skeleton transcript. 404: **"This shared chat doesn't exist or was revoked."** Offline: **"Connect to load this shared chat."**
- **Interactions:** share-sheet export (link + markdown via `GET /api/shared/{shareId}/markdown`); env-file content arrives pre-redacted from the server.

---

## 5. Chat experience deep dive

The acceptance spec for the streaming epic. Stream transport: AI SDK v6 UI Message Stream over SSE (`data: {json}` lines, `data: [DONE]` terminator, `x-vercel-ai-ui-message-stream: v1`), resumable from chunk 0 — engine in `05-streaming-chat-engine.md`. Chunks arrive 20–100/sec and are coalesced to UI updates every 50–100 ms.

### 5.1 Composer

- **Idle anatomy, left → right:** `plus` attach (44 pt) · multiline field (placeholder **"Message the agent…"**) · `mic` (44 pt) · send `arrow.up.circle.fill` (44 pt, `AccentPrimary`; disabled at 40% opacity when input empty *and* no attachments — attachments alone enable send). One glass container (§3.5), `OARadius.composer`.
- **Field:** grows 1→6 visible lines, then scrolls internally. Hardware keyboard: `Enter` = newline, `Cmd+Enter` = send. On-screen keyboard sends only via the send button. Drafts persist per chat across launches (GRDB).
- **Streaming:** send swaps to stop (`stop.fill` on the `StatusError`-tinted glass capsule) with `contentTransition(.symbolEffect(.replace))`. The field **stays enabled** — users compose the next message during a run; sends are queued and dispatched on run completion, with a queued chip above the field: **"Will send when the run finishes"** + remove button.
- **Attachments:** image picker (photo library / camera) + paste; pastes > 2,000 characters auto-convert to a `.txt` chip named `pasted-text.txt` with toast **"Long paste attached as a file."** Chips: 56 pt high, horizontal row above the field, `xmark.circle.fill` remove (22 pt glyph, 44 pt hit area), inside the same glass container.
- **`+` menu (v1, exact):** **"Photo Library"** · **"Take Photo"** · **"Paste as File"**. Nothing else (anti-Slack rule); model/tools/runtime live in SCR-14/SCR-15.
- **Voice:** `mic` → `.start` haptic, live waveform bars in `AccentPrimary` within the field area, recording posts to `POST /api/transcribe`; transcript inserts at the caret, **never auto-sends**; `.stop` haptic on end. Transcription failure: toast **"Couldn't transcribe. Try again."** with the recording discarded.
- **AskUserQuestion:** S3 morph (§9) replaces the anatomy with the question card; any draft is preserved and restored after answering.
- **Safe areas:** standard keyboard layout guide + safe-area insets only — no manual keyboard math.

### 5.2 Streaming text rendering

- **Before first token:** shimmering placeholder row (rounded rect, `TimelineView` gradient, 1.2 s period) where the assistant message will appear; crossfade to content on first chunk.
- **While streaming text:** a block caret (~2×17 pt `Rectangle`, `AccentPrimary`, opacity autoreversing 0.6 s) rendered as an **overlay at the end of the last line — never inside the `Text`** (keeps it out of Markdown reflow). Removed on finish.
- **While reasoning/tool phases run:** no caret; the active tool row's spinner is the only alive indicator. Exactly one alive indicator on screen at any time.
- **Progressive Markdown:** completed messages parse once and cache as rendered blocks. Only the in-flight message re-parses, on the coalesced tick. Parser: `apple/swift-markdown` into `enum MessageBlock { paragraph, codeBlock, list, table, blockquote, thematicBreak, heading }`; each block is its own SwiftUI view so tail changes never relayout the head.
- **Half-open code fences:** an unclosed ``` renders a code-block shell immediately (language label from the fence info string, copy disabled, plain monospaced text, no highlighting); highlight applies when the fence closes or the message ends.
- **No per-token animation, ever** (P2).

### 5.3 Scroll anchoring (exact rules)

1. Transcript `ScrollView` uses `.defaultScrollAnchor(.bottom)` + `scrollPosition(id:)` bound to the last message id.
2. `followsLive` starts `true`; while true, coalesced updates keep the view pinned (position maintained, never re-scrolled per token).
3. Any upward user drag ≥ 24 pt from the bottom edge (`.onScrollGeometryChange`) sets `followsLive = false`.
4. While unfollowed and streaming, show the jump-to-now pill (S5) floating above the composer; tap → `.smooth(duration: 0.3)` scroll to bottom, re-arm following.
5. Stream completion while unfollowed: pill label morphs "Live" → **"1 new message"** (count accumulates). It never force-scrolls.
6. No layout jumps: completed rows are immutable value types with stable ids; only the in-flight message's isolated `@Observable` buffer mutates; row heights are never wrapped in animation during streaming.

### 5.4 Tool-call presentation

Model: `status ∈ {pending, running, success, error}`, `kind ∈ {read, edit, write, shell, fetch, task, composio}`, title (file path or command), optional output.

- **Collapsed (default):** 44 pt opaque row (`secondarySystemBackground`, `OARadius.card`): kind symbol (§3.9) · title in `Type.toolRow` (middle-truncated paths) · trailing spinner (running) → `checkmark.circle.fill` in `StatusSuccess` / `xmark.circle.fill` in `StatusError` + disclosure chevron.
- **Expanded (tap, `.snappy(duration: 0.2)`):** stdout in a mini code block (§5.5); edit tools show `+N −M` line counts and a **"View diff"** chip deep-linking to SCR-16c filtered to that file. Collapsed by default after success; **errors auto-expand** (P5).
- **Grouping:** consecutive tool calls collapse under a summary header — exact copy pattern **"Ran {n} tools · {e} edits · {r} reads"** (counts only for nonzero kinds) — tap toggles the whole group. This is what makes 50-tool runs skimmable.
- **Edit-approval mode:** when a tool call arrives with `approvalRequested`, render an **approval card**: the proposed diff (§5.6 rendering, that file only) + buttons **"Approve"** (`.glassProminent`) and **"Deny"**. Arrival fires `.impact(weight: .medium)`. Buttons disable with a labeled spinner while the decision posts; failure re-enables with inline **"Couldn't send your decision."** + Retry.
- **Status always = icon + word + color**, never color alone.

### 5.5 Code blocks

- Container: opaque `CodeBackground`, `OARadius.block`, 0.5 pt `CodeBorder`; header strip: language label (`caption`, `.secondary`) left, 44 pt copy button right (no haptic; transient checkmark swap, reverts after 1.5 s).
- Body: `Type.code`; **horizontal scroll, no wrap** (preserves indentation). Long blocks (> 40 lines) collapse to ~14 lines with footer **"Expand · {N} lines"**.
- Highlighting: Highlightr (pinned per `03-architecture.md`), run off-main, attributed strings cached per block; two custom themes tied to §3.2 tokens.

### 5.6 Diffs

- **Unified only on iPhone.** Structured model `DiffHunk → DiffLine(type: added|removed|context, text:)` — never colored raw text (required for VoiceOver and intraline spans).
- Rendering: monospaced, fixed-width gutter with `+`/`-` glyphs in `DiffAddedAccent`/`DiffRemovedAccent`, line backgrounds `DiffAddedBg`/`DiffRemovedBg`, intraline changed spans in the stronger accent hues. Per-file sticky headers; file-jump menu.
- Honor `accessibilityDifferentiateWithoutColor`: add per-hunk "Added"/"Removed" badges.

### 5.7 Markdown tables and remaining blocks

- GFM tables render as a bordered grid (0.5 pt `CodeBorder` hairlines): header row `.semibold`, body `Type.message`, cell padding `OASpacing.sm`. Tables wider than the measure scroll horizontally inside their container (the transcript itself never scrolls horizontally). While streaming, completed rows render as they close; a half-open row renders as plain text until its `|` terminator arrives.
- Blockquotes: 3 pt `AccentPrimary` leading bar + `.secondary` text. Headings: map h1–h3 → `.title3`/`.headline`/`.subheadline` semibold (transcript headings never exceed sheet-title size). Lists: standard bullets/numbers, 24 pt indent per level. Links: `AccentPrimary`, open in `SFSafariViewController`; long-press → Copy Link.
- Images in assistant output: async-loaded, max height 280 pt, tap for full-screen viewer with share.

### 5.8 Errors and retry (the composer is never dead — lesson B3)

- **Stream drop (network):** the partial message stays; an inline status row appears under it — `wifi.slash` + **"Connection lost. Reconnecting…"** with automatic resume attempts (backoff per `05-streaming-chat-engine.md`). After 3 failures: **"Couldn't reconnect."** + buttons **"Resume"** (retries `GET /api/chat/{chatId}/stream`) and **"Dismiss"**.
- **Run failure (server terminal error):** error row: `xmark.circle.fill` + **"The run failed: {server message}"** + **"Retry"** (re-sends the last user message) — `.error` haptic once.
- **Stop:** partial output is preserved and labeled with a `footnote` row **"Stopped by you."**; composer re-enables immediately.
- **Invariant:** composer enablement is derived from observable run state (`activeStreamId` + terminal events) and re-evaluated on every foreground; it can never be stuck disabled across relaunch.
- **Send failure (POST /api/chat fails):** the user bubble shows a `StatusError` badge + **"Not sent. Tap to retry."** — tap re-posts; long-press → **"Copy text"** / **"Delete"**.

### 5.9 Message actions and metadata

- Long-press a message → context menu: **Copy**, **Share…**, **Fork from here** (assistant messages; `POST .../chats/{chatId}/fork` → opens the new chat), **Edit & resend** (user messages; loads text into composer, discards subsequent messages after confirmation **"Editing will remove everything after this message."** / **"Edit"** / **"Cancel"**).
- Assistant message footer (after S4 fold-in): duration badge (**"26s"**), cost badge (**"$0.34"**), model pill — all `Type.badge`. Tapping the cost badge shows a popover: **"Estimated model cost for this reply. Session total: {sum}."** (lesson B9 — cost needs context). A session-total cost chip lives in SCR-13.

---

## 6. iPad

### 6.1 Layouts

- Root: two-column `NavigationSplitView` (§2.3). Git panel = trailing inspector (420 pt default, resizable) — Files/Diff/Changes/PR segments identical to SCR-16; at regular width the **Diff** segment may offer the split toggle (default from `defaultDiffMode`).
- Transcript column caps at the 672 pt measure and centers beyond it.
- All layout branching keys off `horizontalSizeClass` (+ `dynamicTypeSize`), never device idiom or literal window sizes.

### 6.2 Hardware keyboard shortcuts (v1 set, exact)

| Shortcut | Action |
|---|---|
| `Cmd+N` | New session sheet (SCR-11) |
| `Cmd+Enter` | Send message (`Enter` = newline in composer) |
| `Cmd+K` | Session/command switcher (search field focus) |
| `Cmd+1…4` | Switch tabs (Sessions/Repos/Agents/Settings) |
| `Cmd+F` | Find in transcript |
| `Cmd+.` | Stop the streaming run |
| `Cmd+Shift+]` / `Cmd+Shift+[` | Next/previous chat within the session |

Declared with `.keyboardShortcut` on visible controls (so the hold-Cmd HUD lists them) plus `Commands` groups for the menu bar.

### 6.3 Pointer and hover

- Every tappable row/button: `.hoverEffect(.automatic)` (`.highlight` for list rows, `.lift` for floating glass buttons).
- `onHover` is **additive only** — e.g., revealing inbox-row quick actions (New chat `plus`, From branch `arrow.branch`) that remain always-visible under touch.

### 6.4 Window-size QA matrix (snapshot + manual)

| Configuration | Points (w×h) | Expected |
|---|---|---|
| iPhone 17 Pro portrait | 402×874 | Compact: tabs + stack |
| iPhone landscape | 874×402 | Compact height: composer never occluded by keyboard |
| iPad 13" full screen | 1032×1376 | Regular: split view, sidebar visible |
| iPad half Split View | ~507×1376 | Compact width: split collapses to stack |
| iPadOS 26 small floating window | ~400×600 | Identical to iPhone layout, no clipping |
| iPadOS 26 wide short window | ~900×500 | Regular width, short height: composer 1-line default |

These sizes are for *testing* breakpoints; layout code never encodes them.

---

## 7. Accessibility requirements

### 7.1 Global (every screen)

- Dynamic Type to AX5: no fixed heights on text-bearing views; `@ScaledMetric(relativeTo:)` for non-text dimensions; `ViewThatFits`/`AnyLayout` flips `HStack`→`VStack` at `dynamicTypeSize.isAccessibilitySize` for the composer and action rows. Snapshot tests at `.large`, `.xxxLarge`, `.accessibility3` (`06-testing-strategy.md`).
- 44×44 pt minimum targets via padded `.contentShape`.
- Reduce Transparency: system glass adapts automatically; custom material fallback = opaque `secondarySystemBackground` + hairline.
- Reduce Motion: per §3.8 fallbacks.
- Differentiate Without Color: every status carries glyph + word; diff hunks gain Added/Removed badges.
- Contrast: §3.2 tokens AA-tested in CI.

### 7.2 Streaming transcript (SCR-12, SCR-50)

- **Never announce per token.** One status element ("Assistant is responding") with `.accessibilityAddTraits(.updatesFrequently)` while streaming.
- On completion, post exactly one `AccessibilityNotification.Announcement`: **"Agent finished: {e} files edited, {c} commands run."** Failures announce **"Run failed."** Long responses are not auto-read.
- Each message row = one element (`.accessibilityElement(children: .combine)`), label "You said, …" / "Assistant said, …" + timestamp; Copy/Share/Fork/Retry as `accessibilityAction(named:)`.
- Tool rows: label "Tool: {Kind}, {title}, {status}."; expanded output via `accessibilityCustomContent`. Approval card: actions "Approve edit", "Deny edit".
- Code blocks: label "{Language} code block, {N} lines"; action "Copy code". Diff lines: "Added line: …" / "Removed line: …"; hunks: "Diff in {file}, {n} changed lines"; action "Copy patch".

### 7.3 Per-screen specifics

| Screen | Requirements beyond global |
|---|---|
| SCR-01/02/03 | Buttons are native controls (SIWA button is system); progress states have `accessibilityLabel("Signing you in")` |
| SCR-10 | Row label combines title + repo + status word + relative time ("Fix login bug, acme/web, running, 2 minutes ago"); swipe actions mirrored as custom actions; streaming dot exposed as text "running", never visual-only |
| SCR-11 | Mode control announces full captions; disabled Start button exposes its reason via `accessibilityHint` |
| SCR-12 | §7.2; composer field labeled "Message the agent"; send/stop announce state change; status strip is a button ("{session}, running, 42 seconds, double-tap to open") |
| SCR-14 | Rows announce name + cost/context caption + "selected" |
| SCR-16c | Diff per §7.2; scope control labeled "Diff scope" |
| SCR-16d/e | All status text reachable; merge method menu labeled "Merge method" |
| SCR-31 | Proof grid cells combined per key-value ("Status: succeeded"); timeline rows labeled with event + time; ID rows action "Copy" |
| SCR-45 | Heatmap exposes an audio-graph/summary alternative ("Most active day: Tuesday, 1.2 million tokens"); headline numbers labeled with units |
| SCR-47 | Confirmation field labeled "Type DELETE to confirm"; destructive button has `.isDestructive` trait |

---

## 8. Onboarding flow (first launch → signed in → first session)

Exact sequence; every step survives process death and resumes (auth state machine per `04-auth.md`). No permission prompt appears before step 5.

1. **First launch → SCR-01 Welcome.** One screen. No carousel, no skippable pages, no feature tour.
2. **Sign in → SCR-02.** `ASWebAuthenticationSession` (Vercel OAuth or Sign in with Apple per `04-auth.md`); full-screen progress with the app glyph — never a blank web view.
3. **GitHub check.** `GET /api/github/connection-status`: connected → step 4; otherwise → SCR-03 Connect GitHub. **"Not now"** proceeds with Chat Only mode available — the app is usable before GitHub connects.
4. **Sessions invitation (SCR-10 empty state).** The blank screen *is* the composer invitation: "Start your first session" + three suggestion chips. Still zero permission prompts.
5. **First send.** S1 plays. A single inline card appears under the status row: **"Want a ping when the agent finishes?"** buttons **"Notify me"** (→ system notification prompt) / **"Not now"** (collapses permanently; re-offerable from SCR-46).
6. **First completion.** S4 plays; if the run produced a diff, the **"View diff"** chip in the completion fold is the discovery moment for the git panel. No tooltip tours anywhere in the app.

---

## 9. Signature interactions (implementation specs)

Five named moments; each is an individually schedulable issue. Anything not listed in §3.7/§3.8/this section gets no custom motion, haptic, or sound.

### S1 — "Liftoff" (send)
- **Trigger:** send tap or `Cmd+Enter`.
- **Behavior:** composer text becomes the user bubble; the bubble departs from the composer's exact frame and settles into transcript position (`matchedGeometryEffect` between composer text and bubble); composer clears and refocuses; shimmer placeholder appears beneath.
- **Motion:** `.bouncy(duration: 0.35, extraBounce: 0.1)` — the app's only bouncy spring. **Haptic:** `.impact(weight: .light)`. **Reduce Motion:** crossfade in place, no travel.

### S2 — "Heartbeat" (live-run status strip)
- **Trigger:** any chat is streaming while the user is elsewhere in the app.
- **Behavior:** persistent `TabViewBottomAccessory` strip (48 pt): leading 6 pt dot in `StatusRunning`, label **"{session title} · running · 0:42"** with `.monospacedDigit()`; tap deep-links to that chat with following armed. On completion the dot swaps to success/error glyph and the strip auto-dismisses after 4 s if untapped.
- **Motion:** dot opacity pulse 1.0↔0.4 at 0.8 Hz. **Haptic:** none (the chat surface owns completion haptics). **Reduce Motion:** static dot.

### S3 — "Morph" (AskUserQuestion composer)
- **Trigger:** stream emits an AskUserQuestion tool call.
- **Behavior:** the glass composer morphs into the question card — question text + option chips (or free-text field) — via `glassEffectID` inside the composer's `GlassEffectContainer`; answering morphs it back and the run auto-continues; any draft is preserved and restored.
- **Motion:** system glass morph; chips stagger `.snappy(duration: 0.2)` 40 ms apart. **Haptic:** `.impact(weight: .medium)` on arrival. **Reduce Motion:** crossfade swap, no stagger.

### S4 — "Landing" (run completion)
- **Trigger:** terminal stream chunk (finish or error).
- **Behavior:** caret disappears; the tool-summary header folds in beneath the response (**"Ran 6 tools · 4 edits · +120 −31"**); cost/duration badges fade in on the footer; if a commit/PR resulted, action chips (**"View diff"**, **"Open PR"**) appear in the same fold.
- **Motion:** one `.smooth(duration: 0.3)` grouped fold-in — a single settle. **Haptic:** `.success` or `.error`, exactly once. **Reduce Motion:** fade in, no fold.

### S5 — "Jump to now" (break-follow pill)
- **Trigger:** user scrolls up ≥ 24 pt during streaming.
- **Behavior:** glass capsule above the composer: `chevron.down` + **"Live"** (streaming) or **"{N} new"** (after completion). Tap → smooth scroll to bottom, re-arm following, pill dissolves toward the bottom edge.
- **Motion:** appear `.snappy(duration: 0.2)` scale 0.9→1.0; scroll `.smooth(duration: 0.3)`. **Haptic:** none. **Reduce Motion:** fade; unanimated scroll.

### Anti-delight list (reviewers must reject)
Confetti/particles on merge · typewriter sounds · per-token text animation · animated mascots or illustration art · haptic textures on scroll · parallax backgrounds · rainbow/gradient borders on streaming elements · animated splash screens. Each violates P2 or P6.

---

## 10. App Store presence

| Field | Value | Constraint |
|---|---|---|
| App name | **Open Agents** | ≤ 30 chars |
| Subtitle | **Coding agents in your pocket** | ≤ 30 chars (28) |
| Bundle display name | **Open Agents** | Home-screen label |
| Keywords | `ai,coding,agent,developer,github,pull request,code review,ci,devops,pair programmer` | ≤ 100 chars; iterate post-launch with search data |
| Category | Developer Tools (primary), Productivity (secondary) | |
| Age rating | 4+ | |

**Promotional text (170 chars max):** "Start a coding agent on any repo, watch it work live, answer its questions, and merge the PR — from your phone."

**Description opening paragraph (draft):** "Open Agents puts your coding agents in your pocket. Kick off work on any GitHub repository, watch the agent read, edit, and test your code in real time, unblock it when it has a question, review the diff, and ship the pull request — all from your iPhone or iPad."

**Screenshot list** (6.9" iPhone required set; same scenes reframed for 13" iPad):

1. Chat workspace mid-run: streaming text + tool cards + status strip — caption **"Watch agents work, live."**
2. AskUserQuestion morph with option chips — **"Unblock with one tap."**
3. Unified diff view — **"Review every change."**
4. PR screen with green checks + Squash & Archive — **"Ship from anywhere."**
5. Sessions inbox with running/unread indicators — **"Every session, at a glance."**
6. Background run detail (proof grid + timeline) — **"Trust, verified."**
7. Push notification + Live Activity on Lock Screen — **"Know the moment it finishes."**
8. iPad split view with inspector diff — **"Full workspace on iPad."**

Dark-mode captures with `StatusRunning`/`StatusSuccess` accents visible; no device frames with hands; captions in title case matching the copy above.

**Review compliance checklist:** Sign in with Apple offered alongside Vercel OAuth (guideline 4.8) · in-app account deletion at SCR-47 (guideline 5.1.1(v)) · demo account credentials in App Review notes · privacy nutrition labels per `07-observability.md` data inventory · no private-API usage; export-compliance answer "standard encryption".

---

## 11. Traceability

| This doc | Depends on / feeds |
|---|---|
| §2 navigation, §4 screens | `03-architecture.md` (route types, view-model ownership), `02-api-contract-and-networking.md` (endpoint clients) |
| §5 chat deep dive | `05-streaming-chat-engine.md` (chunk model, coalescing, resume), `04-auth.md` (session carry) |
| §3 design system | DesignSystem package issue in `09-step-by-step-build-guide.md`; snapshot coverage in `06-testing-strategy.md` |
| §4 SCR-46, §10 notes | `07-observability.md` (push fan-out, analytics, privacy labels) |
| §7 accessibility, §6.4 matrix | `06-testing-strategy.md` acceptance criteria |
| §8 onboarding, SCR-01–03, SCR-47 | `04-auth.md` (bearer flow, deletion endpoint) |
| §10 App Store | `08-ci-cd-release.md` (TestFlight, metadata automation) |

Open items inherited from research (resolve before the relevant issue starts): exact SF Symbol names vs SF Symbols 7 app; final diff token dark values after contrast tests; `TabViewBottomAccessory` exact API signature in Xcode 26; WWDC 2026 Liquid Glass guidance deltas.
