# Spike: Repository settings redesign (card-group settings system)

**Status:** research spike (design + plan, no implementation yet)
**Tracking issue:** [#420](https://github.com/dennisonbertram/fork-open-agents/issues/420)
**Mockups:** [`repo-settings.html`](./repo-settings.html), [`loops-dashboard.html`](./loops-dashboard.html)
**Design reference:** Mastra Studio Metrics dashboard (dark, card-grouped, restrained).

Open the two HTML files in a browser to see the target look. PNG previews:
[`repo-settings.png`](./repo-settings.png), [`loops-dashboard.png`](./loops-dashboard.png).

---

## 1. Why

The current settings surface is ~25 separate pages (`apps/web/app/settings/*`) behind a
grouped sidebar (Account / Tools / Insights / Admin). It works, but each page is bespoke
and visually inconsistent, and **there is no place to configure a repository**. Today
repo-relevant configuration is scattered across three scopes:

- **User-wide defaults** (`user_preferences`): `defaultManagedRuntimeProfileId`,
  `defaultSandboxType`, `autoCommitPush`, `autoCreatePr`, `defaultModelId`,
  `globalSkillRefs`, `defaultDiffMode`.
- **Per-session choices** (the `sessions` row, picked in the `session-starter` composer
  each time): `branch`, `isNewBranch`, `fullClone`, `runtimeMode`,
  `managedRuntimeProfileId`, `autoCommitPushOverride`, `autoCreatePrOverride`,
  `vercelProject`. (Note the existing override idiom: a `*Override` of `null` means
  "inherit the user default.")
- **Per-repo** (`/api/settings/repositories/[owner]/[repo]/composio`): only the **Composio
  allowlist**. Nothing else is repo-scoped.

The result: users re-pick branch / clone depth / runtime / automation **every session** in
the composer, and there is no "set it once for this repo" level. The mockup is clearer
because it (a) introduces that missing repo-defaults level and (b) groups settings by
concern with a single, consistent card pattern.

## 2. The design system to extract (the reason it reads so clearly)

A reusable two-component primitive, applied everywhere:

- **`<SettingsGroup>`** — a card with a header: **title** (medium) + one-line **muted
  description**. One concern per card.
- **`<SettingRow>`** — label + description on the left, a single **right-aligned control**
  on the right (Switch / Select / Input / status tag / button). Rows are divided by a
  hairline; the card groups related rows.

Tokens (dark): near-black canvas, ~7% white borders, monochrome + one indigo accent
(pink for destructive), 11px radii, tabular numerals, generous padding. A **Danger zone**
variant uses a pink-tinted border and a destructive button with **typed double-confirm**
(this also satisfies the separate "delete loop/workflow with double confirm" request).

This primitive is the high-leverage win: restyle the existing `*-section.tsx` pages with it
for instant consistency, *and* build the new repo settings page from it.

## 3. Proposed repo settings page

Route: `/settings/repositories/[owner]/[repo]` (linked from the repo dashboard and the
composer's repo picker). Sections, top to bottom (see `repo-settings.html`):

1. **General** — default branch; start-new-branch-per-session.
2. **Clone & runtime** — **Full clone** (shallow default), **Pre-warm sandbox on session
   start**, runtime mode, runtime profile, vCPUs. (Full-clone and pre-warm are the two
   features just shipped; this is their natural home.)
3. **Git automation** — auto commit & push; auto create PR.
4. **Integrations** — GitHub App install status; Vercel project link; **Composio allowlist**
   (folds in the one per-repo setting that already exists).
5. **Danger zone** — delete repo settings / disconnect, typed double-confirm.

## 4. Data model + precedence

Introduce a `repository_settings` table keyed by `(userId, repoOwner, repoName)` with
**nullable** columns mirroring the session-level fields (`fullClone`, `prewarm`,
`runtimeMode`, `managedRuntimeProfileId`, `vcpus`, `autoCommitPush`, `autoCreatePr`,
`defaultBranch`, `isNewBranch`). `null` = inherit. Keep the existing per-repo Composio
allowlist as-is and surface it in the Integrations group.

Single resolution order, implemented once as `resolveRepoDefaults(userId, owner, repo)`:

```
system default  <  user_preferences  <  repository_settings  <  session override
```

- `POST /api/sessions` consumes the resolver instead of today's scattered
  `value ?? preferences.value` logic.
- The `session-starter` composer **pre-fills** from the resolver, so the common path is
  "accept the repo defaults and go" — fewer choices per session (reinforces the fast
  spin-up → grab-issue → implement loop).

## 5. Component / phasing plan

- **P1 — primitive:** build `<SettingsGroup>`/`<SettingRow>` (shadcn + Tailwind tokens),
  Storybook/visual check; no behavior change. Retrofit 2–3 existing sections to validate.
- **P2 — data + resolver:** `repository_settings` table + migration; `resolveRepoDefaults`;
  unit tests for precedence.
- **P3 — repo settings page:** the page above wired to the resolver + a
  `PATCH /api/settings/repositories/[owner]/[repo]` endpoint; fold in Composio.
- **P4 — composer pre-fill:** session-starter reads resolver defaults; session route uses
  resolver. Measure reduction in per-session toggling.
- **P5 (optional) — broaden:** restyle remaining settings sections with the primitive for
  a consistent settings system; consider the **loops/agents metrics dashboard**
  (`loops-dashboard.html`) as a sibling spike using the same tokens + the "KPI row →
  tabbed detail cards → full-width trend" grammar over existing `usage_events` / session
  events.

## 6. Risks / open questions

- **Scope of repo settings**: per-user-per-repo vs per-repo-shared (teams). Start
  per-user-per-repo (matches the existing per-repo Composio model).
- **Override clarity**: show inherited values as placeholders ("Inherited: shallow") so
  users see what a `null` resolves to.
- **Migration of the `*Override` idiom**: keep session overrides; repo settings slot
  between user default and session override — no change to existing session semantics.
- Native `<select>` styling — use the shadcn `Select` (the mockup hand-rolls a styled
  control to avoid unstyled OS chrome).

## 7. Definition of done (for the eventual feature, not this spike)

Repo settings page renders from `resolveRepoDefaults`; saving persists to
`repository_settings`; new sessions inherit repo defaults (verified end-to-end); precedence
unit-tested; the settings primitive is reused by ≥3 existing sections; observability on
settings save events.
