# UX Walker Report: Open Agents

Run date: 2026-06-21 to 2026-06-22
Target URL: `http://localhost:3002`
Catalog: `docs/ux-paths/catalog.md`
Plan: `docs/ux-walker/walk-plan.json`

## Run Metadata

| Metric | Value |
|--------|-------|
| Stories in catalog | 18 |
| Stories walked this pass | 18 |
| Stories passed | 16 |
| Stories partial / mutation-limited | 2 |
| Stories failed | 0 |
| Findings | 17 |
| Quick fixes applied | 12 |
| Issues filed | 0 |

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 17 |
| Low | 0 |
| Suggestion | 0 |

| Category | Count |
|----------|-------|
| Happy path | 2 |
| Accessibility | 8 |
| Agent context | 1 |
| Error state | 2 |
| Navigation | 1 |
| High-impact action | 2 |
| Tooling | 1 |

## Quick Fixes Applied

| Finding | Story | Fix |
|---------|-------|-----|
| `F-STORY-010-001` | STORY-010 | Made the Cursor Composer preset visible immediately in the inference profile dialog and wired it to fill provider, base URL, and model IDs. |
| `F-STORY-003-001` | STORY-003 | Changed the New Session dialog's accessible title from “New chat” to “New session”. |
| `F-STORY-004-001` | STORY-004 | Split the compact Vercel lookup error row into sibling expansion and Retry buttons so the markup is valid and keyboard-safe. |
| `F-STORY-005-001` | STORY-005 | Passed the connected repository owner/name into the agent prompt so it no longer infers the repo name from the sandbox directory. |
| `F-STORY-007-001` | STORY-007 | Added explicit labels to the share icon and file/changes panel toggle so the repo chat files and diffs path is discoverable without pointer hover. |
| `F-STORY-008-001` | STORY-008 | Added PR creation consequence copy and generation-button labels before the high-impact GitHub write action. |
| `F-STORY-011-001` | STORY-011 | Added per-variant accessible labels to model variant edit/delete icon buttons. |
| `F-STORY-012-001` | STORY-012 | Disabled saved Composio profiles in the chat selector when required toolkits are not connected and surfaced the missing-tool reason. |
| `F-STORY-014-001` | STORY-014 | Added target-specific accessible labels to skill card edit/delete/toggle controls. |
| `F-STORY-014-002` | STORY-014 | Replaced native skill deletion confirmation with inline Confirm/Cancel controls. |
| `F-STORY-015-001` | STORY-015 | Added target-specific accessible labels to background agent actions, webhook copy controls, and run-history links. |
| `F-STORY-016-001` | STORY-016 | Added template-specific accessible labels to loop template actions. |

## Issues Filed

None.

## UX Audit Summary

The first pass established the path catalog and walked the signed-out public entry, settings navigation, sessions index, session starter path, first chat controls path, and authenticated model/inference setup path. The public signed-out `/sessions` boundary correctly lands on the public page with visible Vercel sign-in. The model settings page is usable and provider-aware, but the initial Cursor setup path hid the most useful shortcut behind the provider dropdown. That has been quick-fixed.

The sessions index loaded cleanly with a clear empty main state. The “New Session” action originally opened a dialog announced as “New chat”, which has been fixed to “New session” while preserving the inner “New chat” tab. The repo-backed session starter now renders Vercel lookup failures with valid sibling controls and successfully lands in an active chat after start.

The first chat path exposes provider-grouped models, including Fireworks GLM 5.2, shows GitHub as a native always-on tool, and displays response metadata including tokens/sec and cost. It also surfaced an agent-context issue where the assistant inferred `sandbox` as the repo name; the prompt now carries `Connected repository: dennisonbertram/synthetix`, and the live retry answered with the correct repo and branch.

The repository dashboard path loads with prominent repo identity, live PR and issue data, agents, loops, and activity. The Actions window contains a permission failure, but the state is too terse and noisy in local dev. The shorthand `/{owner}/{repo}` route currently starts a repo-backed chat rather than showing the dashboard, so the route semantics need to be clarified or aligned.

The repo chat files and diffs path now passes after a quick accessibility fix. The Files tab loads a tree, selecting `package.json` renders source content, and the Changes tab shows a clean `No file changes yet` empty state with commit disabled. The file/changes panel trigger and share icon now have explicit accessible labels.

The commit/PR path was walked up to the external GitHub write boundary. The no-uncommitted-changes variation correctly disables commit actions and explains `No file changes yet`. The PR panel can create a pull request from the current branch, so it now shows consequence copy naming `d/881fa842` into `main` and whether title/body will be generated before the GitHub write. The actual Create Pull Request/Create Draft PR click was not executed without explicit approval or a disposable repo.

The sandbox/workspace failure recovery path now has evidence from the previously reported failed session. Runtime Inspector successfully shows the actionable cause, workflow id, sandbox name, retry count, and timestamped event timeline. The remaining gap is point-of-failure recovery: the historical assistant message still says only `Workspace setup failed. Try again in a moment.` and does not point to Runtime Inspector or Settings → Models.

The model variant path passes after a quick accessibility fix. The New Variant dialog opens, invalid JSON is caught inline, a valid temporary variant can be created and edited, built-in variants remain protected, and the temporary variant was cleaned up. User-created variant action buttons now expose `Edit {variant}` and `Delete {variant}` labels.

The Composio tools configuration path now passes after a quick point-of-use fix. The settings page correctly showed Gmail as disconnected inside a saved Email profile, but the chat selector initially allowed that saved profile. The compact selector now disables the saved Email profile and explains `Tool not connected: gmail.`

The MCP server registration path passes. The page handles empty state, invalid URL validation, local HTTP registration, header entry, write-only header values on edit, enable/disable toggling, inline delete confirmation, and cleanup back to empty state.

The skill creation path now passes after two quick fixes. Skill cards now name their edit, delete, and enable controls with the target slash command, and deletion uses inline Confirm/Cancel controls. The walk covered creation, duplicate-name validation, editing, allowed-tool chips, toggling, and UI cleanup back to empty state.

The background agents path is partial because the local deployment reports background agents disabled. The readiness panel and operator details clearly name missing inputs, the Test action returns `Background agents are disabled`, and existing run details render rich timeline/debug evidence. Repeated agent and run actions now include their target names.

The loops builder and run-controls path now passes after a quick accessibility fix. The loops index, new-loop template gallery, template configure form, repository picker, builder graph, node palette, validation error summary, and run detail lifecycle controls all rendered in the authenticated browser. The actual `Run now` action was not clicked on the Review to issues template because that template can file GitHub issues; instead, local run rows were seeded for pause, resume, cancel, and retry UI verification without dispatching agent work.

The usage and leaderboard path passes with one remaining accessibility finding. Usage totals, cost, model split, agent split, insights, and date filtering all work; the leaderboard shows a clear no-domain empty state for this account; and the public profile route correctly reports the profile is private. The usage chart currently puts hundreds of per-day bars in the focus order, which should be redesigned before this page is considered polished for keyboard and screen-reader users.

The sharing path passes. The chat header exposes a labeled Share chat control, the dialog creates a link and switches to Copy/Revoke management, the authenticated owner view includes an owner-only Open session banner, and an anonymous fetch of the shared page shows the transcript without owner controls, share controls, or composer. The created share was revoked after evidence capture, and the revoked URL returns 404.

The Usage settings page exposes a very large number of daily chart bars as individual buttons. This is logged as an accessibility/design finding for later review rather than quick-fixed in this pass.

The authenticated browser walk used the in-app browser because `agent-browser --auto-connect` could not attach to a debuggable Chrome instance, and a fresh `agent-browser` session was intentionally signed out. Future authenticated story walks should either use the in-app browser or launch a debuggable Chrome profile with saved auth state.

## Top Recommendations

1. Repeat STORY-015 in an enabled background-agent environment.
2. For authenticated `agent-browser` walking, create a reusable auth state or launch Chrome with remote debugging.
3. Keep high-risk settings dialogs shortcut-friendly; common provider presets should not depend on a dropdown before discovery.
4. Capture screenshots for authenticated stories once the browser surface exposes screenshot support or a debuggable Chrome session is available.
5. Keep findings small and batch fixes by touched file to avoid conflict in the already dirty worktree.

## Stories Still Failing

None from the fully passed stories. STORY-008 remains mutation-limited, and STORY-015 remains feature-disabled locally.

## Run Statistics

The full 18-story catalog has current evidence. STORY-008 remains mutation-limited, and STORY-015 remains feature-disabled locally.
