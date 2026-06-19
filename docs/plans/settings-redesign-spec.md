# Settings Redesign — Unified Implementation Spec (open-agents)

## 0. North Star & Principles

Settings should feel like the calmest, most trustworthy room in the app. Every block must answer three questions at the point of use: **What is this? What happens if I change it? Can I undo it?** We achieve this with:

1. **One section primitive** (`SettingsSection`) — title + one-line plain-language *why* + optional learn-more, replacing every ad-hoc `UPPERCASE + hairline` block and inline `<h1>`.
2. **One readiness primitive** (`ReadinessVerdict`) — translates deploy-time/env prerequisites into a single human verdict; raw env-var names live only behind an "Operator details" disclosure.
3. **Grouped IA** — a left rail split into scope groups (Account · Tools · Insights · Admin), ordered personal → shared → operator, instead of one flat list of seven peers.
4. **Smart defaults + progressive disclosure** — the safe/common choice is always visible; power features stay reachable behind a labeled disclosure (never a bare chevron, max two levels deep).
5. **No raw identifiers in user copy** — `managed_runtime` → "Managed runtime", env-var names appear only inside operator disclosure checklists, presence-only (✓/✗ set/missing), never values.

### Non-goals (deferred to existing tickets — this redesign only sets them up)
- **#224 Composio** deep rework — we wrap the existing `ComposioSection` in `SettingsSection`s and move it under "Tools"; the connection/auth internals are #224.
- **#229 Background-agent stepper** — we replace the readiness block with `ReadinessVerdict` and group the page; the create/edit stepper UX is #229.
- **#227 Models disclosure** — we host `ModelPreferencesSection` / `InferenceProfilesSection` / `ModelVariantsSection` inside `SettingsSection`s with a "Advanced" disclosure scaffold; the per-control disclosure design is #227.
- **#220 Model defaults** — we surface "Default models" as the first, always-visible section on the Models page; the defaults-resolution logic is #220.

These are explicitly out of scope for the slices below; where a slice touches their files it does so only to host them in the new primitives.

---

## 1. Target Information Architecture

### 1.1 Nav groups (replaces flat `baseSidebarItems`)

The rail becomes a list of **groups**, each with a label and items. Active match stays `pathname === item.href` but is extended to also highlight when `pathname.startsWith(item.href)` so nested routes (e.g. `/settings/usage`) light up correctly.

```
ACCOUNT
  Profile          /settings/profile          icon: User
  Preferences      /settings/preferences      icon: SlidersHorizontal
  Connections      /settings/connections      icon: Cable

TOOLS
  Models           /settings/models           icon: Boxes
  Composio         /settings/composio         icon: Blocks
  Background agents /settings/background-agents icon: Bot

INSIGHTS
  Usage            /settings/usage            icon: BarChart3   ← NEW real page
  Leaderboard      /settings/leaderboard      icon: Trophy

ADMIN  (group rendered only when isAdmin)
  Admin            /settings/admin            icon: ShieldAlert
```

Rationale (Linear/GitHub two-tier scope model): Account = "about you", Tools = "what the agent can do", Insights = "how it's going", Admin = operator/destructive. ~3 items per group, none exceeding 7.

### 1.2 Noun ↔ page contract fixes

| Today | Problem | Fix |
|---|---|---|
| `/settings/usage` → `redirect('/settings/profile')` | Usage has no home; nav can't point to it | **Make it a real page.** `usage/page.tsx` renders `UsageInsightsSection` + `DomainUsageLeaderboardSection` under `SettingsPageHeader`. Add `usage` to the Insights nav group. |
| `/settings/accounts` → `redirect('/settings/connections')` | Dead noun, but external deep-links may exist | **Keep redirect** (legitimate alias; "Accounts" is not a distinct concept). Document it as an intentional alias, not a bug. |
| `/settings/page.tsx` → `redirect('/settings/profile')` | Fine | **Keep.** Landing on the index goes to Profile (first item). |
| Profile page leads with fabricated "#1 in Vercel" | Untrustworthy | Profile **leads with identity** (avatar, name, @handle, email); rank moves below identity and is bound to live `useLeaderboardRank` (Section 5). |

### 1.3 Single source of truth for nav

Extract nav data to `apps/web/app/settings/nav-items.ts` so the three places that currently re-derive from `baseSidebarItems` (desktop aside, mobile Sheet, loading-fallback title/skeleton) all import one array. Shape:

```ts
// apps/web/app/settings/nav-items.ts
import type { LucideIcon } from "lucide-react";
import { BarChart3, Blocks, Bot, Boxes, Cable, ShieldAlert, SlidersHorizontal, Trophy, User } from "lucide-react";

export type SettingsNavItem = { id: string; label: string; href: string; icon: LucideIcon };
export type SettingsNavGroup = { id: string; label: string; items: SettingsNavItem[]; adminOnly?: boolean };

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  { id: "account", label: "Account", items: [
    { id: "profile", label: "Profile", href: "/settings/profile", icon: User },
    { id: "preferences", label: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
    { id: "connections", label: "Connections", href: "/settings/connections", icon: Cable },
  ]},
  { id: "tools", label: "Tools", items: [
    { id: "models", label: "Models", href: "/settings/models", icon: Boxes },
    { id: "composio", label: "Composio", href: "/settings/composio", icon: Blocks },
    { id: "background-agents", label: "Background agents", href: "/settings/background-agents", icon: Bot },
  ]},
  { id: "insights", label: "Insights", items: [
    { id: "usage", label: "Usage", href: "/settings/usage", icon: BarChart3 },
    { id: "leaderboard", label: "Leaderboard", href: "/settings/leaderboard", icon: Trophy },
  ]},
  { id: "admin", label: "Admin", adminOnly: true, items: [
    { id: "admin", label: "Admin", href: "/settings/admin", icon: ShieldAlert },
  ]},
];

export const flattenNavItems = (groups = SETTINGS_NAV_GROUPS) =>
  groups.flatMap((g) => g.items);

export const findActiveNavItem = (pathname: string, groups = SETTINGS_NAV_GROUPS) =>
  flattenNavItems(groups).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
```

`layout.tsx` renders groups by mapping `SETTINGS_NAV_GROUPS`, filtering `adminOnly` groups by `isAdmin`. The duplicated desktop/mobile nav JSX is extracted to a `SettingsNav` component (`apps/web/app/settings/settings-nav.tsx`) rendered in both the `<aside>` and the `<Sheet>`.

---

## 2. `SettingsSection` primitive

**File:** `apps/web/components/ui/settings-section.tsx`. Replaces the two copy-pasted `SectionHeader` defs (`composio-section.tsx:103`, `preferences-section.tsx:84`), the local `FieldHelp`, and the inline `<h1>` page titles. Built on existing tokens — no new deps.

### 2.1 API

```ts
// SettingsPageHeader — one per page, replaces inline <h1 className="text-2xl font-semibold">
export interface SettingsPageHeaderProps {
  title: string;
  description?: string;        // one-line plain-language summary of the page
  action?: React.ReactNode;    // optional right-aligned control (rare)
}

// SettingsSection — one per logical block within a page
export interface SettingsSectionProps {
  title: string;               // a NOUN ("Default models", "Personal API keys")
  description?: string;        // the EFFECT in plain language, ≤120 chars
  /** Right-aligned control slot: a Switch, Select, or "Edit" Button. */
  action?: React.ReactNode;
  /** Inline learn-more. Only render the link when href is a real doc. */
  learnMore?: { href: string; label?: string };
  /** Power/expert config. Rendered inside a labeled disclosure, closed by default. */
  advanced?: { label?: string; children: React.ReactNode };
  /** Visual emphasis. "danger" => red-bordered fence for destructive blocks. */
  tone?: "default" | "danger";
  children?: React.ReactNode;
}
```

### 2.2 Code sketch

```tsx
"use client";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsPageHeader({ title, description, action }: SettingsPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function SettingsSection({
  title, description, action, learnMore, advanced, tone = "default", children,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm",
        tone === "danger" ? "border-destructive/30 bg-destructive/[0.03]" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className={cn("text-sm font-medium", tone === "danger" && "text-destructive")}>
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground text-pretty">
              {description}
              {learnMore && (
                <>
                  {" "}
                  <a href={learnMore.href} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline">
                    {learnMore.label ?? "Learn more"} <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {children && <div className="mt-4">{children}</div>}

      {advanced && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <button type="button" onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            {advanced.label ?? "Advanced"}
          </button>
          {open && <div className="mt-3">{advanced.children}</div>}
        </div>
      )}
    </section>
  );
}
```

Notes: the eyebrow `text-xs font-medium uppercase tracking-wider text-muted-foreground` style is retired in favor of a sentence-case `text-sm font-medium` title; the disclosure is hand-rolled (no Radix Collapsible dep, matching existing codebase pattern). Page bodies use `space-y-6` between sections (the layout container already supplies it).

---

## 3. `ReadinessVerdict` primitive (operator config)

**File:** `apps/web/components/ui/readiness-verdict.tsx`. This is the highest-leverage primitive: it gives end users one plain-language verdict and tucks env-var presence behind "Operator details". It generalizes the bespoke background-agents readiness block (`background-agents-section.tsx:331-419`) and its `StatusPill` (line 140).

### 3.1 API

```ts
export type ReadinessStatus = "ready" | "action-needed" | "unavailable" | "error";

export interface ReadinessCheck {
  id: string;
  label: string;                 // human label, e.g. "GitHub App installed"
  status: "ready" | "missing" | "disabled";
  detail?: string;               // plain explanation
  /** Raw env-var / service identifiers — presence only, NEVER values. */
  missing?: string[];            // e.g. ["GITHUB_APP_ID"] rendered as "✗ not set"
  present?: string[];            // e.g. ["BETTER_AUTH_SECRET"] rendered as "✓ set"
}

export interface ReadinessVerdictProps {
  status: ReadinessStatus;
  /** The ONE plain-language sentence the end user reads. */
  headline: string;
  /** Optional second line, e.g. who controls it. */
  subtext?: string;
  /** Optional inline CTA that RESOLVES the prerequisite (gated-state pattern). */
  action?: React.ReactNode;
  /** Operator-only diagnostic detail; collapsed by default, label "Operator details". */
  checks?: ReadinessCheck[];
  onRefresh?: () => void;        // optional refresh affordance
  refreshing?: boolean;
}
```

### 3.2 Status → presentation map

| status | dot color | default headline tone | meaning |
|---|---|---|---|
| `ready` | emerald | "X is enabled by your deployment." | usable now |
| `action-needed` | amber | "Ask your admin to finish setup." / inline CTA | prerequisite unmet, user/admin can act |
| `unavailable` | gray | "Managed by your workspace." | env-locked, read-only |
| `error` | red | "Can't reach the service — try again or contact your admin." | runtime failure, no codes |

### 3.3 Code sketch

```tsx
"use client";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const DOT: Record<ReadinessStatus, string> = {
  ready: "bg-emerald-500",
  "action-needed": "bg-amber-500",
  unavailable: "bg-muted-foreground/50",
  error: "bg-destructive",
};

export function ReadinessVerdict({
  status, headline, subtext, action, checks, onRefresh, refreshing,
}: ReadinessVerdictProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[status])} aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-pretty">{headline}</p>
            {subtext && <p className="text-xs text-muted-foreground text-pretty">{subtext}</p>}
            {action && <div className="pt-1.5">{action}</div>}
          </div>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} aria-label="Refresh status"
            className="text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        )}
      </div>

      {checks && checks.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            Operator details
          </button>
          {open && (
            <ul className="mt-2 space-y-2">
              {checks.map((c) => (
                <li key={c.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full",
                      c.status === "ready" ? "bg-emerald-500" : c.status === "missing" ? "bg-amber-500" : "bg-muted-foreground/50")} />
                    <span className="font-medium">{c.label}</span>
                  </div>
                  {c.detail && <p className="ml-3 text-muted-foreground text-pretty">{c.detail}</p>}
                  {(c.present?.length || c.missing?.length) && (
                    <div className="ml-3 mt-1 flex flex-wrap gap-1">
                      {c.present?.map((n) => (
                        <span key={n} className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                          {n} ✓ set
                        </span>
                      ))}
                      {c.missing?.map((n) => (
                        <span key={n} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {n} ✗ not set
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

The end user sees only `headline`/`subtext`/`action`. Env-var names are confined to the collapsed "Operator details" and are rendered presence-only. The background-agents section maps its existing `BackgroundReadinessResponse` (`{ enabled, ready, missing, checks }`) into these props: `ready ? "ready" : enabled ? "action-needed" : "unavailable"`.

---

## 4. Admin gate (replace homemade 404)

`admin/page.tsx` currently renders a fake `NotFoundState()` (HTTP 200) when `!isAdmin`. Replace with an inline AuthGuard-style graceful gate so the experience matches the rest of settings.

- Remove the local `NotFoundState`.
- While `loading`: return the admin skeleton (or `null` consistent with current).
- When `!isAdmin`: render a calm `Empty`-based gate (using existing `@/components/ui/empty`):
  - `EmptyMedia variant="icon"` with `ShieldAlert`
  - `EmptyTitle`: "Admin tools"
  - `EmptyDescription`: "This area is for workspace admins. You don't have access — that's expected for most people."
  - `EmptyContent`: a `Button` linking back to `/settings/profile` ("Back to settings").
- This returns a friendly explanation, not a misleading 404. The nav already hides the Admin group for non-admins, so this is a defense-in-depth fallback for direct navigation.

---

## 5. Profile rank — bind to live data

In `profile/page.tsx`, the `ProfileSidebar`/identity block currently hardcodes line 387: `<p>#1 in Vercel</p>`.

- Import `useLeaderboardRank` from `@/hooks/use-leaderboard-rank`.
- Response shape: `{ rank: number; total: number; domain: string } | null` (null when no eligible domain).
- Render rules:
  - `loading` → `<Skeleton className="h-4 w-24" />`
  - `rank == null` → render **nothing** (no fake rank; identity stands alone).
  - else → `#{rank} in {domain}` (e.g. "#3 in vercel.com"), wrapped as a `Link` to `/settings/leaderboard` so it's a live, trustworthy, clickable fact.
- Profile **leads with identity** (avatar + name + @handle + email already present at lines 364-393); rank sits directly beneath identity as a secondary fact.

---

## 6. Leaderboard — delightful gated empty state

`leaderboard-section.tsx` should handle the "no eligible domain / no data yet" case with an `Empty`-based first-run state instead of an empty table:

- `EmptyMedia variant="icon"` with `Trophy`.
- `EmptyTitle`: "No leaderboard yet"
- `EmptyDescription`: "The leaderboard ranks people in your workspace by agent usage. As you and your teammates run agents, you'll show up here."
- If the user has no eligible domain (rank API returned null / personal email): `EmptyDescription` becomes "Leaderboards are grouped by work email domain. Sign in with your work account to join your team's board." with no misleading CTA.
- Keep the range tabs (`Today / 7 days / All time`) visible above the empty state so the affordance is consistent with the populated view.

---

## 7. Copy deck (plain-language one-liners)

Outcome-first, second person, active voice. Each is the `description` for that page header / `SettingsSection`.

**Profile (page)** — "Your identity across Open Agents and how your usage stacks up."

**Preferences (page)** — "Tune how Open Agents behaves for you. Changes apply to new chats right away."
- *General* — "Defaults that shape every new chat you start."
- *Default for new sessions* — "Choose what new chats get by default. New Chat starts fast with no sandbox; Repo mode opens a workspace on a repository." (sets up #220)
- *Add a sandbox automatically* — "When a chat needs to run code, give it a sandbox without asking. You can still add one by hand."
- *Skills* — "Reusable instructions your agent can load on demand. Add your own or use the built-in set."

**Connections (page)** — "Link the accounts Open Agents uses to act on your behalf."
- *Vercel* — "Connected through your Vercel sign-in. Used to deploy and read your projects."
- *GitHub* — "Connect GitHub to let agents read repos and open pull requests." (gated CTA when not connected: "Connect GitHub" inline)

**Models (page)** — "Pick the models your agents use and create named setups for specific jobs."
- *Default models* — "The models new chats use unless you pick something else." (sets up #220; always visible)
- *Personal API keys* — "Bring your own provider key to unlock more models. Your key is stored encrypted and only used for your chats." (empty state CTA "Add key"; sets up #227)
- *Model variants* — "Saved model + setting combos you can reuse by name." (advanced disclosure; #227)

**Composio (page)** — "Connect external tools so your agents can use them in a chat." (deep rework #224)

**Background agents (page)** — "Let agents run on their own — on a schedule or when something happens in a repo."
- *Availability* (ReadinessVerdict) — verdict-driven; headline e.g. "Background agents are enabled by your deployment." / "Ask your admin to finish setup." (stepper #229)

**Usage (page, NEW)** — "See how much you've used Open Agents — tokens, cost, and your busiest repos."

**Leaderboard (page)** — "See how agent usage ranks across your workspace."

**Admin (page)** — "Operator tools for managing tokens and access across the workspace."
- *Danger zone* (tone="danger") — "These actions affect everyone and can't be undone. Type to confirm."

---

## 8. Per-page change list

| File | Change |
|---|---|
| `components/ui/settings-section.tsx` | **NEW** — `SettingsPageHeader`, `SettingsSection`. |
| `components/ui/readiness-verdict.tsx` | **NEW** — `ReadinessVerdict`, types. |
| `app/settings/nav-items.ts` | **NEW** — grouped nav data + `flattenNavItems`/`findActiveNavItem`. |
| `app/settings/settings-nav.tsx` | **NEW** — extracted grouped nav (used by aside + Sheet). |
| `app/settings/layout.tsx` | Render groups via `SettingsNav`; import nav from `nav-items`; loading-fallback title/skeleton via `findActiveNavItem`; remove duplicated nav JSX. |
| `app/settings/usage/page.tsx` | Replace `redirect` with real page: `SettingsPageHeader` + `UsageInsightsSection` + `DomainUsageLeaderboardSection`. |
| `app/settings/profile/page.tsx` | Replace hardcoded rank (line 387) with `useLeaderboardRank`; identity-first; rank links to leaderboard. |
| `app/settings/admin/page.tsx` | Remove `NotFoundState`; gate via `Empty`; wrap in `SettingsSection tone="danger"`. |
| `app/settings/leaderboard-section.tsx` | Add `Empty` gated state; keep range tabs. |
| `app/settings/background-agents-section.tsx` | Swap readiness block (331-419) + `StatusPill` usage in that block for `ReadinessVerdict`; map existing response. |
| `app/settings/preferences-section.tsx` | Remove local `SectionHeader`; wrap blocks in `SettingsSection`; apply copy deck. |
| `app/settings/composio-section.tsx` | Remove local `SectionHeader`/`FieldHelp`; wrap in `SettingsSection`. |
| `app/settings/models/page.tsx` | Replace inline `<h1>` with `SettingsPageHeader`; host the three sections in `SettingsSection`s (Default models first). |
| `app/settings/preferences/page.tsx`, `connections/page.tsx` | Replace inline `<h1>` with `SettingsPageHeader` + copy. |

---

## 9. Keeping power features reachable

- **Models / variants / inference profiles**: hosted in `SettingsSection`, with rarely-changed knobs behind the section's `advanced` disclosure (label "Advanced"). Defaults always visible. Full feature internals stay in #227.
- **Background agents create/edit**: the create flow stays fully reachable (button in section header); only the *readiness* presentation changes here. Stepper is #229.
- **Operator detail**: every env-derived verdict keeps a one-click "Operator details" disclosure with the full presence checklist — operators debugging a deploy lose nothing; end users see one clean verdict.
- **Danger zone**: not collapsed — fenced by `tone="danger"` red border at the bottom of Admin, with typed-confirm dialogs preserved.
- **Two-level cap**: page → section → (one) advanced/operator disclosure. No third level.

## Slice plan

### Slice 1 — SettingsSection + SettingsPageHeader primitive
- goal: Add the shared section/header primitive that every page will use, with title + plain-language description + optional learn-more + optional advanced disclosure + danger tone.
- files: add: apps/web/components/ui/settings-section.tsx; add: apps/web/components/ui/settings-section.test.tsx
- risk: low · dependsOn: none
- testPlan: Failing-test-first: render SettingsSection with title+description+learnMore -> assert title text, description text, and that learn-more anchor renders with the given href only when provided. Render with advanced -> assert advanced children are NOT in the DOM until the disclosure button (aria-expanded toggling) is clicked. Render tone='danger' -> assert destructive border class present. Render SettingsPageHeader -> assert h1 + description. Use renderToStaticMarkup for static assertions and a client render for the toggle.

### Slice 2 — ReadinessVerdict primitive
- goal: Add the operator-config verdict primitive: one plain-language headline + status dot + optional resolving CTA, with env-var presence checklist hidden behind a collapsed 'Operator details' disclosure (presence only, never values).
- files: add: apps/web/components/ui/readiness-verdict.tsx; add: apps/web/components/ui/readiness-verdict.test.tsx
- risk: low · dependsOn: none
- testPlan: Failing-test-first: render with status='ready' + headline -> assert headline visible and emerald dot class. Render with checks containing missing:['GITHUB_APP_ID'] -> assert the raw env name is NOT in initial DOM (collapsed) and appears with '✗ not set' after expanding 'Operator details'; assert present:[] entries render '✓ set'. Render status='unavailable' -> assert gray dot + subtext. Render with action -> assert CTA node present.

### Slice 3 — Grouped nav data + SettingsNav extraction
- goal: Create single-source grouped nav data and an extracted SettingsNav component; rewire layout.tsx to render Account/Tools/Insights/Admin groups from it in both desktop aside and mobile Sheet, with admin group gated by isAdmin and active match supporting nested routes.
- files: add: apps/web/app/settings/nav-items.ts; add: apps/web/app/settings/settings-nav.tsx; change: apps/web/app/settings/layout.tsx; add: apps/web/app/settings/nav-items.test.ts
- risk: medium · dependsOn: Slice 1
- testPlan: Failing-test-first (nav-items.test.ts, pure): assert SETTINGS_NAV_GROUPS contains the exact group->item->href mapping from the spec (account/tools/insights/admin); flattenNavItems length and ids; findActiveNavItem('/settings/usage/foo') resolves to the usage item via startsWith; admin group flagged adminOnly. Component-level: render SettingsNav with isAdmin=false -> admin group absent; isAdmin=true -> Admin link present.

### Slice 4 — Usage becomes a real page
- goal: Replace the usage->profile redirect with a real Usage page that uses SettingsPageHeader and hosts the existing usage insight + domain leaderboard sections; nav already points to it from Slice 3.
- files: change: apps/web/app/settings/usage/page.tsx; add: apps/web/app/settings/usage/page.test.tsx
- risk: low · dependsOn: Slice 1, Slice 3
- testPlan: Failing-test-first: assert usage/page.tsx no longer calls redirect and renders SettingsPageHeader with title 'Usage' and the copy-deck description; assert UsageInsightsSection and DomainUsageLeaderboardSection are rendered. (Mock the section modules; assert composition, not data.)

### Slice 5 — Profile rank bound to live data
- goal: Remove the hardcoded '#1 in Vercel' and bind rank to useLeaderboardRank: skeleton while loading, nothing when null, '#{rank} in {domain}' linking to the leaderboard otherwise; identity stays first.
- files: change: apps/web/app/settings/profile/page.tsx; add: apps/web/app/settings/profile/profile-rank.test.tsx (extract the rank line into a small ProfileRank component to test)
- risk: low · dependsOn: none
- testPlan: Failing-test-first: mock useLeaderboardRank -> loading renders a Skeleton; null renders no rank text (assert '#' absent); {rank:3,total:10,domain:'vercel.com'} renders '#3 in vercel.com' inside a Link to /settings/leaderboard. Assert the literal string '#1 in Vercel' no longer appears anywhere in the file.

### Slice 6 — Admin graceful gate
- goal: Replace the homemade HTTP-200 404 with an Empty-based friendly access explanation and wrap the destructive controls in SettingsSection tone='danger'.
- files: change: apps/web/app/settings/admin/page.tsx; add: apps/web/app/settings/admin/page.test.tsx
- risk: low · dependsOn: Slice 1
- testPlan: Failing-test-first: mock useSession isAdmin=false -> assert the '404' text is gone and an Empty with 'Admin tools' + 'Back to settings' link to /settings/profile renders. isAdmin=true -> assert the danger-zone section title renders and the revoke buttons are present.

### Slice 7 — Leaderboard gated empty state
- goal: Give the leaderboard a delightful first-run/gated empty state (Trophy Empty) with distinct copy for no-data vs no-eligible-domain, keeping the range tabs visible.
- files: change: apps/web/app/settings/leaderboard-section.tsx; add/extend: apps/web/app/settings/leaderboard-section.test.tsx
- risk: medium · dependsOn: Slice 1
- testPlan: Failing-test-first: mock usage response with empty/null domainLeaderboard -> assert Empty with 'No leaderboard yet' renders and range tabs still present; mock no-eligible-domain case -> assert the work-email-domain copy variant renders with no misleading CTA; populated case -> assert table rows render (no Empty).

### Slice 8 — Background agents readiness uses ReadinessVerdict
- goal: Replace the bespoke readiness block (and its StatusPill usage there) with ReadinessVerdict, mapping the existing BackgroundReadinessResponse into status/headline/checks; raw env names move into the collapsed operator details.
- files: change: apps/web/app/settings/background-agents-section.tsx; extend: apps/web/app/settings/background-agents-section.test.tsx
- risk: medium · dependsOn: Slice 2
- testPlan: Failing-test-first: feed readiness {enabled:true, ready:true} -> ReadinessVerdict status 'ready' + enabled headline; {enabled:true, ready:false, missing:['GITHUB_APP_ID']} -> status 'action-needed', and 'GITHUB_APP_ID' absent until 'Operator details' expanded; {enabled:false} -> status 'unavailable'. Assert end-user headline contains no raw env-var token.

### Slice 9 — Apply SettingsSection across Account + Tools pages
- goal: Adopt SettingsPageHeader/SettingsSection and the copy deck on preferences, connections, models, composio pages; delete the duplicated local SectionHeader/FieldHelp; host Default models first and scaffold the Advanced disclosure (feature internals deferred to #220/#227/#224).
- files: change: apps/web/app/settings/preferences-section.tsx; change: apps/web/app/settings/preferences/page.tsx; change: apps/web/app/settings/connections/page.tsx; change: apps/web/app/settings/models/page.tsx; change: apps/web/app/settings/composio-section.tsx
- risk: medium · dependsOn: Slice 1
- testPlan: Failing-test-first (light, composition-level): for each page, assert SettingsPageHeader title + copy-deck description render and at least one SettingsSection with the expected section title renders; assert the old local SectionHeader function is removed (no UPPERCASE eyebrow class string in the touched section files). Keep existing behavior tests green; do not assert feature internals owned by #220/#224/#227.