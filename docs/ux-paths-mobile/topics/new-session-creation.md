# Topic: New Session Creation (Chat + Repo Modes)

Mobile `/m/new` — task entry, suggestion chips, Chat-only vs With-repo, repo/branch selection, Advanced, CTA gating, create → redirect → auto-send.

## STORY-NEW-1: Quick Chat Session via Suggestion Chip
**Type**: short · **Persona**: Iris, mobile dev · **Goal**: Quickly ask the agent to review a PR.
### Steps
1. `/m/new` → textarea "What should the agent do?"; chips (Fix the failing tests / Review this PR / Add a README…).
2. Tap "Review this PR" → textarea filled + focused.
3. Tap "Start session" (enabled in Chat-only) → buildCreateSessionInput (no repo) → "Creating…".
4. createSession → `{chat.id}`; store `mobile-chat-prefill:<id>`; push `/m/chat/<id>`; auto-send.
### Edge Cases
- Chips horizontally scroll. If sessionStorage cleared between submit and load → prefill lost silently.

## STORY-NEW-2: Empty Repo List (GitHub disconnected)
**Type**: short · **Persona**: Leo · **Goal**: Understand why no repos appear.
### Steps
1. Tap "With repo" → "Connect GitHub in Settings to use repositories."
2. No repo list; "Start session" disabled (repoMode && !repoSelection).
3. Navigate to Me to connect, or back out.
### Variations
- GitHub connected, zero repos → "No repositories found for this installation." CTA disabled.

## STORY-NEW-3: Select Existing Branch from Private Repo
**Type**: medium · **Persona**: Maya, backend · **Goal**: Session on a private prod repo.
### Steps
1. "With repo"; first installation auto-selects; repos load.
2. Tap "my-production-api" (🔒) → repoCandidate set.
3. BranchSelectorCompact loads branches; defaults to "New branch (auto)".
4. Open selector → pick "main" → branch set, isNewBranch=false.
5. Type task; (Advanced: auto-commit default on, auto-PR gated).
6. "Start session" (enabled) → payload {repoOwner, repoName, branch:"main"} → redirect + auto-send.
### Edge Cases
- Repo defaults still loading → "Loading…" until data arrives.

## STORY-NEW-4: New Auto-Generated Branch
**Type**: medium · **Persona**: Devon · **Goal**: Session on a new branch for a feature.
### Steps
1. Selected "frontend-app"; open branch selector → "New branch (auto-generated)".
2. onChange(null, isNewBranch=true) → display "New branch (auto)".
3. Type task; Advanced: enable auto-commit + auto-PR.
4. "Start session" → payload isNewBranch=true; server generates branch name; redirect + auto-send.
### Variations
- Never opening the selector → auto-selects "New branch (auto)" on mount.

## STORY-NEW-5: GitHub Not Connected
**Type**: short · **Persona**: Alex · **Goal**: Realize GitHub must be connected.
### Steps
1. "With repo" → "Connect GitHub in Settings…"; installations SWR key null (no call); CTA disabled.
2. Connect later → repos populate on return.

## STORY-NEW-6: Manual Task → Create → Prefill Redirect
**Type**: medium · **Persona**: Jordan · **Goal**: Carry a typed task through creation.
### Steps
1. Type "Optimize the image loading pipeline"; pick repo + branch.
2. "Start session" → createSession → `{chat.id}`; set `mobile-chat-prefill:<id>`; push.
3. Chat reads prefill → auto-sends as first message.
### Edge Cases
- Empty task → `if (task)` skips prefill. Double-tap guarded by isSubmitting.

## STORY-NEW-7: Advanced Toggles (auto-commit / auto-PR gating)
**Type**: medium · **Persona**: Casey · **Goal**: Precise automation control.
### Steps
1. Expand Advanced → "Auto commit & push" (on) enables "Auto create PR".
2. Toggle auto-PR on → payload autoCommitPush=true, autoCreatePr=true.
### Variations
- Disable auto-commit → auto-PR disabled + forced false in buildCreateSessionInput.
### Edge Cases
- Chat-only mode → both toggles disabled, no effect.

## STORY-NEW-8: Repo State Reset on Mode Switch
**Type**: short · **Persona**: Sam · **Goal**: No stale repo state when switching to Chat-only.
### Steps
1. "With repo" with repo+branch selected.
2. Tap "Chat only" → clears repoCandidate/branch/isNewBranch; repo picker hidden; Advanced disabled.
3. "Start session" → plain chat.
### Edge Cases
- Task text preserved across the switch; only repo state cleared.

## STORY-NEW-9: Loading & Installation Auto-Select
**Type**: short · **Persona**: Priya, multi-org · **Goal**: Observe auto-select while repos load.
### Steps
1. "With repo" → "Loading repositories…".
2. Installations land → first auto-selected → repos fetched → list populates.
### Edge Cases
- No visible installation switcher in UI → only first installation's repos shown. revalidateOnFocus disabled.

## STORY-NEW-10: CTA Disable Logic (guard vs silent chat fallback)
**Type**: medium · **Persona**: Taylor · **Goal**: Understand when "Start session" is disabled in repo mode.
### Steps
A. With-repo, no repo picked → CTA disabled (`repoMode && !repoSelection`); handleSubmit also guards (`if (repoMode && !repoSelection) return`).
B. Repo picked + branch auto-set → repoSelection valid → CTA enabled.
C. Browsing branches (still "New branch (auto)") → enabled.
D. Branch fetch fails → no auto-select → repoSelection null → CTA disabled.
### Edge Cases
- buildCreateSessionInput returns a chat-only payload when `!repo`; the handleSubmit guard prevents the silent fallback.

## STORY-NEW-11: Multi-Installation (future UX gap)
**Type**: long · **Persona**: Morgan, repos across orgs · **Goal**: Use a repo from the 2nd org.
### Steps
1. First installation auto-selected; desired repo is in another org.
2. CURRENT: no installation switcher → cannot reach other org repos from this screen.
3. DESIRED (not implemented): an installation switcher above the repo list.
### Edge Cases
- App not installed on the target org → repo never appears.
