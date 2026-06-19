# Topic: Me Screen, Settings & Navigation

Mobile `/m/me` — profile, theme toggle (light/dark/system via `useTheme`), sign-out, and tab navigation.

## STORY-ME-1: First Launch — System Theme
**Type**: short · **Persona**: Alex, OS in Dark · **Goal**: Theme auto-syncs to OS.
### Steps
1. Open → Activity; tap Me (User icon) → `/m/me`.
2. Profile card + theme toggle; "System" selected (default).
3. getSystemTheme() → "dark" → `.dark` on `<html>`; Toaster theme=resolved.
### Variations
- OS Light → no `.dark`. OS schedule → media-query listener re-resolves.
### Edge Cases
- No prefers-color-scheme support → fallback "dark".

## STORY-ME-2: Switch to Light, Navigate, Return — Persistence
**Type**: short · **Persona**: Jordan · **Goal**: Light persists across routes.
### Steps
1. Tap Light (Sun) → setTheme("light"); localStorage "open-agents-theme"="light"; `.dark` removed.
2. UI flips light; Light pill selected.
3. Tap Activity then Me → still Light.
### Edge Cases
- Theme="light" ignores OS switching to dark. Re-select Light → no-op.

## STORY-ME-3: System + OS Flips at Night
**Type**: medium · **Persona**: Casey, night shift · **Goal**: App follows OS schedule.
### Steps
1. Tap System; resolves to current OS (light at 10AM).
2. At 6PM OS → dark; media-query listener fires → applyThemePreference("system") → "dark".
### Variations
- Switch to Light → listener removed; OS change ignored.

## STORY-ME-4: Profile Card — Initials Fallback
**Type**: short · **Persona**: Sarah Chen, no avatar · **Goal**: See name/username/email + initials.
### Steps
1. `/m/me` → useSession; no image → AvatarFallback initials "SC"; name/@username/email truncated.
### Edge Cases
- Not signed in → User icon + "Not signed in". Single-word name → one initial.

## STORY-ME-5: Sign Out — Redirect
**Type**: short · **Persona**: Tyler, shared device · **Goal**: Log out and return to /.
### Steps
1. Tap red "Sign out" (LogOut) → authClient.signOut() → router.replace("/").
2. Next request: getServerSession() null → guard redirects to /.
### Edge Cases
- Signout failure → still redirects. Sign out mid-stream discards chat state.

## STORY-ME-6: Tab Navigation & Active State
**Type**: medium · **Persona**: Sam · **Goal**: Move between tabs with correct active styling.
### Steps
1. Tab bar: Activity (active), New (primary FAB), Me.
2. Tap New → `/m/new`; New active (aria-current).
3. Tap Me → `/m/me` active.
4. Tap Activity → `/m` (exact-match active).
### Edge Cases
- On `/m/chat/[id]` the tab bar is hidden (pushed route); back → `/m`, tab bar reappears. Activity active uses exact `href==="/m"` match (so `/m/chat` doesn't falsely match).

## STORY-ME-7: Theme Toggle Accessibility
**Type**: medium · **Persona**: Alex, VoiceOver · **Goal**: Operate theme buttons via AT.
### Steps
1. Buttons have aria-pressed + aria-label "Switch to {X} theme"; min-h 44px.
2. VoiceOver reads + double-tap activates setTheme; aria-pressed flips.

## STORY-ME-8: System + OS Accessibility Schedule (extended)
**Type**: long · **Persona**: Riley · **Goal**: System theme tracks OS schedule across screens.
### Steps
1. Tap System (light at 5:50PM).
2. Navigate Activity/New/Me.
3. At 6PM OS → dark; listener fires → resolvedTheme dark applied globally on whatever screen.
### Edge Cases
- Manual Light overrides + removes listener. Reopen with "system" → re-resolves on mount. Multiple windows update together.
