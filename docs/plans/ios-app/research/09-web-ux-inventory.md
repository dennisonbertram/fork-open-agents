# Web UX Inventory & Lessons — Ground Truth for the iOS App Plan

Sources read in full: `docs/ux-paths/catalog.md` (149 stories) + all 12 files in `docs/ux-paths/topics/`, `docs/ux-paths/discovery.md`, `docs/ux-walker/latest-report.md` + `issues-filed.md` + `live-unauth-walk.md`, `docs/product-review/2026-05-31/report.md`, and the live route/component tree under `apps/web/app` and `apps/web/components` (June 2026 state of branch `feat/agents-phase6-authored-tools`).

**Dating caveat:** the walker report is 2026-06-06/07 and the product review 2026-05-31. Several filed issues have since been fixed in code — verified directly: session title field now exists (`apps/web/components/session-starter.tsx:390-394`, fixes #182), settings nav is now grouped Account/Tools/Insights/Admin (`apps/web/app/settings/nav-items.ts:36-124`, fixes part of #226), the repo page is now a full dashboard with Overview/Agents/Activity/PRs/Issues/Actions windows (`apps/web/app/repos/[owner]/[repo]/page.tsx:14-22`, addresses #228), and the public profile `/u/[username]` route is wired (`apps/web/app/u/[username]/page.tsx:1` re-exports `apps/web/app/[username]/page.tsx`, addresses #185). New settings surfaces shipped since the catalog: `/settings/agents` (per-role agent config), `/settings/skills` (AI-assisted skill authoring), `/settings/runtime-profiles` (user-default profiles), `/settings/usage` (standalone page). Treat the catalog as the flow inventory and the current code as the source for surfaces.

---

## 0. Route map (actual page tree, `apps/web/app`)

| Route | Purpose |
|---|---|
| `/` | Landing (signed-out hero) → redirects to `/sessions` when authenticated (`apps/web/app/page.tsx:6-9`) |
| `/get-started` | 2-step onboarding: Vercel account → Connect GitHub (+ GitHub App install detour); `?step=github` is the reconnect entry point. No model/sandbox step. |
| `/deploy-your-own` | Self-host guide: env-var list + one deploy button (`apps/web/app/deploy-your-own/page.tsx:5-18`) |
| `/sessions` | Session inbox: sidebar with Active/Archive tabs, repo-grouped sessions, quick-create; empty state "Select a Session" |
| `/sessions/[sessionId]` | Redirects to first chat |
| `/sessions/[sessionId]/chats/[chatId]` | **The workspace** — chat + composer + right git panel (Files/Diff/Changes/PR tabs) + runtime tools + Verified Build panel. One 5,076-line client component (`session-chat-content.tsx`) |
| `/codespace/[sessionId]` | In-browser VS Code (code-server on sandbox port 8000) |
| `/shared/[shareId]` | Public read-only chat view, no auth required; live-polls while streaming |
| `/repos/[owner]/[repo]` | Repo dashboard (Overview, Agents, Activity, PRs, Issues, Actions windows) |
| `/repos/[owner]/[repo]/agents` (+ `/agents/[agentId]`) | Per-repo background-agent list + run history |
| `/background-runs/[runId]` | Background-run detail: proof grid, live timeline (2s poll), outputs, debug IDs |
| `/[username]` and `/u/[username]` | Public usage "wrapped" profile (`getPublicUsageProfile`) |
| `/[username]/[repo]` | Repo deep-link → auto-creates a session on the default branch |
| `/settings/{profile, preferences, connections, agents, models, composio, skills, background-agents, runtime-profiles, usage, leaderboard, admin}` | Settings pages; `/settings/accounts` redirects to connections (`apps/web/app/settings/accounts/page.tsx:3-4`) |

API surface an iOS client would consume (~120 routes under `apps/web/app/api/*`): sessions CRUD + chats/messages/fork/share/read, chat streaming (`/api/chat`, `/api/chat/[chatId]/stream`, `/stop`), files (`/files`, `/files/content`), diff (`/diff`, `/diff/cached`, `/diff/patch`), git (`branch`, `commit`, `discard`, `status`, `pr` + `pr/{generate,merge,close,readiness}`, `deployment-url`, `generate-commit-message`), sandbox (`status`, `extend`, `reconnect`, `snapshot`, `activity`), sandbox-services + logs, dev-server, code-editor, browser-runs, managed-runtime profiles + drafts + test, observability, skills, background agents + runs + readiness + test + webhook, composio (connect/status/toolkits/connected-accounts), settings (preferences/models-variants/agents/skills/composio/runtime-profiles/repo-overrides), inference-profiles + test, models, usage + rank, transcribe (voice), generate-title, generate-pr, github (orgs/installations/branches/connection-status/user/create-repo), vercel (repo-projects, env), harness/verified-build runs (approve/cancel/repair/events/trace/artifacts), shared markdown/status.

---

## A. Feature inventory (every user-facing capability)

Priority key: **CORE** = must exist in a v1 iOS app for the product to make sense; **SECONDARY** = expected soon after; **POWER** = power-user/operator, fine to defer or leave on web.

### A1. Onboarding & auth

| Capability | Priority | Notes / source |
|---|---|---|
| Sign in with Vercel OAuth (better-auth) | CORE | Only sign-in method. STORY-001; landing CTA. iOS needs an OAuth web-auth-session flow. |
| 2-step get-started (Vercel ✓ → Connect GitHub OAuth → GitHub App install detour) | CORE | STORY-002/010. `needsOnboarding` gate = has GitHub account && has installation. |
| GitHub reconnect (`?step=github`, `next=` preserved & sanitized) | CORE | STORY-005/011; token expiry is common; surfaced inline by repo selector (`reconnectRequired`). |
| GitHub App install for an org; selected-repos vs all-repos; admin-approval `request_sent` states | SECONDARY | STORY-008/110; badges Globe/ListFilter/Ban. |
| Connections page: GitHub connect/re-auth/disconnect (confirm dialog), Vercel "Managed" read-only card | SECONDARY | STORY-006/007/112; Vercel cannot be disconnected. |
| Sign out (avatar dropdown / settings sidebar; revokes Vercel token best-effort) | CORE | STORY-009. |
| Admin global token revoke (GitHub / Vercel, destructive) | POWER | STORY-012/113; gated `isAdmin`, non-admin gets 404. |

### A2. Session management

| Capability | Priority | Notes |
|---|---|---|
| New Session dialog with **New Chat** (no repo) vs **Start Session** (repo) toggle | CORE | STORY-013/014. New Chat = sandbox-free brainstorm chat. Known confusion point (P2, product review). |
| Repo picker: org dropdown, debounced search, private-lock icon, "Manage access" escape hatch, first-25 cap | CORE | STORY-014. |
| Branch picker: existing branch search (50-limit) or "New branch (auto)" (`mb/3f9a2c10`-style) | CORE | STORY-015. |
| Optional session title ("Session name (optional)"); blank → random city name | CORE | `session-starter.tsx:390-394`; `resolveSessionTitle`. |
| Per-session auto-commit/push + auto-create-PR overrides (PR gated on commit toggle) | SECONDARY | STORY-016/062; quick-create path skips these (walker fail STORY-062). |
| Vercel project sync selection at create (env vars from linked project; required choice when multiple match) | SECONDARY | STORY-017; only when `authProvider === "vercel"`. |
| Sidebar inbox: repo-grouped sessions, Active/Archive tabs with counts, unread/streaming indicators, PR status icons | CORE | STORY-019-021; `components/inbox-sidebar.tsx`. |
| Per-repo quick-create (Plus) and create-from-branch (GitBranch) hover actions | SECONDARY | STORY-019; always visible on mobile. |
| Rename session (inline, optimistic; empty rejected silently) | CORE | STORY-025; rename doesn't propagate to open header/tab title (#186). |
| Archive / unarchive; archiving routed session bounces to `/sessions` | CORE | STORY-021. |
| Repo deep-link `/{owner}/{repo}` auto-creates a session | SECONDARY | STORY-023. |
| Rate limits: session create 10/min, bot-protection 403 | CORE (handle errors) | STORY-013 edge cases. |

### A3. Chat & agent interaction (the heart of the product)

| Capability | Priority | Notes |
|---|---|---|
| Streamed agent runs: reasoning/ThinkingBlock → collapsible tool cards (Read/Edit/Write/shell) with pending→success/error states, inline stdout | CORE | STORY-027/035; the product review called this the single best-loved surface — protect it. |
| Stop button (red square) mid-stream; partial output preserved | CORE | STORY-028. |
| **Stream resume after reload/visibility change** (`activeStreamId` recovery, honest elapsed timer from last user msg) | CORE | STORY-029; `stream-recovery-policy.ts`. Critical for mobile where the app is backgrounded constantly. |
| Per-chat model switcher (search combobox, grouped by provider, variants tagged, inference profiles shown "via {profile}", missing-model kept visible) | CORE | STORY-030; walker found mouse-click select broken (Enter worked) — high bug, lesson below. |
| Multiple chats per session sharing one sandbox; chat tabs, rename, close-with-confirm, independent streams | SECONDARY | STORY-034. |
| Fork conversation from an assistant message → new chat "Fork of …" inheriting model/profile/tools | SECONDARY | STORY-031. |
| Edit-and-resend a user message, discarding everything after; or delete-from-here | SECONDARY | STORY-036. |
| Inline **AskUserQuestion**: composer morphs into question UI; answer → run auto-continues | CORE | STORY-037. This is the #1 push-notification + quick-reply candidate on mobile. |
| Attachments: image picker (image-only), paste-image, long-paste auto-converts to `.txt` chip; send enabled by attachments alone | CORE | STORY-032; picker being image-only is a disclosure gap (low). |
| Voice dictation → `/api/transcribe` (ElevenLabs) → text inserted in composer | CORE for mobile | STORY-033; natural-fit on iOS (or use native dictation). |
| Tool-call summary bar (counts of reads/edits/shell/commit) on long responses | CORE | STORY-039. |
| Per-message cost badge, duration badge, model pill; auto-generated chat title | CORE | Product review: cost badges without context caused anxiety — needs tooltip/rollup. |
| Slash commands dropdown, `@` file-mention dropdown (depth-sorted, Tab/Enter select) | SECONDARY | STORY-041; `slash-command-dropdown.tsx`, `file-suggestions-dropdown.tsx`. |
| Snippet-comment: select text in file viewer → "Comment" popover → SnippetChip in composer | SECONDARY | STORY-048; only reachable from file viewer, not diff view (walker medium). |
| Archived chat = fully read-only (all inputs disabled, "Unarchive to resume" notice) | CORE | STORY-038. |
| Composer toolbar today: Paperclip, Mic, model pill, `Tools:` Composio selector, runtime-mode pill, workflow picker, Send/Stop | CORE | `session-chat-content.tsx:4721-4806`. Walker #221: 7 competing controls — iOS must NOT replicate this row; collapse into overflow. |
| Edit-approval mode: Edit tool card auto-shows diff + Approve/Deny buttons when `approvalRequested` | CORE | STORY-042; second-best push/quick-action candidate. |
| Pinned TODO/plan panel, task-group views (subagent delegation) | SECONDARY | `pinned-todo-panel.tsx`, `task-group-view.tsx`, `goal-ledger-panel.tsx`. |
| In-app alerts + sound when a background chat finishes (tab-local only; no web push) | CORE gap | `hooks/use-background-chat-notifications.tsx:58-61`; prefs `alertsEnabled`/`alertSoundEnabled` (`lib/db/schema.ts:1522-1523`). |

### A4. Files, diff, git, PR

| Capability | Priority | Notes |
|---|---|---|
| File tree (git ls-files + untracked), expand/collapse, open file tabs with syntax highlighting, refresh | CORE | STORY-040; walker critical #180: duplicate path crashed the whole workspace — bound failures per panel. |
| File viewer: Raw/Pretty markdown toggle, copy button, empty-file state, mobile bottom-Drawer variant | CORE | STORY-047; mobile drawer already exists (`workspace-file-viewer.tsx` uses `useIsMobile`). |
| Diff list with per-file +/- counts, staging badges, renamed-file handling, generated/lock-file bodies hidden | CORE | STORY-043/044. |
| Unified/split diff toggle (split hidden + forced unified on mobile), default from preferences | CORE | STORY-043; mobile already forces unified — iOS should default unified. |
| Diff scope: **Uncommitted** vs **All changes (branch vs base)**, "vs origin/main" footer | CORE | STORY-044/065. |
| Cached diff offline: amber StaleBanner "Viewing cached changes — sandbox is offline (saved …)" | CORE | STORY-045; the file viewer has NO equivalent fallback (walker medium F-STORY-050-01) — iOS should cache both. |
| Discard one file / discard all uncommitted (confirm dialogs) | SECONDARY | STORY-065. |
| Download full session diff as `.diff` (live sandbox only) | POWER | STORY-046; desktop-ish. |
| Commit & Push from Changes tab: optional message, AI-generate message, success pill, `data-commit` chat message with GitHub link | CORE | STORY-052. |
| Base-branch guard: "On base branch — create a new branch first" + Create branch button | CORE | STORY-053. |
| PR tab locked until committed (tooltip explains); Create PR inline with AI-generated title/body, draft option, auto-merge toggle | CORE | STORY-054/055. |
| PR status in header (`#N` link, open=green/merged=purple/closed=red), Vercel preview button (green/amber-pulse building/red failed) | CORE | STORY-056. |
| Inline merge panel: readiness polling, CheckRunsList, merge method dropdown (squash/merge/rebase), delete-branch toggle, **Squash & Archive** | CORE | STORY-057. |
| Force-merge past checks (double-click confirm in 5s) | POWER | STORY-058. |
| Merge-conflict panel + "Fix conflicts" → agent resolves; "Fix errors" → agent repairs failing CI | SECONDARY | STORY-059. |
| Close & Archive PR without merge | SECONDARY | STORY-060. |
| Global auto-commit/auto-PR preferences + per-session override + optimistic auto-commit status (staggered 3/8/16s refreshes, 30s fallback) | SECONDARY | STORY-061-064; auto-PR skips silently (lesson below). |

### A5. Sandbox & dev services

| Capability | Priority | Notes |
|---|---|---|
| Sandbox lifecycle UI: Creating → Active → Hibernating → Paused → Restoring badges; tools disabled with reason tooltips | CORE | STORY-026/072/073; walker: no explicit provisioning badge originally (#186). iOS should make lifecycle a first-class status surface. |
| Resume hibernated sandbox (`PUT /api/sandbox/snapshot`), reconnect handling, resume-race tolerance | CORE | STORY-073; mobile sessions will hit hibernation constantly. |
| Start/stop managed dev server (framework auto-detect Next/Vite/Astro, 120s timeout), open `*.vercel.run` preview URL | SECONDARY | STORY-066/071; opening preview in Safari is fine on iOS. |
| Dev-server logs (redacted) in new tab | SECONDARY | STORY-068. |
| Browser check (agent-browser smoke: open/wait/snapshot/network/screenshot; fails on ≥400 Document) | SECONDARY | STORY-069/070. |
| Runtime Inspector panel: session runtime mode, services health, last-5 browser checks, event timeline | POWER | STORY-075. |
| In-browser code editor (code-server, port 8000) at `/codespace/[sessionId]` | POWER | STORY-074; walker #189: fails 500 when profile lacks code-server. Desktop-only; skip on iOS v1. |
| Classic ↔ Managed runtime switch + managed-profile picker in composer | SECONDARY | STORY-076/077; jargon hazard (P1). |

### A6. Managed runtime profiles & Verified Build

| Capability | Priority | Notes |
|---|---|---|
| Agent-drafted runtime profile card (setup/verification commands, repo signals, questions-for-review) auto-saved as draft | POWER | STORY-078; walker #181: model doesn't reliably call the tool unprompted (prompt-routing root cause). |
| Test draft / Run setup + test against live sandbox; per-command pass/fail evidence, exit codes, durations | POWER | STORY-079. |
| Approve (→ session-scoped saved profile), Request changes (auto-appends failure evidence), Discard | POWER | STORY-080-082; approval scope hardcoded to "session". |
| Manage profile dialog: edit commands/ports/tools, re-test, stale-evidence ("Untested") notices, delete → fallback to built-in | POWER | STORY-083-085; walker #191: control didn't render. |
| `/settings/runtime-profiles`: user-default reusable profiles + built-ins | POWER | `apps/web/app/settings/runtime-profiles/page.tsx:28-31`. |
| Verified Build panel (ShieldCheck): status badge, Timeline/Workcells/Evidence/Ops tabs, plan Approve/Cancel/Repair, **"PR gated by evidence"** CTA unlocked on Go+completed | POWER | STORY-136-138; walker #190: not triggerable from chat, confusable with managed-runtime-proof card. The **plan-approval** step is a mobile push/approval candidate even if the rest stays web. |

### A7. Repo dashboard, background agents, run monitoring

| Capability | Priority | Notes |
|---|---|---|
| Repo dashboard `/repos/[owner]/[repo]`: Overview, Agents, Activity, PRs, Issues, Actions windows | SECONDARY | `page.tsx:14-22`; failure-isolated parallel fetches. |
| Background-agent CRUD at `/settings/background-agents`: name, trigger (PR / Schedule cron / Deployment status / Issue / Error webhook), conditions (actions/branches/labels/environments/severities), instructions, output mode (**None / Ready PR only**), check command, enable toggle | SECONDARY | STORY-089-095; permissions auto-derived from output mode (no picker); walker #187 (button submit dropped `triggers[]`), #184 (no delete UI), #183 (webhook URL never shown), #229 (needs stepper + relevance-gated fields). |
| Readiness gating panel (feature flag, OAuth, App, sandbox runtime, allowlist) with refresh | SECONDARY | STORY-090. |
| Manual "Test" dispatch → redirects to run detail | SECONDARY | STORY-096. |
| Run detail `/background-runs/[runId]`: proof grid (Status/Trigger/Repo/Ref/Sandbox/Permissions/Checks/Output/Duration/Cost), live timeline (2s poll while queued/running), CommandOutput stdout/stderr, Outputs panel with "Open" PR/comment links, Debug IDs (run/request/workflow/idempotency), back link, ownership 404 | **CORE for mobile** | STORY-139-149. This read-mostly monitoring surface is the single best mobile fit in the product. |
| Composio phase-grants for background agents | NOT SHIPPED | Schema-only, "planned for v1.5" (catalog Reality Note 4) — do not plan iOS UI for it. |

### A8. Settings (current nav: Account / Tools / Insights / Admin — `nav-items.ts:36-124`)

| Page | Capability | Priority |
|---|---|---|
| Profile | Read-only Vercel-synced identity; usage snapshot card, rank line, contribution heatmap with day/range filtering, agent-split/top-models/code-churn lists | SECONDARY |
| Preferences | Theme (per-browser), default sandbox (Vercel only), default managed-runtime profile, default diff mode, auto-commit/auto-PR (dependency-gated), alerts + nested alert-sound, public usage profile toggle + copy URL, global skill refs add/remove | CORE (subset: diff mode, auto-commit/PR, alerts) |
| Connections | See A1 | CORE |
| Agents | Per-role view (Main + explorer/executor/design subagents) — model/instructions/tools per role; links to Background agents | SECONDARY (new since catalog) |
| Models | Default model + Subagent model comboboxes; Custom Model Set shortlist (curates the ~200-model picker); Inference Profiles (own Anthropic key, encrypted, Test→Verified/Failed badge); Model Variants (base model + provider-options JSON, built-ins badged) | CORE (default model) / POWER (profiles, variants) |
| Composio | Status card (Configured / Not configured / Invalid key / unreachable), profiles (name + toolkit slugs + auth-config/account ID mappings + Workbench + in-chat-connection switches), Global Agent Defaults (Main/Explorer/Executor/Design selects + allow-chat-override), Connections (auth-config ID + alias → hosted OAuth link) | POWER |
| Skills | Author reusable skills by hand or AI-generated draft; enable per chat | POWER (new) |
| Background agents | See A7 | SECONDARY |
| Runtime profiles | See A6 | POWER |
| Usage | Standalone usage page (tokens/cost/messages/tool calls, heatmap, pies, last-4-weeks insights: tracked PRs, merge rate, largest turn, avg tokens/turn, tool calls/turn, cache-hit ratio) | SECONDARY |
| Leaderboard | Org-domain-gated ranking, Today/7d/All-time toggle, "Your rank: #N of M", own row highlighted | SECONDARY |
| Admin | Destructive revoke-all-tokens panels | POWER |

### A9. Sharing & observability

| Capability | Priority | Notes |
|---|---|---|
| Create/copy/revoke read-only share link per chat (`/shared/{nanoid(12)}`); env-content redaction server-side | CORE | STORY-126/129; product review: share icon was undiscoverable, no URL shown pre-create, no scope copy (P2/P3). |
| Public shared view: no chrome, repo/branch/PR badges, owner attribution, collapsible reasoning/tools, mobile-safe overflow; owner sees "You own this" banner | CORE | STORY-127; **already mobile-tested** — recipients open these on phones today. |
| Live shared view: 3s status poll, playful status word, elapsed timer | SECONDARY | STORY-130. |
| Markdown export `/api/shared/[shareId]/markdown` (YAML frontmatter, redacted) | SECONDARY | STORY-131; pairs with iOS share-sheet. |
| Public usage profile `/u/{username}` (+ `?date=` filters) | SECONDARY | A8 Profile data, public. |

---

## B. Top 20 UX lessons / pitfalls the iOS app must not repeat

From the walker report (10+15 issues), product review (P1–P5), and the live unauth walk — ordered by severity × relevance to a new client.

1. **Speak user language, not builder language (P1, all 5 journeys).** "Classic vs Managed runtime / coordinator / managed-worker / proof bundle", "session vs chat", "inference profiles", "Composio", "sandbox" all shipped unexplained. iOS copy must use task language ("Code review checks", "Your own API key") with progressive disclosure.
2. **One crash must never take down the workspace (#180).** A duplicate file path crashed FileTree and the error escaped its boundary, killing the whole chat page until reload. On iOS: isolate every panel; file tree failure ≠ chat failure.
3. **Never leave the composer dead with no retry (#181).** A stuck run left the composer permanently disabled across reloads. Tie input enablement to observable run state; always provide error + retry that survives relaunch.
4. **Silent API failures are the worst failure (#187).** Create-form 400/403s surfaced nothing — the user thinks they created an agent and they didn't. Every mutating call needs a visible success/failure signal.
5. **Primary tap targets must work by tap (STORY-030).** Model-picker mouse-click didn't persist selection (only keyboard Enter did). On iOS there IS no keyboard fallback — test the touch path.
6. **Label every critical action (P2).** Share was one of ~5 unlabeled icon buttons; users concluded the feature didn't exist. iOS: text labels or context menus, not bare icons.
7. **Make invisible dependencies visible (P2).** "Auto create PR" greyed out with no hint it requires "Auto commit & push"; PR tab locked until commit (good — it has a tooltip). Always say *why* something is disabled (the web's disabled-reason-tooltip pattern is the good example to copy: `runtimeToolsDisabledReason`, STORY-072).
8. **Show progress during agent runs (P3).** 26s of silence read as "broken". iOS: live activity/elapsed timer/status words from the first second (web's later pattern: thinking indicator + playful shared-view status words).
9. **Cost needs context (P3, #222).** Bare "$0.34" badges create anxiety. Provide per-session rollup and "what this means" affordance; persistent cost chip was the recommended fix.
10. **Branch safety must be explicit (P3, #223).** "main default" terrified users. Say "a new branch `mb/xxxx` will be created — main is untouched", show exact branch names, guide commit-before-PR.
11. **Don't waste the empty state (P4, #217).** "Select a Session" orients nobody. First-run should land on a guided composer with starter prompts ("pick a repo and describe what to build").
12. **Don't fork two unauthenticated behaviors.** Web bounces `/sessions` silently to `/` but inline-gates `/settings` (live-unauth-walk #2/3). iOS deep links (shared chats, run URLs) must show "sign in to view this" with the destination preserved.
13. **Distinguish "New Chat" vs "Start Session" with one-line descriptions (P2, recurred 3 journeys, #218).** If iOS keeps both modes, describe them ("Chat only — no repo" vs "Agent works on a repo in a sandbox"); don't reset repo selection when toggling (bug, P5).
14. **Degrade gracefully offline/hibernated — everywhere, consistently.** Diff view has a cached fallback + amber banner; file viewer shows bare "Sandbox not initialized" (walker mediums F-STORY-050-01/048-01); disabled Download has no tooltip. iOS rule: every sandbox-dependent surface needs cached content + a resume CTA. This is doubly important on a phone.
15. **State changes must propagate everywhere (#186).** Rename updated the sidebar but not the open header/tab. Single source of truth for session metadata.
16. **Don't render irrelevant form fields (#92/#229).** All trigger-condition fields showed for every trigger type. Use stepper/relevance-gating on small screens.
17. **~200 ungrouped models is hostile (#220, P5).** Ship recommended defaults, curate (Custom Model Set exists — surface it), show cost/context hints; hide codename models.
18. **Auto-actions must report when they skip.** Auto-PR silently skips on unpushed branch / "No changes detected" (`isSkippablePrContentError`, Reality Note 11). Mobile users acting on trust need a "skipped because X" event.
19. **Confirm destructive, but always offer escape.** Disconnect dialog had no close X (`showCloseButton={false}`, Reality Note 9); Composio delete was single-click no-confirm (walker medium). Standardize: confirm destructive ops, cancel always available.
20. **Webhook/derived values users need must be copyable (#183, #100).** Webhook URL generated but never displayed; permissions derived silently from output mode (and silently flip on edit). Show derived effects ("Ready PR ⇒ this agent can write code & open PRs") and make IDs/URLs copyable.

Bonus lesson for the protected strength: the **in-flight agent run display** (tool cards, "Pondered · 26s · 2 tool calls · 1 file changed", diff, cost, auto-rename) was the most-praised surface in every review. The iOS app's success hinges on reproducing this run-watching experience natively and excellently.

---

## C. Desktop-ish flows vs flows that shine on mobile

### Inherently desktop-ish (keep on web; link out or read-only on iOS)
- **Code-server editor** (`/codespace`) — full VS Code in browser; impossible/pointless on iPhone.
- **Side-by-side split diffs** — web already hides the toggle and forces unified on mobile (STORY-043 edge case); iOS = unified only.
- **Download `.diff` for `git apply`** — local-checkout workflow.
- **Managed-runtime profile authoring/editing** (multi-command editors, ports, evidence panels) and **Verified Build evidence forensics** (Workcells/Trace/Ops tabs) — dense operator consoles.
- **Composio profile setup** (pasting `ac_…`/`ca_…` IDs, toolkit slug text-entry) — copy-paste-heavy configuration.
- **Background-agent authoring** (cron strings, condition lists, instructions) — creation is desktop-ish; *toggling/monitoring* is mobile-friendly.
- **Self-host deploy, admin token revocation, inference-profile/variant JSON editing.**
- **Deep multi-file diff review of large refactors** — possible but cramped; iPad OK, iPhone = skim + approve.

### Flows that shine on mobile (the iOS app's reason to exist)
- **Agent run monitoring**: watching the stream, tool-call cards, elapsed time, completion — read-mostly, glanceable, already the product's best surface.
- **Approvals & unblocking**: AskUserQuestion answers (STORY-037), Edit approve/deny (STORY-042), Verified Build plan approval (STORY-137), merge confirmation. Short, decision-shaped interactions.
- **Quick replies / next prompt**: short follow-ups ("yes, do it", "also update the tests"), voice dictation (STORY-033 — better on iOS than web).
- **Kicking off work**: pick repo → speak/type a request → go; repo quick-create already exists per-repo in the sidebar.
- **Session inbox triage**: unread/streaming indicators, PR status icons, archive swipe — a classic mobile inbox.
- **PR shipping on the go**: checks status, preview link, Squash & Archive once green; "Fix errors/conflicts" hands work back to the agent rather than requiring a human editor.
- **Background-agent run feed**: proof grid + timeline + failed-run stderr (`/background-runs/[runId]` already polls at 2s and renders well in a narrow column).
- **Reading shared chats**: recipients already open `/shared/...` links on phones signed-out (STORY-127 persona literally does this); the public page is mobile-safe (`overflow-x-hidden`).
- **Sandbox resume**: one-tap "Resume sandbox" when returning to paused work.
- **Usage glances**: tokens/cost/rank — wrapped-style stats are share-bait.

### Mobile-specific friction to design around
- Sandbox hibernation (~30 min inactivity) means a phone user almost always returns to a Paused sandbox → resume must be one tap and cached views must carry the gap (lesson B14).
- Stream recovery on app foregrounding must be as robust as the web's reload recovery (STORY-029) — iOS backgrounding makes this the common case, not the edge case.
- The composer's 7-control toolbar (#221) cannot fit; fold model/tools/runtime into a settings sheet.

---

## D. What the web app does NOT have that mobile uniquely enables

The web app's only notifications are **tab-local toasts + a sound** (`use-background-chat-notifications.tsx`; prefs `alertsEnabled`/`alertSoundEnabled`). There is no service-worker web push, no email, no Slack output (background-agent output modes are None/Ready-PR only). Everything below is net-new value, not parity:

1. **Push notifications** (APNs) for the events users currently poll for:
   - Agent run finished / failed / stopped (chat-level; the in-app alert hook proves the event exists).
   - **AskUserQuestion pending** — agent is blocked on the user; highest-value push + inline quick-reply (notification actions with the question options).
   - **Edit-approval requested** (approval-mode tool calls) — approve/deny from the notification.
   - Auto-commit landed / auto-PR opened / **auto-PR skipped** (with reason — fixes lesson B18).
   - PR checks green / failed; merge completed; Vercel preview ready/failed.
   - Background-agent run started/succeeded/failed (incl. error kind); webhook-triggered runs.
   - Sandbox about to hibernate ("Still working? Keep it warm") / sandbox provision failed.
   - Verified Build plan awaiting approval; Go/No-Go reached.
   - Note: **no push infrastructure exists server-side** — the plan must include a device-token registry + event→notification fan-out (the session-events/observability tables already capture the source events).
2. **Live Activities / Dynamic Island** for an in-flight agent run: elapsed time, current tool ("Editing auth.ts…"), tool-call count, files changed — exactly the data the web's tool-summary bar and "Pondered · 26s" badge already compute. Also great for background-agent runs and PR-check progress.
3. **Widgets**: session inbox (running/unread counts), "latest run" status, usage/cost this week, leaderboard rank, background-agent health per repo.
4. **Share-sheet integration**: share a chat's read-only link or markdown export (`/api/shared/[shareId]/markdown`) anywhere; *receive* shares too — share a screenshot/log/text from any app into a new prompt (web's paste-to-attachment flow, but system-wide).
5. **Native voice**: hold-to-talk prompting using on-device dictation or the existing `/api/transcribe` path — strictly better ergonomics than the web mic button.
6. **App Intents / Shortcuts / Siri**: "Start an agent on {repo} to …", "What's my agent doing?", run-status query; Spotlight indexing of sessions.
7. **Universal links**: `/shared/[shareId]`, `/background-runs/[runId]`, `/sessions/...` open in-app with auth (fixing the web's silent-bounce deep-link problem, lesson B12).
8. **Biometric session security** (Face ID gate) — relevant since sessions can expose repo code and env-derived content.
9. **Offline-first reading**: persist chat transcripts, cached diffs, and run timelines locally so a subway read works; the web already has the cached-diff pattern to generalize.
10. **Haptics + glanceable status**: success/failed run haptic patterns; status pill semantics (green/amber/red lifecycle) map cleanly to native affordances.

---

## Open questions for the plan author

1. **Auth**: better-auth with Vercel OAuth only — is an embedded `ASWebAuthenticationSession` against the existing `/api/auth/*` flow acceptable, and will cookie/session-based API auth work for a native client, or does the backend need token issuance? (Auth research brief should answer; nothing in the UX docs covers native clients.)
2. **Streaming transport**: chat streaming is the AI SDK data-stream protocol over `/api/chat` + resume via `/api/chat/[chatId]/stream` — confirm a Swift client strategy (SSE parsing vs polling persisted messages like the shared view does at 3s).
3. **Push fan-out**: which server events become APNs pushes in v1, and where does the device-token table live? (No push infra exists today.)
4. **Scope call**: does iOS v1 include session *creation* with the full repo/branch/Vercel-sync flow, or start with monitor+reply+approve+ship against sessions created anywhere (deep-link `/{owner}/{repo}` auto-create is a cheap creation shortcut)?
5. **Which fixed-vs-open walker issues still stand**: #180 (file-tree crash), #181 (draft card), #187 (create-form payload), #189/#190/#191/#192 statuses should be re-verified at implementation time; several #182/#226/#228/#185-class items are already fixed in code.
6. **Composio/background-agent authoring on iOS**: recommend explicitly out-of-scope for v1 (desktop-ish, mid-redesign per #224/#229, and phase-grants are schema-only) — confirm.
