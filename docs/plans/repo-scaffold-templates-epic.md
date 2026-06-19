# Epic: Scaffold a New Repo From Templates (Zero-Repo Onboarding)

Prepared: 2026-06-12
Status: planning
GitHub epic issue: https://github.com/dennisonbertram/fork-open-agents/issues/360

## Executive Summary

Today a user cannot use the product without **already having a GitHub repo** to
connect. The first-run flow (`SessionStarter` → `RepoSelectorCompact`) assumes
the user picks an existing repo from their GitHub App installations. This is a
hard onboarding wall for anyone starting a brand-new project.

This epic lets a user **scaffold a new repository from a template** (starting
with Next.js) directly in onboarding, producing a real GitHub repo they then
drive a session against — no pre-existing repo required.

The work reuses the existing session/sandbox/push infrastructure. The data model
needs no new core tables (a session already carries `repoOwner`/`repoName`/
`branch`/`cloneUrl`). The **one hard blocker is GitHub permission**: nothing in
the product can create a repository today. Resolving that — and choosing the
scaffold mechanism — is the crux of this epic.

## The Critical Blocker: Nothing Can Create a Repo Today

Verified against the codebase:

- **GitHub App** (`apps/web/lib/github/app.ts`) permissions are
  `contents:write`, `pull_requests:write`, `issues:write/read`, `metadata:read`,
  `checks/deployments/statuses/actions:read`. **No `administration:write`** —
  the App cannot create repositories (org or user).
- **User OAuth** (Better Auth GitHub provider, `apps/web/lib/auth/config.ts`)
  requests no explicit scopes → defaults to `read:user`, `user:email`. **No
  `repo`/`public_repo` scope** — the user token cannot create repositories
  either.

So repo creation requires one of these permission changes (this is the decision
the epic must make first):

| Option | Permission change | Creates | Trade-off |
| --- | --- | --- | --- |
| **P1. App `administration:write`** | App settings + re-consent every installation | repos in installed orgs/accounts | broad, sensitive scope; re-consent friction; only where the App is installed |
| **P2. OAuth `repo` scope** | Add `repo` (or `public_repo`) to the Better Auth GitHub provider; re-auth users | repos under the user's own account | acts as the user, not the App; broad `repo` scope is heavy; `public_repo` limits to public repos |
| **P3. GitHub template-generate** | `POST /repos/{template_owner}/{template_repo}/generate` | a repo from a template repo | still needs a create-capable token (P1 or P2) for the *target* owner; not a way around the permission |

**Finding:** template-generate (P3) is a *mechanism*, not a permission bypass —
it still needs P1 or P2 to create in the target account. The epic must pick P1
or P2 as the auth basis. Recommendation below.

## Two Scaffold Approaches

**Approach A — GitHub template-generate.**
Maintain a real GitHub "template repository" (e.g. `dennisonbertram/template-nextjs`)
and call `POST /repos/{template}/generate` to copy it into the user's account.
- Pros: instant, GitHub does the copy, no sandbox needed for the scaffold.
- Cons: must maintain template repos as the source of truth; the generated
  content is whatever the template repo holds (no live `create-next-app`
  flags); still needs create permission for the target (P1/P2).

**Approach B — sandbox-based scaffold.**
Create an empty repo, then in a sandbox run `bunx create-next-app` (or another
scaffolder), commit, and push via the existing brokered-push machinery
(`apps/web/lib/github/actions/commit.ts` → `withTemporaryGitHubAuth` +
`syncToRemote`).
- Pros: reuses the existing sandbox + push path; flexible (any scaffolder,
  any flags); always current (`create-next-app@latest`).
- Cons: slower (boot sandbox → scaffold → push); still needs an empty repo to
  push to, so still needs create permission (P1/P2); more moving parts.

**Recommendation:** **Approach A (template-generate) for the MVP**, because it is
the simplest reliable path and avoids a sandbox round-trip during onboarding
(when the user has no repo and possibly no model key yet). Keep a curated
`template-nextjs` repo as the seed. Approach B becomes valuable later for
"scaffold with custom options" but is not needed for the first slice. Pair A
with whichever of P1/P2 is chosen.

**Auth recommendation:** Prefer **P2 (OAuth `repo` scope)** scoped to creating
repos under the *user's own account*, because it matches the mental model
("your new repo, in your account") and doesn't require an App-wide
`administration:write`. If org-repo creation is needed, that's a P1 follow-up.
NOTE: `repo` is a broad classic scope; evaluate whether a fine-grained PAT flow
or GitHub App `administration:write` on *user* installations is acceptable to
the team. This auth choice is the single biggest open decision — it must be
settled before implementation and is a `status:blocked`-worthy gate.

## Onboarding Entry Point + Session Binding

- **Entry point:** `apps/web/components/repo-selector-compact.tsx` — after the
  installations load (or in the "no installations / no repos yet" state), add a
  **"Create a new repo from a template"** affordance. `SessionStarter`
  (`apps/web/components/session-starter.tsx`) gains a template-pick step.
- **Binding path (reused):** the scaffold produces `repoOwner`/`repoName`/
  `cloneUrl`, which flow into the existing `POST /api/sessions`
  (`apps/web/app/api/sessions/route.ts`) exactly like a connected repo. The
  session + sandbox provisioning then proceed unchanged.
- **New API:** `POST /api/repos/scaffold` (or `/api/integrations/github/template-repositories`)
  — authenticated, rate-limited, creates the repo (template-generate),
  optionally waits for readiness, returns `{ repoOwner, repoName, cloneUrl,
  defaultBranch }`. The client then calls `POST /api/sessions`.

## Template Catalog

Mirror the existing static-catalog precedent
(`apps/web/app/repos/[owner]/[repo]/agents/agent-templates.ts`):

```ts
// apps/web/lib/templates/repo-templates.ts
export type RepoTemplate = {
  id: string;            // "nextjs"
  name: string;          // "Next.js App"
  description: string;
  templateOwner: string; // GitHub template repo owner
  templateRepo: string;  // GitHub template repo name
  defaultBranch: string; // "main"
};
export const REPO_TEMPLATES: RepoTemplate[] = [ /* nextjs first */ ];
```

Start with **one** template (Next.js). A DB-backed catalog
(`repo_templates` table) is a future option only if templates become
user-authored — not needed for MVP.

## Data Model

No new core tables. Optional (future, analytics only): a `sourceTemplate`
column on `sessions` to record "created from the Next.js template." Defer.

## Slices

- **Slice 0 — Auth decision + permission change (BLOCKER, human + ops).**
  Decide P1 vs P2; make the GitHub-side change (App `administration:write` OR
  OAuth `repo` scope); verify a token can create a repo. Nothing else ships
  until a create-capable token exists. Track as `status:blocked`.
- **Slice 1 — Backend scaffold endpoint.** `repo-templates.ts` catalog (Next.js),
  `POST /api/repos/scaffold` using template-generate with the create-capable
  token, returning the new repo coordinates. Tests: auth gate, template
  validation, the GitHub call (mocked Octokit), error/duplicate-name handling.
- **Slice 2 — Onboarding UI.** Template picker + "create new repo" entry point in
  `RepoSelectorCompact`/`SessionStarter`; wire scaffold → session creation;
  loading/empty/error states; authenticated UI smoke.
- **Slice 3 (future) — sandbox-based scaffold (Approach B)** for custom options,
  and additional templates.

## Out Of Scope

- Org-repo creation (unless P1 chosen) — follow-up.
- A user-editable / DB-backed template catalog.
- Sandbox-based scaffolding (Slice 3, later).
- Non-GitHub providers.

## Open Decisions (resolve before implementation)

1. **P1 vs P2** — the auth basis for repo creation (the gating decision).
2. **A vs B** — template-generate vs sandbox-scaffold for the MVP (recommend A).
3. Where the curated template repo lives and who maintains it.
4. Public-only (`public_repo`) vs private-capable (`repo`/App) — product call.

## Related Notes

- A separate product session attempted this feature on a DIFFERENT codebase
  (`synthetix`, `apps/api` + `pnpm` + `ux-map`) — not open-agents. That work is
  unrelated to this epic and is not the basis for this plan.
- This plan reuses the same session-binding path that #284 (HTTP git/GitHub
  routes) and the existing repo-selector flow already use.
