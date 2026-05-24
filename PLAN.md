Summary: Finish the managed runtime profile builder as a shippable, user-visible
runtime setup workflow. The remaining milestone is not more feature breadth; it
is proving the authenticated product path, fixing the current session page
server error, and only then committing and pushing for production testing.

Context:
- The original problem was opaque managed runtime setup: the app showed steps
  like "Install agent-browser" without explaining which profile selected that
  step, why it ran first, how it could be changed, or what failed when setup
  failed.
- The product direction is sound only if runtime setup is an explicit contract:
  named setup commands, verification commands, expected tools, optional tools,
  ports, repo signals, questions, evidence, approval, and user editing.
- The app now has most of that contract implemented:
  - `managed_runtime_profile_drafts` stores agent-proposed drafts and draft test
    evidence.
  - `managed_runtime_saved_profiles` stores approved custom session profiles and
    current saved-profile test evidence.
  - `sessions.managed_runtime_profile_id` stores the active profile for a
    session.
  - `user_preferences.default_managed_runtime_profile_id` stores the default
    built-in profile for new sessions.
- Automated verification has passed, including full `bun --bun run ci`,
  `git diff --check`, migration checks, focused API tests, and profile manager
  helper tests.
- Agentation currently has no pending annotations.
- Authenticated Agent Browser can reach the local app through the user's Chrome
  profile, but opening an existing session currently shows a Next.js server
  error from `generateMetadata -> getSessionById`. This blocks a clean product
  proof and must be handled before push.

System Impact:
- Source of truth:
  - Drafts are proposed by the agent but owned by the app.
  - Saved profiles are app-owned user-approved contracts.
  - The session owns the selected active profile.
  - Runtime setup resolves the selected profile and streams command-level
    progress and evidence.
- Authority boundary:
  - Agent: infer repo dependencies, propose a draft, revise from user feedback
    or failed evidence.
  - App/API: validate, persist, test, approve, edit, delete, select, and execute
    profile contracts.
  - User: inspect, test, approve, approve despite missing evidence, request
    changes, discard, edit, and switch profiles.
- Runtime invariant:
  - The model never silently changes runtime settings.
  - The user sees which profile is active, whether it was tested, what commands
    ran, and why setup failed.
  - Built-in profiles remain read-only.
  - Custom profile edits clear stale evidence until retested.
- Current release risk:
  - A browser-visible server error means the feature may be correct in tests but
    not usable in the real authenticated app. The next step is root-cause
    debugging, not adding more UI.

Approach:
1. Fix the authenticated local page-load blocker.
   - Reproduce the session page failure from the authenticated Agent Browser
     path.
   - Capture the actual server-side error from local logs or a controlled local
     dev process.
   - Determine whether the cause is unapplied local migrations, a schema/query
     mismatch, or a code-level regression.
   - Prefer the root fix. If the local database simply needs migrations, document
     and run the normal migration path rather than hiding the issue.

2. Prove the product path as a new user would experience it.
   - Open `/sessions`, create or use a session, and confirm the chat page loads.
   - Inspect the runtime selector, evidence badge, and profile manager copy from
     the perspective of a user with no context.
   - Exercise the managed runtime profile path with a trivial repo/task:
     proposed draft, visible repo signals/questions, test or setup+test,
     approval, active profile selection, saved-profile edit, retest, and runtime
     setup status.
   - Check browser console, browser errors, network failures, and local server
     logs after the smoke.

3. Tighten only the UX gaps found by that proof.
   - Fix unclear or misleading copy, missing status, stale evidence, disabled
     control ambiguity, or setup failure messages that do not answer "what is
     happening and what can I do next?"
   - Avoid expanding into repo-level promotion, user-created global profiles, or
     Composio integration in this slice.

4. Re-run the required verification.
   - Run focused tests for any touched files.
   - Run `bun --bun run check`, `bun --bun run typecheck`,
     `bun run --cwd apps/web db:check`, `git diff --check`, and
     `bun --bun run ci`.
   - Repeat authenticated Agent Browser smoke after fixes.

5. Commit and push only after the app path is credible.
   - Verify the git remote targets the user's fork/workspace, not upstream
     `vercel-labs/open-agents`.
   - Keep unrelated working tree changes out of the commit.
   - Commit the managed runtime profile builder work and push the branch.

Changes To Inspect Or Modify Next:
- `apps/web/lib/db/sessions.ts` - inspect `getSessionById` and selected columns
  involved in the server error.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/page.tsx` - inspect
  `generateMetadata` and page data loading around the failing session.
- `apps/web/lib/db/schema.ts` and `apps/web/lib/db/migrations/*` - verify the
  local database schema matches the new managed runtime columns and tables.
- `apps/web/package.json` - use the existing `db:migrate:apply` script if local
  migrations are missing.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` -
  tighten selector/profile manager affordances only if browser QA shows they are
  unclear.
- `apps/web/app/workflows/chat-sandbox-runtime.ts` - tighten setup progress and
  failure copy only if the browser/product path still leaves setup ambiguous.

Verification:
- Automated:
  - Focused tests for every changed route/helper/component.
  - `bun --bun run check`
  - `bun --bun run typecheck`
  - `bun run --cwd apps/web db:check`
  - `git diff --check`
  - `bun --bun run ci`
- Browser:
  - `agent-browser --session managed-runtime-auth2 --profile Default --allowed-domains localhost,127.0.0.1 open http://localhost:3000/sessions`
  - Open a session and confirm the chat page loads without a Next.js server
    overlay.
  - Exercise the managed runtime profile builder flow from draft through saved
    profile activation.
  - Inspect `agent-browser errors`, `agent-browser console`, and local server
    logs.
- Product acceptance:
  - A user can tell which runtime profile is active.
  - A user can tell whether a custom profile is tested, failing, stale, or
    untested.
  - Setup progress explains each command's label, reason, required/optional
    status, and failure.
  - A user can edit and retest a saved profile without stale evidence pretending
    the edit is already proven.
  - Approval immediately updates runtime mode and selected profile without a
    page refresh.

Deferred:
- Repo-level profile promotion.
- User-level custom default profiles.
- Profile import/export.
- Composio tool access from the top-level agent.
- A profile builder that automatically promotes stable profiles across repos.
- CI-authenticated browser automation.

Gut Check:
- This is a good idea because runtime setup is currently a hidden source of
  confusion, and profile contracts make the setup path inspectable, testable,
  editable, and auditable.
- It becomes a bad idea if the agent can silently mutate settings, if failed
  setup collapses into generic copy, or if the UI asks users to trust an
  untested profile without clearly labeling that risk.
- The smallest coherent release is session-scoped: propose, test, approve, save,
  select, edit, retest, and show detailed setup progress.
