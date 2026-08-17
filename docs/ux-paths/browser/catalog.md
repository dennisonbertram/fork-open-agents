# UX Path Catalog: Open Agents

Generated: 2026-08-17
Total Stories: 187
Source: docs/ux-paths/browser/topics/ (12 files)

## Summary

| Type | Count |
|------|-------|
| Short | 58 |
| Medium | 86 |
| Long | 43 |

## Coverage Matrix

| Feature Area | Stories | Gaps |
|-------------|---------|------|
| Auth & onboarding | 15 (STORY-017-STORY-031) | none — full coverage |
| Sessions | 15 (STORY-157-STORY-171) | creation is fully covered; discovery.md's Sessions line also lists fork a chat, "delete-and-after", mark read, and the debug bundle download — zero stories anywhere in the corpus exercise any of those four |
| Chat loop | 18 (STORY-048-STORY-065) | none — full coverage |
| Workspace runtime | 15 (STORY-142-STORY-156) | sandbox status/resume/reconnect fully covered; the code editor **control** is walked in its disabled state (STORY-144, STORY-148), but the successful hosted `/codespace/[sessionId]` path is an unwalked happy path, and "browser runs" (named in discovery.md's Workspace runtime line) appears in no story |
| Git / diff / PR | 16 (STORY-066-STORY-081) | none — full coverage |
| Background agents | 16 (STORY-032-STORY-047) | feature is walked, but the source file itself is degraded: 0/16 stories have an Alternate paths field at all, and 11/16 (STORY-037-047) have no Ideal path field — see Gaps & Recommendations |
| Agent loops | 16 (STORY-001-STORY-016) | none — full coverage |
| Runs & automations | 14 (STORY-128-STORY-141) | feature is walked, but none of the 14 stories carry a Topic field (source defect) — grouping here uses the file's own H1 title instead |
| Repositories | 14 (STORY-114-STORY-127) | none — full coverage |
| Settings | 16 (STORY-172-STORY-187) | none — full coverage |
| Public surfaces | 16 (STORY-098-STORY-113) | feature is walked, but 15/16 stories (all but STORY-112) have no Alternate paths field at all — see Gaps & Recommendations |
| Mobile `/m/*` | 2 dedicated (STORY-112, STORY-113) + 3 cross-references (STORY-031, STORY-065, STORY-067) | only session-activity-check and new-session are walked mobile-first; the mobile "Me" tab / settings screen has no dedicated story, only a secondhand mention as a third sign-out surface in STORY-031 |
| Flag-gated | Subsystem flags **on**: STORY-001, STORY-003, STORY-005 and STORY-118 all declare `AGENT_LOOPS_ENABLED` on in Preconditions. Flag **off**: STORY-134, plus failure-states.md's STORY-086-STORY-097 | Agent Loops is covered in both states, so it is not a gap. The real gap is the *product-surface* flags: no story exercises the authenticated GTM suite, the Verified Build panel, or the Harness UI with its flag on, and the workflow catalog is only ever seen as an absent chip |

## Story Cross-Reference Graph

**This is a cross-reference graph, not a dependency graph — an edge does not mean "run this first".** Edges were extracted mechanically: every literal `STORY-NNN` mention inside a story's own body text (Steps/Variations/Edge Cases/Alternate paths), resolved against that story's own topic file. 137 such references were found across 95 stories. **All of them stay inside their own topic file** — no story in one topic file names a STORY-ID that belongs to a different topic file, so this graph is intra-topic only; see Redundancy Candidates → Overlapping features/tools for the cross-topic relationships, which are conceptual rather than ID-cited.

A mention is often a *variation* or a *contrast*, and it can point the opposite way from the real prerequisite: STORY-001 mentions STORY-002 and STORY-012 as variations, while STORY-002's own source declares a dependency on STORY-001's first five steps. To order a browser walk, read each story's `**Preconditions**` field instead of this table.

| Story | References |
|-------|------------|
| STORY-001 | STORY-002, STORY-012 |
| STORY-002 | STORY-001 |
| STORY-003 | STORY-001, STORY-004 |
| STORY-004 | STORY-003 |
| STORY-005 | STORY-001 |
| STORY-006 | STORY-002 |
| STORY-009 | STORY-015 |
| STORY-010 | STORY-016 |
| STORY-011 | STORY-010 |
| STORY-012 | STORY-010 |
| STORY-015 | STORY-009 |
| STORY-017 | STORY-022, STORY-026 |
| STORY-018 | STORY-020 |
| STORY-021 | STORY-019 |
| STORY-023 | STORY-018 |
| STORY-026 | STORY-018 |
| STORY-027 | STORY-022 |
| STORY-028 | STORY-019 |
| STORY-030 | STORY-017, STORY-019 |
| STORY-032 | STORY-033, STORY-036, STORY-044 |
| STORY-035 | STORY-032, STORY-034 |
| STORY-036 | STORY-032 |
| STORY-038 | STORY-034 |
| STORY-040 | STORY-034 |
| STORY-042 | STORY-032, STORY-034 |
| STORY-044 | STORY-032 |
| STORY-045 | STORY-044 |
| STORY-047 | STORY-037, STORY-041 |
| STORY-048 | STORY-056, STORY-059 |
| STORY-049 | STORY-058 |
| STORY-050 | STORY-052 |
| STORY-051 | STORY-050 |
| STORY-052 | STORY-053, STORY-065 |
| STORY-053 | STORY-052 |
| STORY-056 | STORY-052 |
| STORY-058 | STORY-052, STORY-065 |
| STORY-059 | STORY-051, STORY-056, STORY-058 |
| STORY-061 | STORY-065 |
| STORY-064 | STORY-058 |
| STORY-065 | STORY-048, STORY-052 |
| STORY-072 | STORY-071 |
| STORY-073 | STORY-071 |
| STORY-081 | STORY-066 |
| STORY-083 | STORY-082 |
| STORY-084 | STORY-085, STORY-086 |
| STORY-085 | STORY-082 |
| STORY-086 | STORY-084 |
| STORY-087 | STORY-088, STORY-096 |
| STORY-089 | STORY-088 |
| STORY-091 | STORY-090 |
| STORY-092 | STORY-086, STORY-093 |
| STORY-095 | STORY-094 |
| STORY-096 | STORY-087 |
| STORY-097 | STORY-082, STORY-086 |
| STORY-101 | STORY-102, STORY-103 |
| STORY-102 | STORY-101, STORY-106 |
| STORY-104 | STORY-101 |
| STORY-106 | STORY-102 |
| STORY-109 | STORY-107, STORY-108 |
| STORY-111 | STORY-110 |
| STORY-118 | STORY-119 |
| STORY-121 | STORY-122, STORY-123 |
| STORY-122 | STORY-120 |
| STORY-123 | STORY-121, STORY-124 |
| STORY-124 | STORY-121, STORY-125 |
| STORY-125 | STORY-124 |
| STORY-126 | STORY-117, STORY-125 |
| STORY-127 | STORY-117, STORY-125 |
| STORY-128 | STORY-129, STORY-141 |
| STORY-131 | STORY-129 |
| STORY-141 | STORY-128 |
| STORY-142 | STORY-151 |
| STORY-143 | STORY-152 |
| STORY-144 | STORY-142 |
| STORY-146 | STORY-144 |
| STORY-148 | STORY-144, STORY-150 |
| STORY-152 | STORY-146 |
| STORY-153 | STORY-142, STORY-144 |
| STORY-155 | STORY-144 |
| STORY-156 | STORY-152 |
| STORY-157 | STORY-158, STORY-165 |
| STORY-158 | STORY-157, STORY-165 |
| STORY-159 | STORY-168 |
| STORY-161 | STORY-170 |
| STORY-162 | STORY-157 |
| STORY-165 | STORY-158 |
| STORY-168 | STORY-159, STORY-160 |
| STORY-169 | STORY-157, STORY-159 |
| STORY-170 | STORY-161 |
| STORY-171 | STORY-157, STORY-162, STORY-165, STORY-166, STORY-167, STORY-169 |
| STORY-178 | STORY-177 |
| STORY-180 | STORY-179 |
| STORY-183 | STORY-178, STORY-184 |
| STORY-184 | STORY-172, STORY-183 |
| STORY-185 | STORY-183, STORY-184 |

## All Stories

### Agent Loops

- **STORY-001** — First loop from a template, to Active, in one sitting (long, Farid) → [topics/agent-loops.md#story-701-first-loop-from-a-template-to-active-in-one-sitting](topics/agent-loops.md#story-701-first-loop-from-a-template-to-active-in-one-sitting)
- **STORY-002** — The fix→review cycle in "Backlog → PR" — a condition node with a real loop (medium, Priya) → [topics/agent-loops.md#story-702-the-fixreview-cycle-in-backlog-pr-a-condition-node-with-a-real-loop](topics/agent-loops.md#story-702-the-fixreview-cycle-in-backlog-pr-a-condition-node-with-a-real-loop)
- **STORY-003** — Describing a loop in plain English and getting a working graph back (medium, Marcus) → [topics/agent-loops.md#story-703-describing-a-loop-in-plain-english-and-getting-a-working-graph-back](topics/agent-loops.md#story-703-describing-a-loop-in-plain-english-and-getting-a-working-graph-back)
- **STORY-004** — The AI draft comes back unusable (short, Marcus) → [topics/agent-loops.md#story-704-the-ai-draft-comes-back-unusable](topics/agent-loops.md#story-704-the-ai-draft-comes-back-unusable)
- **STORY-005** — Building from a blank definition, then finishing the graph visually (medium, Priya) → [topics/agent-loops.md#story-705-building-from-a-blank-definition-then-finishing-the-graph-visually](topics/agent-loops.md#story-705-building-from-a-blank-definition-then-finishing-the-graph-visually)
- **STORY-006** — Building an invalid graph — disconnected node, no end, and an exitless cycle (long, Farid) → [topics/agent-loops.md#story-706-building-an-invalid-graph-disconnected-node-no-end-and-an-exitless-cycle](topics/agent-loops.md#story-706-building-an-invalid-graph-disconnected-node-no-end-and-an-exitless-cycle)
- **STORY-007** — The "Archived" status claims read-only, but the builder doesn't enforce it (short, Priya) → [topics/agent-loops.md#story-707-the-archived-status-claims-read-only-but-the-builder-doesnt-enforce-it](topics/agent-loops.md#story-707-the-archived-status-claims-read-only-but-the-builder-doesnt-enforce-it)
- **STORY-008** — Tightening guardrails, and hitting the server ceiling (medium, Marcus) → [topics/agent-loops.md#story-708-tightening-guardrails-and-hitting-the-server-ceiling](topics/agent-loops.md#story-708-tightening-guardrails-and-hitting-the-server-ceiling)
- **STORY-009** — Watchdog retries a flaky step, then exhausts its budget and pauses (long, Priya) → [topics/agent-loops.md#story-709-watchdog-retries-a-flaky-step-then-exhausts-its-budget-and-pauses](topics/agent-loops.md#story-709-watchdog-retries-a-flaky-step-then-exhausts-its-budget-and-pauses)
- **STORY-010** — Adding a schedule trigger and an event trigger to the same loop (medium, Farid) → [topics/agent-loops.md#story-710-adding-a-schedule-trigger-and-an-event-trigger-to-the-same-loop](topics/agent-loops.md#story-710-adding-a-schedule-trigger-and-an-event-trigger-to-the-same-loop)
- **STORY-011** — Disabling and deleting a trigger (short, Marcus) → [topics/agent-loops.md#story-711-disabling-and-deleting-a-trigger](topics/agent-loops.md#story-711-disabling-and-deleting-a-trigger)
- **STORY-012** — The suggested-trigger nudge on "Merge when green" (medium, Priya) → [topics/agent-loops.md#story-712-the-suggested-trigger-nudge-on-merge-when-green](topics/agent-loops.md#story-712-the-suggested-trigger-nudge-on-merge-when-green)
- **STORY-013** — Pausing a running loop, then resuming it (medium, Farid) → [topics/agent-loops.md#story-713-pausing-a-running-loop-then-resuming-it](topics/agent-loops.md#story-713-pausing-a-running-loop-then-resuming-it)
- **STORY-014** — Cancelling a run mid-flight (medium, Priya) → [topics/agent-loops.md#story-714-cancelling-a-run-mid-flight](topics/agent-loops.md#story-714-cancelling-a-run-mid-flight)
- **STORY-015** — A run stalls, and the sweep catches it (long, Marcus) → [topics/agent-loops.md#story-715-a-run-stalls-and-the-sweep-catches-it](topics/agent-loops.md#story-715-a-run-stalls-and-the-sweep-catches-it)
- **STORY-016** — Run now fails to dispatch, and the 409-conflict cousin (medium, Farid) → [topics/agent-loops.md#story-716-run-now-fails-to-dispatch-and-the-409-conflict-cousin](topics/agent-loops.md#story-716-run-now-fails-to-dispatch-and-the-409-conflict-cousin)

### Authentication & Onboarding

- **STORY-017** — First-time founder connects everything and starts her first Session (long, Priya Patel) → [topics/auth-onboarding.md#story-101-first-time-founder-connects-everything-and-starts-her-first-session](topics/auth-onboarding.md#story-101-first-time-founder-connects-everything-and-starts-her-first-session)
- **STORY-018** — DevOps engineer installs the App org-wide with "All repositories" (medium, Marcus Webb) → [topics/auth-onboarding.md#story-102-devops-engineer-installs-the-app-org-wide-with-all-repositories](topics/auth-onboarding.md#story-102-devops-engineer-installs-the-app-org-wide-with-all-repositories)
- **STORY-019** — Returning, fully-connected user signs in again and hits an unnecessary extra click (short, Dana Osei) → [topics/auth-onboarding.md#story-103-returning-fully-connected-user-signs-in-again-and-hits-an-unnecessary-extra-click](topics/auth-onboarding.md#story-103-returning-fully-connected-user-signs-in-again-and-hits-an-unnecessary-extra-click)
- **STORY-020** — Org admin approval required — installation request sits pending (medium, Alex Chen) → [topics/auth-onboarding.md#story-104-org-admin-approval-required-installation-request-sits-pending](topics/auth-onboarding.md#story-104-org-admin-approval-required-installation-request-sits-pending)
- **STORY-021** — Vercel sign-in is interrupted mid-flow (short, Jordan Reyes) → [topics/auth-onboarding.md#story-105-vercel-sign-in-is-interrupted-mid-flow](topics/auth-onboarding.md#story-105-vercel-sign-in-is-interrupted-mid-flow)
- **STORY-022** — User links GitHub but backs out of installing the App (medium, Theo Marsh) → [topics/auth-onboarding.md#story-106-user-links-github-but-backs-out-of-installing-the-app](topics/auth-onboarding.md#story-106-user-links-github-but-backs-out-of-installing-the-app)
- **STORY-023** — Sam re-authenticates after IT rotates GitHub App permissions (medium, Sam Okafor) → [topics/auth-onboarding.md#story-107-sam-re-authenticates-after-it-rotates-github-app-permissions](topics/auth-onboarding.md#story-107-sam-re-authenticates-after-it-rotates-github-app-permissions)
- **STORY-024** — Global reconnect dialog interrupts an active chat session (short, Renee Castillo) → [topics/auth-onboarding.md#story-108-global-reconnect-dialog-interrupts-an-active-chat-session](topics/auth-onboarding.md#story-108-global-reconnect-dialog-interrupts-an-active-chat-session)
- **STORY-025** — Self-hosted deployment is missing its GitHub App configuration (medium, Yuki Tanaka) → [topics/auth-onboarding.md#story-109-self-hosted-deployment-is-missing-its-github-app-configuration](topics/auth-onboarding.md#story-109-self-hosted-deployment-is-missing-its-github-app-configuration)
- **STORY-026** — Mid-session-creation install, bypassing `/get-started` entirely (short, Marcus Webb) → [topics/auth-onboarding.md#story-110-mid-session-creation-install-bypassing-get-started-entirely](topics/auth-onboarding.md#story-110-mid-session-creation-install-bypassing-get-started-entirely)
- **STORY-027** — Repository creation hits the typed `github_scope_required` error (medium, Theo Marsh) → [topics/auth-onboarding.md#story-111-repository-creation-hits-the-typed-github](topics/auth-onboarding.md#story-111-repository-creation-hits-the-typed-github)_scope_required-error
- **STORY-028** — Typing `/get-started` directly when already fully onboarded (short, Dana Osei) → [topics/auth-onboarding.md#story-112-typing-get-started-directly-when-already-fully-onboarded](topics/auth-onboarding.md#story-112-typing-get-started-directly-when-already-fully-onboarded)
- **STORY-029** — Disconnecting GitHub and rediscovering the still-live installation (medium, Dana Osei) → [topics/auth-onboarding.md#story-113-disconnecting-github-and-rediscovering-the-still-live-installation](topics/auth-onboarding.md#story-113-disconnecting-github-and-rediscovering-the-still-live-installation)
- **STORY-030** — A stale session's silent 401 triggers a full global sign-out mid-workflow (long, Priya Patel) → [topics/auth-onboarding.md#story-114-a-stale-sessions-silent-401-triggers-a-full-global-sign-out-mid-workflow](topics/auth-onboarding.md#story-114-a-stale-sessions-silent-401-triggers-a-full-global-sign-out-mid-workflow)
- **STORY-031** — Signing out from the home-page header (short, Priya Patel) → [topics/auth-onboarding.md#story-115-signing-out-from-the-home-page-header](topics/auth-onboarding.md#story-115-signing-out-from-the-home-page-header)

### Background Agents

- **STORY-032** — First Agent, Repo-Scoped Builder (medium, Priya) → [topics/background-agents.md#story-601-first-agent-repo-scoped-builder](topics/background-agents.md#story-601-first-agent-repo-scoped-builder)
- **STORY-033** — "Create with AI" Prompt Goes Nowhere (short, Marcus) → [topics/background-agents.md#story-602-create-with-ai-prompt-goes-nowhere](topics/background-agents.md#story-602-create-with-ai-prompt-goes-nowhere)
- **STORY-034** — The Agent That Never Runs (Repository Allowlist) (long, Dana) → [topics/background-agents.md#story-603-the-agent-that-never-runs-repository-allowlist](topics/background-agents.md#story-603-the-agent-that-never-runs-repository-allowlist)
- **STORY-035** — Manual Test Console as the Sanity Check (medium, Priya) → [topics/background-agents.md#story-604-manual-test-console-as-the-sanity-check](topics/background-agents.md#story-604-manual-test-console-as-the-sanity-check)
- **STORY-036** — Editing — Write-Access Auto-Coercion and the Vanishing Description (medium, Priya) → [topics/background-agents.md#story-605-editing-write-access-auto-coercion-and-the-vanishing-description](topics/background-agents.md#story-605-editing-write-access-auto-coercion-and-the-vanishing-description)
- **STORY-037** — A Trigger Kind With No Condition Fields (short, Tomasz) → [topics/background-agents.md#story-606-a-trigger-kind-with-no-condition-fields](topics/background-agents.md#story-606-a-trigger-kind-with-no-condition-fields)
- **STORY-038** — Scheduling and Watching a Cron Trigger (medium, Renata) → [topics/background-agents.md#story-607-scheduling-and-watching-a-cron-trigger](topics/background-agents.md#story-607-scheduling-and-watching-a-cron-trigger)
- **STORY-039** — Finding the Webhook URL for a `webhook.error` Trigger (short, Kwame) → [topics/background-agents.md#story-608-finding-the-webhook-url-for-a-webhookerror-trigger](topics/background-agents.md#story-608-finding-the-webhook-url-for-a-webhookerror-trigger)
- **STORY-040** — Composio Tool Grants and the "Next Run" Preflight (medium, Ana) → [topics/background-agents.md#story-609-composio-tool-grants-and-the-next-run-preflight](topics/background-agents.md#story-609-composio-tool-grants-and-the-next-run-preflight)
- **STORY-041** — Building a Merge-Capable Agent With Fine-Grained Actions (medium, Sofia) → [topics/background-agents.md#story-610-building-a-merge-capable-agent-with-fine-grained-actions](topics/background-agents.md#story-610-building-a-merge-capable-agent-with-fine-grained-actions)
- **STORY-042** — The Invisible Ping-Pong Backstop (short, Yusuf) → [topics/background-agents.md#story-611-the-invisible-ping-pong-backstop](topics/background-agents.md#story-611-the-invisible-ping-pong-backstop)
- **STORY-043** — Watching a Live Run — Proof Strip and the SSE That Isn't (medium, Ben) → [topics/background-agents.md#story-612-watching-a-live-run-proof-strip-and-the-sse-that-isnt](topics/background-agents.md#story-612-watching-a-live-run-proof-strip-and-the-sse-that-isnt)
- **STORY-044** — Two Front Doors, One Agent (short, Chidi) → [topics/background-agents.md#story-613-two-front-doors-one-agent](topics/background-agents.md#story-613-two-front-doors-one-agent)
- **STORY-045** — End-to-End — Template to Production Run (long, Grace) → [topics/background-agents.md#story-614-end-to-end-template-to-production-run](topics/background-agents.md#story-614-end-to-end-template-to-production-run)
- **STORY-046** — Pause, Resume, and Reading a Failed Run (short, Hassan) → [topics/background-agents.md#story-615-pause-resume-and-reading-a-failed-run](topics/background-agents.md#story-615-pause-resume-and-reading-a-failed-run)
- **STORY-047** — A CI-Gated Trigger — `check_suite` (medium, Wei) → [topics/background-agents.md#story-616-a-ci-gated-trigger-check](topics/background-agents.md#story-616-a-ci-gated-trigger-check)_suite

### Chat Loop

- **STORY-048** — `failed` — the model provider rejects the turn outright (medium, Dana) → [topics/chat-loop.md#story-401-failed-the-model-provider-rejects-the-turn-outright](topics/chat-loop.md#story-401-failed-the-model-provider-rejects-the-turn-outright)
- **STORY-049** — `aborted` — the user clicks Stop mid-response (short, Marcus) → [topics/chat-loop.md#story-402-aborted-the-user-clicks-stop-mid-response](topics/chat-loop.md#story-402-aborted-the-user-clicks-stop-mid-response)
- **STORY-050** — `repeated_tool_failure` — a tool call fails the same way three times (medium, Priya) → [topics/chat-loop.md#story-403-repeated](topics/chat-loop.md#story-403-repeated)_tool_failure-a-tool-call-fails-the-same-way-three-times
- **STORY-051** — `max_steps` — a very long turn silently exhausts its step budget (long, Sam) → [topics/chat-loop.md#story-404-max](topics/chat-loop.md#story-404-max)_steps-a-very-long-turn-silently-exhausts-its-step-budget
- **STORY-052** — `no_progress_fuse` — watching an unattended MCP run circle in place (medium, Priya) → [topics/chat-loop.md#story-405-no](topics/chat-loop.md#story-405-no)_progress_fuse-watching-an-unattended-mcp-run-circle-in-place
- **STORY-053** — `no_file_changes` — a declared-to-edit MCP run produces no diff (medium, Marcus) → [topics/chat-loop.md#story-406-no](topics/chat-loop.md#story-406-no)_file_changes-a-declared-to-edit-mcp-run-produces-no-diff
- **STORY-054** — `no_sandbox_step_cap` — an unattended run against a no-repo session (short, Dana) → [topics/chat-loop.md#story-407-no](topics/chat-loop.md#story-407-no)_sandbox_step_cap-an-unattended-run-against-a-no-repo-session
- **STORY-055** — `step_ceiling` — the far-outer backstop fires on an otherwise-unbounded run (short, Sam) → [topics/chat-loop.md#story-408-step](topics/chat-loop.md#story-408-step)_ceiling-the-far-outer-backstop-fires-on-an-otherwise-unbounded-run
- **STORY-056** — `truncated` — a huge response silently gives up after 3 continuations (long, Priya) → [topics/chat-loop.md#story-409-truncated-a-huge-response-silently-gives-up-after-3-continuations](topics/chat-loop.md#story-409-truncated-a-huge-response-silently-gives-up-after-3-continuations)
- **STORY-057** — `diff_violation` — an MCP run edits outside its declared file list (medium, Marcus) → [topics/chat-loop.md#story-410-diff](topics/chat-loop.md#story-410-diff)_violation-an-mcp-run-edits-outside-its-declared-file-list
- **STORY-058** — `awaiting_tool_approval` — the run pauses for a decision, and it isn't a failure (long, Priya) → [topics/chat-loop.md#story-411-awaiting](topics/chat-loop.md#story-411-awaiting)_tool_approval-the-run-pauses-for-a-decision-and-it-isnt-a-failure
- **STORY-059** — `ended_unexpectedly` — the provider stops for a reason nobody asked for (medium, Dana) → [topics/chat-loop.md#story-412-ended](topics/chat-loop.md#story-412-ended)_unexpectedly-the-provider-stops-for-a-reason-nobody-asked-for
- **STORY-060** — Composing a message with an `@`-file mention and a `/`-slash skill (medium, Sam) → [topics/chat-loop.md#story-413-composing-a-message-with-an--file-mention-and-a--slash-skill](topics/chat-loop.md#story-413-composing-a-message-with-an--file-mention-and-a--slash-skill)
- **STORY-061** — Enriching a message — image, pasted text, drag-and-drop, and voice (long, Marcus) → [topics/chat-loop.md#story-414-enriching-a-message-image-pasted-text-drag-and-drop-and-voice](topics/chat-loop.md#story-414-enriching-a-message-image-pasted-text-drag-and-drop-and-voice)
- **STORY-062** — Configuring how the agent runs before sending (long, Priya) → [topics/chat-loop.md#story-415-configuring-how-the-agent-runs-before-sending](topics/chat-loop.md#story-415-configuring-how-the-agent-runs-before-sending)
- **STORY-063** — Watching a long multi-step run — thinking, subagents, todos, and cost (long, Dana) → [topics/chat-loop.md#story-416-watching-a-long-multi-step-run-thinking-subagents-todos-and-cost](topics/chat-loop.md#story-416-watching-a-long-multi-step-run-thinking-subagents-todos-and-cost)
- **STORY-064** — The approval loop in practice — Approve, Deny, Approve-all, and an inline question (long, Marcus) → [topics/chat-loop.md#story-417-the-approval-loop-in-practice-approve-deny-approve-all-and-an-inline-question](topics/chat-loop.md#story-417-the-approval-loop-in-practice-approve-deny-approve-all-and-an-inline-question)
- **STORY-065** — The MCP run lock — a headless client holds the composer, then hands it back (medium, Priya) → [topics/chat-loop.md#story-418-the-mcp-run-lock-a-headless-client-holds-the-composer-then-hands-it-back](topics/chat-loop.md#story-418-the-mcp-run-lock-a-headless-client-holds-the-composer-then-hands-it-back)

### Code Review & Ship

- **STORY-066** — Orient in the git panel — open it, switch tabs, close it (short, Priya) → [topics/code-review-ship.md#story-501-orient-in-the-git-panel-open-it-switch-tabs-close-it](topics/code-review-ship.md#story-501-orient-in-the-git-panel-open-it-switch-tabs-close-it)
- **STORY-067** — Jump from a file in the tree to its diff (medium, Marcus) → [topics/code-review-ship.md#story-502-jump-from-a-file-in-the-tree-to-its-diff](topics/code-review-ship.md#story-502-jump-from-a-file-in-the-tree-to-its-diff)
- **STORY-068** — Toggle between "All Changes" and "Uncommitted" scope (short, Sam) → [topics/code-review-ship.md#story-503-toggle-between-all-changes-and-uncommitted-scope](topics/code-review-ship.md#story-503-toggle-between-all-changes-and-uncommitted-scope)
- **STORY-069** — Download the diff as a patch file to apply elsewhere (medium, Dana) → [topics/code-review-ship.md#story-504-download-the-diff-as-a-patch-file-to-apply-elsewhere](topics/code-review-ship.md#story-504-download-the-diff-as-a-patch-file-to-apply-elsewhere)
- **STORY-070** — Review a cached diff after the sandbox goes offline (medium, Leo) → [topics/code-review-ship.md#story-505-review-a-cached-diff-after-the-sandbox-goes-offline](topics/code-review-ship.md#story-505-review-a-cached-diff-after-the-sandbox-goes-offline)
- **STORY-071** — Discard changes to a single file (short, Wei) → [topics/code-review-ship.md#story-506-discard-changes-to-a-single-file](topics/code-review-ship.md#story-506-discard-changes-to-a-single-file)
- **STORY-072** — Discard all uncommitted changes at once (medium, Nora) → [topics/code-review-ship.md#story-507-discard-all-uncommitted-changes-at-once](topics/code-review-ship.md#story-507-discard-all-uncommitted-changes-at-once)
- **STORY-073** — Review the diff, decide the agent got it wrong, and reject it (long, Elena) → [topics/code-review-ship.md#story-508-review-the-diff-decide-the-agent-got-it-wrong-and-reject-it](topics/code-review-ship.md#story-508-review-the-diff-decide-the-agent-got-it-wrong-and-reject-it)
- **STORY-074** — First full ship — branch, AI commit message, push, AI PR, preview (long, Carlos) → [topics/code-review-ship.md#story-509-first-full-ship-branch-ai-commit-message-push-ai-pr-preview](topics/code-review-ship.md#story-509-first-full-ship-branch-ai-commit-message-push-ai-pr-preview)
- **STORY-075** — Create a draft PR with auto-merge enabled (medium, Aisha) → [topics/code-review-ship.md#story-510-create-a-draft-pr-with-auto-merge-enabled](topics/code-review-ship.md#story-510-create-a-draft-pr-with-auto-merge-enabled)
- **STORY-076** — PR creation falls back to a GitHub compare page (medium, Tomás) → [topics/code-review-ship.md#story-511-pr-creation-falls-back-to-a-github-compare-page](topics/code-review-ship.md#story-511-pr-creation-falls-back-to-a-github-compare-page)
- **STORY-077** — CI is red — see failing checks and ask the agent to fix them (long, Raj) → [topics/code-review-ship.md#story-512-ci-is-red-see-failing-checks-and-ask-the-agent-to-fix-them](topics/code-review-ship.md#story-512-ci-is-red-see-failing-checks-and-ask-the-agent-to-fix-them)
- **STORY-078** — Merge blocked by a real merge conflict (medium, Yuki) → [topics/code-review-ship.md#story-513-merge-blocked-by-a-real-merge-conflict](topics/code-review-ship.md#story-513-merge-blocked-by-a-real-merge-conflict)
- **STORY-079** — Force-merge past a stuck required check (medium, Ben) → [topics/code-review-ship.md#story-514-force-merge-past-a-stuck-required-check](topics/code-review-ship.md#story-514-force-merge-past-a-stuck-required-check)
- **STORY-080** — Merge readiness that never resolves (medium, Grace) → [topics/code-review-ship.md#story-515-merge-readiness-that-never-resolves](topics/code-review-ship.md#story-515-merge-readiness-that-never-resolves)
- **STORY-081** — Merge with a chosen method, and the no-merge ending (medium, Priya) → [topics/code-review-ship.md#story-516-merge-with-a-chosen-method-and-the-no-merge-ending](topics/code-review-ship.md#story-516-merge-with-a-chosen-method-and-the-no-merge-ending)

### Failure, Empty & Gated States

- **STORY-082** — The chat error boundary is a dead end when the error is not transient (short, Priya) → [topics/failure-states.md#story-1201-the-chat-error-boundary-is-a-dead-end-when-the-error-is-not-transient](topics/failure-states.md#story-1201-the-chat-error-boundary-is-a-dead-end-when-the-error-is-not-transient)
- **STORY-083** — The shared-chat error boundary strands a signed-out visitor with no way back (short, Tom) → [topics/failure-states.md#story-1202-the-shared-chat-error-boundary-strands-a-signed-out-visitor-with-no-way-back](topics/failure-states.md#story-1202-the-shared-chat-error-boundary-strands-a-signed-out-visitor-with-no-way-back)
- **STORY-084** — A missing session falls through to Next's unbranded 404 — no boundary exists (medium, Marcus) → [topics/failure-states.md#story-1203-a-missing-session-falls-through-to-nexts-unbranded-404-no-boundary-exists](topics/failure-states.md#story-1203-a-missing-session-falls-through-to-nexts-unbranded-404-no-boundary-exists)
- **STORY-085** — The chat not-found boundary is the one dead-end recovery done right (short, Jae) → [topics/failure-states.md#story-1204-the-chat-not-found-boundary-is-the-one-dead-end-recovery-done-right](topics/failure-states.md#story-1204-the-chat-not-found-boundary-is-the-one-dead-end-recovery-done-right)
- **STORY-086** — Three feature flags, three different ways of telling the user "no" (long, Devon) → [topics/failure-states.md#story-1205-three-feature-flags-three-different-ways-of-telling-the-user-no](topics/failure-states.md#story-1205-three-feature-flags-three-different-ways-of-telling-the-user-no)
- **STORY-087** — The session-creation repo picker tells three different kinds of empty apart — mostly (medium, Aisha) → [topics/failure-states.md#story-1206-the-session-creation-repo-picker-tells-three-different-kinds-of-empty-apart-mostly](topics/failure-states.md#story-1206-the-session-creation-repo-picker-tells-three-different-kinds-of-empty-apart-mostly)
- **STORY-088** — Automations list — three empty states that must not be confused, one of which has no working retry button (long, Nora) → [topics/failure-states.md#story-1207-automations-list-three-empty-states-that-must-not-be-confused-one-of-which-has-no-working-retry-button](topics/failure-states.md#story-1207-automations-list-three-empty-states-that-must-not-be-confused-one-of-which-has-no-working-retry-button)
- **STORY-089** — A partially-invalid automation source surfaces per-item, not just as a banner (short, Nora again) → [topics/failure-states.md#story-1208-a-partially-invalid-automation-source-surfaces-per-item-not-just-as-a-banner](topics/failure-states.md#story-1208-a-partially-invalid-automation-source-surfaces-per-item-not-just-as-a-banner)
- **STORY-090** — Archived-session lockout explains itself, but its own way out isn't in reach (medium, Ravi) → [topics/failure-states.md#story-1209-archived-session-lockout-explains-itself-but-its-own-way-out-isnt-in-reach](topics/failure-states.md#story-1209-archived-session-lockout-explains-itself-but-its-own-way-out-isnt-in-reach)
- **STORY-091** — The MCP run lock is the lockout done right — reason, scope, and a guarded escape hatch (short, Ellen) → [topics/failure-states.md#story-1210-the-mcp-run-lock-is-the-lockout-done-right-reason-scope-and-a-guarded-escape-hatch](topics/failure-states.md#story-1210-the-mcp-run-lock-is-the-lockout-done-right-reason-scope-and-a-guarded-escape-hatch)
- **STORY-092** — The admin gate distinguishes "you're not an admin" from "we couldn't check" (medium, Sam) → [topics/failure-states.md#story-1211-the-admin-gate-distinguishes-youre-not-an-admin-from-we-couldnt-check](topics/failure-states.md#story-1211-the-admin-gate-distinguishes-youre-not-an-admin-from-we-couldnt-check)
- **STORY-093** — A transient auth hiccup must not sign the user out from under them (medium, Grace) → [topics/failure-states.md#story-1212-a-transient-auth-hiccup-must-not-sign-the-user-out-from-under-them](topics/failure-states.md#story-1212-a-transient-auth-hiccup-must-not-sign-the-user-out-from-under-them)
- **STORY-094** — `retry-after` is computed correctly on the server and then never read on the client (long, Wen) → [topics/failure-states.md#story-1213-retry-after-is-computed-correctly-on-the-server-and-then-never-read-on-the-client](topics/failure-states.md#story-1213-retry-after-is-computed-correctly-on-the-server-and-then-never-read-on-the-client)
- **STORY-095** — A Redis outage in production turns "create a session" into a confusing 503 (medium, an on-call engineer) → [topics/failure-states.md#story-1214-a-redis-outage-in-production-turns-create-a-session-into-a-confusing-503](topics/failure-states.md#story-1214-a-redis-outage-in-production-turns-create-a-session-into-a-confusing-503)
- **STORY-096** — The leaderboard's two empty reasons — a template for gated-vs-new done right (short, Two people on the same team: Lin) → [topics/failure-states.md#story-1215-the-leaderboards-two-empty-reasons-a-template-for-gated-vs-new-done-right](topics/failure-states.md#story-1215-the-leaderboards-two-empty-reasons-a-template-for-gated-vs-new-done-right)
- **STORY-097** — A background agent can be fully configured and permanently silent if `BACKGROUND_AGENTS_ENABLED` is off — with no user-facing signal at the point of failure (long, Priya) → [topics/failure-states.md#story-1216-a-background-agent-can-be-fully-configured-and-permanently-silent-if-background](topics/failure-states.md#story-1216-a-background-agent-can-be-fully-configured-and-permanently-silent-if-background)_agents_enabled-is-off-with-no-user-facing-signal-at-the-point-of-failure

### Public & Alternate Surfaces

- **STORY-098** — A cold visitor explores the marketing homepage before signing in (medium, Priya) → [topics/public-surfaces.md#story-1101-a-cold-visitor-explores-the-marketing-homepage-before-signing-in](topics/public-surfaces.md#story-1101-a-cold-visitor-explores-the-marketing-homepage-before-signing-in)
- **STORY-099** — A signed-in user's old bookmark to `/` bounces them straight to their sessions (short, Marcus) → [topics/public-surfaces.md#story-1102-a-signed-in-users-old-bookmark-to-bounces-them-straight-to-their-sessions](topics/public-surfaces.md#story-1102-a-signed-in-users-old-bookmark-to-bounces-them-straight-to-their-sessions)
- **STORY-100** — A self-hoster finds `/deploy-your-own` by direct link and deploys their own copy (medium, Sam) → [topics/public-surfaces.md#story-1103-a-self-hoster-finds-deploy-your-own-by-direct-link-and-deploys-their-own-copy](topics/public-surfaces.md#story-1103-a-self-hoster-finds-deploy-your-own-by-direct-link-and-deploys-their-own-copy)
- **STORY-101** — A colleague opens a shared chat link and reads through the run (medium, Jordan) → [topics/public-surfaces.md#story-1104-a-colleague-opens-a-shared-chat-link-and-reads-through-the-run](topics/public-surfaces.md#story-1104-a-colleague-opens-a-shared-chat-link-and-reads-through-the-run)
- **STORY-102** — SECURITY — a shared chat that touched a `.env` file does not leak its contents (long, Jordan) → [topics/public-surfaces.md#story-1105-security-a-shared-chat-that-touched-a-env-file-does-not-leak-its-contents](topics/public-surfaces.md#story-1105-security-a-shared-chat-that-touched-a-env-file-does-not-leak-its-contents)
- **STORY-103** — The session owner opens their own shared link and jumps back to the private view (short, The session owner) → [topics/public-surfaces.md#story-1106-the-session-owner-opens-their-own-shared-link-and-jumps-back-to-the-private-view](topics/public-surfaces.md#story-1106-the-session-owner-opens-their-own-shared-link-and-jumps-back-to-the-private-view)
- **STORY-104** — A stranger opens a dead or revoked share link (short, A stranger with a mistyped) → [topics/public-surfaces.md#story-1107-a-stranger-opens-a-dead-or-revoked-share-link](topics/public-surfaces.md#story-1107-a-stranger-opens-a-dead-or-revoked-share-link)
- **STORY-105** — A colleague watches a shared chat that is still actively streaming (medium, Jordan) → [topics/public-surfaces.md#story-1108-a-colleague-watches-a-shared-chat-that-is-still-actively-streaming](topics/public-surfaces.md#story-1108-a-colleague-watches-a-shared-chat-that-is-still-actively-streaming)
- **STORY-106** — A teammate exports a shared chat as markdown instead of screenshotting it (short, A teammate who wants to paste the conversation into an internal wiki page or PR description.) → [topics/public-surfaces.md#story-1109-a-teammate-exports-a-shared-chat-as-markdown-instead-of-screenshotting-it](topics/public-surfaces.md#story-1109-a-teammate-exports-a-shared-chat-as-markdown-instead-of-screenshotting-it)
- **STORY-107** — A stranger browses a public usage profile and filters it by date (medium, Alex) → [topics/public-surfaces.md#story-1110-a-stranger-browses-a-public-usage-profile-and-filters-it-by-date](topics/public-surfaces.md#story-1110-a-stranger-browses-a-public-usage-profile-and-filters-it-by-date)
- **STORY-108** — A stranger hits a private profile vs. a profile that doesn't exist (short, A stranger trying two different usernames.) → [topics/public-surfaces.md#story-1111-a-stranger-hits-a-private-profile-vs-a-profile-that-doesnt-exist](topics/public-surfaces.md#story-1111-a-stranger-hits-a-private-profile-vs-a-profile-that-doesnt-exist)
- **STORY-109** — The account owner turns on their public profile and shares the URL (short, The signed-in account owner) → [topics/public-surfaces.md#story-1112-the-account-owner-turns-on-their-public-profile-and-shares-the-url](topics/public-surfaces.md#story-1112-the-account-owner-turns-on-their-public-profile-and-shares-the-url)
- **STORY-110** — An external developer authorizes their MCP client against Open Agents (long, Priya) → [topics/public-surfaces.md#story-1113-an-external-developer-authorizes-their-mcp-client-against-open-agents](topics/public-surfaces.md#story-1113-an-external-developer-authorizes-their-mcp-client-against-open-agents)
- **STORY-111** — A user reads the requested scopes and DECLINES the MCP consent (medium, A security-conscious Open Agents user who does not fully trust the MCP client requesting access.) → [topics/public-surfaces.md#story-1114-a-user-reads-the-requested-scopes-and-declines-the-mcp-consent](topics/public-surfaces.md#story-1114-a-user-reads-the-requested-scopes-and-declines-the-mcp-consent)
- **STORY-112** — A mobile user checks on a running session and reads through the chat (long, Jordan) → [topics/public-surfaces.md#story-1115-a-mobile-user-checks-on-a-running-session-and-reads-through-the-chat](topics/public-surfaces.md#story-1115-a-mobile-user-checks-on-a-running-session-and-reads-through-the-chat)
- **STORY-113** — A mobile user starts a new session from their phone (long, Sam) → [topics/public-surfaces.md#story-1116-a-mobile-user-starts-a-new-session-from-their-phone](topics/public-surfaces.md#story-1116-a-mobile-user-starts-a-new-session-from-their-phone)

### Repository Workspace

- **STORY-114** — A repo doesn't show up because the App was never installed on that org (short, Farid) → [topics/repository-workspace.md#story-901-a-repo-doesnt-show-up-because-the-app-was-never-installed-on-that-org](topics/repository-workspace.md#story-901-a-repo-doesnt-show-up-because-the-app-was-never-installed-on-that-org)
- **STORY-115** — Opening a repo from the directory, and the sort order that makes yesterday's push win over the alphabet (medium, Priya) → [topics/repository-workspace.md#story-902-opening-a-repo-from-the-directory-and-the-sort-order-that-makes-yesterdays-push-win-over-the-alphabet](topics/repository-workspace.md#story-902-opening-a-repo-from-the-directory-and-the-sort-order-that-makes-yesterdays-push-win-over-the-alphabet)
- **STORY-116** — One installation is down, but the list doesn't just look empty (short, Marcus) → [topics/repository-workspace.md#story-903-one-installation-is-down-but-the-list-doesnt-just-look-empty](topics/repository-workspace.md#story-903-one-installation-is-down-but-the-list-doesnt-just-look-empty)
- **STORY-117** — The repo dashboard is a hub, not a report — and where the old report went (medium, Dana) → [topics/repository-workspace.md#story-904-the-repo-dashboard-is-a-hub-not-a-report-and-where-the-old-report-went](topics/repository-workspace.md#story-904-the-repo-dashboard-is-a-hub-not-a-report-and-where-the-old-report-went)
- **STORY-118** — Finding the repo's agents and loops on the Project page (medium, Priya) → [topics/repository-workspace.md#story-905-finding-the-repos-agents-and-loops-on-the-project-page](topics/repository-workspace.md#story-905-finding-the-repos-agents-and-loops-on-the-project-page)
- **STORY-119** — Watching a CI run go from queued to done, then reading its logs (long, Marcus) → [topics/repository-workspace.md#story-906-watching-a-ci-run-go-from-queued-to-done-then-reading-its-logs](topics/repository-workspace.md#story-906-watching-a-ci-run-go-from-queued-to-done-then-reading-its-logs)
- **STORY-120** — Manually dispatching a workflow with typed inputs (medium, Priya) → [topics/repository-workspace.md#story-907-manually-dispatching-a-workflow-with-typed-inputs](topics/repository-workspace.md#story-907-manually-dispatching-a-workflow-with-typed-inputs)
- **STORY-121** — Re-running failed jobs and cancelling a run mid-flight (short, Dana) → [topics/repository-workspace.md#story-908-re-running-failed-jobs-and-cancelling-a-run-mid-flight](topics/repository-workspace.md#story-908-re-running-failed-jobs-and-cancelling-a-run-mid-flight)
- **STORY-122** — The GitHub App itself hasn't been granted Actions permission (medium, Farid) → [topics/repository-workspace.md#story-909-the-github-app-itself-hasnt-been-granted-actions-permission](topics/repository-workspace.md#story-909-the-github-app-itself-hasnt-been-granted-actions-permission)
- **STORY-123** — Adding, rotating, and deleting a repository secret (long, Marcus) → [topics/repository-workspace.md#story-910-adding-rotating-and-deleting-a-repository-secret](topics/repository-workspace.md#story-910-adding-rotating-and-deleting-a-repository-secret)
- **STORY-124** — A read-only collaborator sees "Run workflow" and "Add secret" as clickable — and only finds out they can't when the request fails (long, Elena) → [topics/repository-workspace.md#story-911-a-read-only-collaborator-sees-run-workflow-and-add-secret-as-clickable-and-only-finds-out-they-cant-when-the-request-fails](topics/repository-workspace.md#story-911-a-read-only-collaborator-sees-run-workflow-and-add-secret-as-clickable-and-only-finds-out-they-cant-when-the-request-fails)
- **STORY-125** — Overriding this one repo's runtime and git-automation defaults (medium, Priya) → [topics/repository-workspace.md#story-912-overriding-this-one-repos-runtime-and-git-automation-defaults](topics/repository-workspace.md#story-912-overriding-this-one-repos-runtime-and-git-automation-defaults)
- **STORY-126** — Blocking a tool for this repo only, and the Vercel "link" that doesn't actually link anything here (medium, Marcus) → [topics/repository-workspace.md#story-913-blocking-a-tool-for-this-repo-only-and-the-vercel-link-that-doesnt-actually-link-anything-here](topics/repository-workspace.md#story-913-blocking-a-tool-for-this-repo-only-and-the-vercel-link-that-doesnt-actually-link-anything-here)
- **STORY-127** — Resetting every override back to defaults, and the split between the two "repo settings" pages (short, Dana) → [topics/repository-workspace.md#story-914-resetting-every-override-back-to-defaults-and-the-split-between-the-two-repo-settings-pages](topics/repository-workspace.md#story-914-resetting-every-override-back-to-defaults-and-the-split-between-the-two-repo-settings-pages)

### Runs & Automations

- **STORY-128** — From "something's wrong" to the evidence for a failed automation run (long, Priya) → [topics/runs-automations.md#story-801-from-somethings-wrong-to-the-evidence-for-a-failed-automation-run](topics/runs-automations.md#story-801-from-somethings-wrong-to-the-evidence-for-a-failed-automation-run)
- **STORY-129** — The same run, five different URLs (long, Marcus) → [topics/runs-automations.md#story-802-the-same-run-five-different-urls](topics/runs-automations.md#story-802-the-same-run-five-different-urls)
- **STORY-130** — A run says "Running" for hours — is it actually working? (short, Dana) → [topics/runs-automations.md#story-803-a-run-says-running-for-hours-is-it-actually-working](topics/runs-automations.md#story-803-a-run-says-running-for-hours-is-it-actually-working)
- **STORY-131** — Narrowing the flood with repository and trigger filters (medium, Priya again) → [topics/runs-automations.md#story-804-narrowing-the-flood-with-repository-and-trigger-filters](topics/runs-automations.md#story-804-narrowing-the-flood-with-repository-and-trigger-filters)
- **STORY-132** — An automation with an invalid definition (medium, Priya) → [topics/runs-automations.md#story-805-an-automation-with-an-invalid-definition](topics/runs-automations.md#story-805-an-automation-with-an-invalid-definition)
- **STORY-133** — One automation source is down (short, Priya) → [topics/runs-automations.md#story-806-one-automation-source-is-down](topics/runs-automations.md#story-806-one-automation-source-is-down)
- **STORY-134** — Multi-step automations are disabled in this deployment (short, An operator on a deployment where `AGENT_LOOPS_ENABLED` is off.) → [topics/runs-automations.md#story-807-multi-step-automations-are-disabled-in-this-deployment](topics/runs-automations.md#story-807-multi-step-automations-are-disabled-in-this-deployment)
- **STORY-135** — A loop run is paused by the watchdog, not by a person (medium, Priya) → [topics/runs-automations.md#story-808-a-loop-run-is-paused-by-the-watchdog-not-by-a-person](topics/runs-automations.md#story-808-a-loop-run-is-paused-by-the-watchdog-not-by-a-person)
- **STORY-136** — A loop "succeeded" but a step inside it failed (medium, Priya) → [topics/runs-automations.md#story-809-a-loop-succeeded-but-a-step-inside-it-failed](topics/runs-automations.md#story-809-a-loop-succeeded-but-a-step-inside-it-failed)
- **STORY-137** — Both run sources are down at once (short, Priya) → [topics/runs-automations.md#story-810-both-run-sources-are-down-at-once](topics/runs-automations.md#story-810-both-run-sources-are-down-at-once)
- **STORY-138** — One source degrades mid-session — pagination quietly stops (medium, Priya) → [topics/runs-automations.md#story-811-one-source-degrades-mid-session-pagination-quietly-stops](topics/runs-automations.md#story-811-one-source-degrades-mid-session-pagination-quietly-stops)
- **STORY-139** — A run's status doesn't match anything the app recognizes (short, Priya) → [topics/runs-automations.md#story-812-a-runs-status-doesnt-match-anything-the-app-recognizes](topics/runs-automations.md#story-812-a-runs-status-doesnt-match-anything-the-app-recognizes)
- **STORY-140** — "Load more" on a repository-filtered loop view returns fewer rows than expected (medium, Priya) → [topics/runs-automations.md#story-813-load-more-on-a-repository-filtered-loop-view-returns-fewer-rows-than-expected](topics/runs-automations.md#story-813-load-more-on-a-repository-filtered-loop-view-returns-fewer-rows-than-expected)
- **STORY-141** — Starting from Automations instead of Runs (long, Priya) → [topics/runs-automations.md#story-814-starting-from-automations-instead-of-runs](topics/runs-automations.md#story-814-starting-from-automations-instead-of-runs)

### Sandbox Lifecycle

- **STORY-142** — First message on a brand-new repo session provisions the sandbox (medium, Priya) → [topics/sandbox-lifecycle.md#story-301-first-message-on-a-brand-new-repo-session-provisions-the-sandbox](topics/sandbox-lifecycle.md#story-301-first-message-on-a-brand-new-repo-session-provisions-the-sandbox)
- **STORY-143** — A session goes idle and hibernates while the user is away (short, Marcus) → [topics/sandbox-lifecycle.md#story-302-a-session-goes-idle-and-hibernates-while-the-user-is-away](topics/sandbox-lifecycle.md#story-302-a-session-goes-idle-and-hibernates-while-the-user-is-away)
- **STORY-144** — Returning to a Paused session — sending a message is the only resume (medium, Priya) → [topics/sandbox-lifecycle.md#story-303-returning-to-a-paused-session-sending-a-message-is-the-only-resume](topics/sandbox-lifecycle.md#story-303-returning-to-a-paused-session-sending-a-message-is-the-only-resume)
- **STORY-145** — The reconnect probe flashes "Reconnecting" on every page load (short, Devon) → [topics/sandbox-lifecycle.md#story-304-the-reconnect-probe-flashes-reconnecting-on-every-page-load](topics/sandbox-lifecycle.md#story-304-the-reconnect-probe-flashes-reconnecting-on-every-page-load)
- **STORY-146** — A sandbox is evicted between sessions — "expired" clears the resume handle (medium, Marcus) → [topics/sandbox-lifecycle.md#story-305-a-sandbox-is-evicted-between-sessions-expired-clears-the-resume-handle](topics/sandbox-lifecycle.md#story-305-a-sandbox-is-evicted-between-sessions-expired-clears-the-resume-handle)
- **STORY-147** — Hunting for a way to extend the sandbox before a long-running task (long, Priya) → [topics/sandbox-lifecycle.md#story-306-hunting-for-a-way-to-extend-the-sandbox-before-a-long-running-task](topics/sandbox-lifecycle.md#story-306-hunting-for-a-way-to-extend-the-sandbox-before-a-long-running-task)
- **STORY-148** — Reading the disabled-tool tooltip to figure out why nothing works (short, Devon) → [topics/sandbox-lifecycle.md#story-307-reading-the-disabled-tool-tooltip-to-figure-out-why-nothing-works](topics/sandbox-lifecycle.md#story-307-reading-the-disabled-tool-tooltip-to-figure-out-why-nothing-works)
- **STORY-149** — Archiving a session while its sandbox is still live (medium, Priya) → [topics/sandbox-lifecycle.md#story-308-archiving-a-session-while-its-sandbox-is-still-live](topics/sandbox-lifecycle.md#story-308-archiving-a-session-while-its-sandbox-is-still-live)
- **STORY-150** — The Sandbox Activity dialog repeats the pill — and can disagree with it (medium, Marcus) → [topics/sandbox-lifecycle.md#story-309-the-sandbox-activity-dialog-repeats-the-pill-and-can-disagree-with-it](topics/sandbox-lifecycle.md#story-309-the-sandbox-activity-dialog-repeats-the-pill-and-can-disagree-with-it)
- **STORY-151** — Adding a sandbox to a no-repo session, and what happens when it fails (medium, Devon) → [topics/sandbox-lifecycle.md#story-310-adding-a-sandbox-to-a-no-repo-session-and-what-happens-when-it-fails](topics/sandbox-lifecycle.md#story-310-adding-a-sandbox-to-a-no-repo-session-and-what-happens-when-it-fails)
- **STORY-152** — A lifecycle marked "failed" quietly heals itself the next time anyone looks (long, Marcus) → [topics/sandbox-lifecycle.md#story-311-a-lifecycle-marked-failed-quietly-heals-itself-the-next-time-anyone-looks](topics/sandbox-lifecycle.md#story-311-a-lifecycle-marked-failed-quietly-heals-itself-the-next-time-anyone-looks)
- **STORY-153** — A restore fails because the saved sandbox is gone for good (short, Priya) → [topics/sandbox-lifecycle.md#story-312-a-restore-fails-because-the-saved-sandbox-is-gone-for-good](topics/sandbox-lifecycle.md#story-312-a-restore-fails-because-the-saved-sandbox-is-gone-for-good)
- **STORY-154** — Watching startup log lines for a slow or stuck provision (short, Devon) → [topics/sandbox-lifecycle.md#story-313-watching-startup-log-lines-for-a-slow-or-stuck-provision](topics/sandbox-lifecycle.md#story-313-watching-startup-log-lines-for-a-slow-or-stuck-provision)
- **STORY-155** — A managed-runtime profile mismatch during restore, seen only in the Inspector (medium, Priya) → [topics/sandbox-lifecycle.md#story-314-a-managed-runtime-profile-mismatch-during-restore-seen-only-in-the-inspector](topics/sandbox-lifecycle.md#story-314-a-managed-runtime-profile-mismatch-during-restore-seen-only-in-the-inspector)
- **STORY-156** — Same session, three different "what's happening with my sandbox" answers at once (long, Marcus) → [topics/sandbox-lifecycle.md#story-315-same-session-three-different-whats-happening-with-my-sandbox-answers-at-once](topics/sandbox-lifecycle.md#story-315-same-session-three-different-whats-happening-with-my-sandbox-answers-at-once)

### Session Creation

- **STORY-157** — One-click scratch chat before touching any repo (short, Marcus Webb) → [topics/session-creation.md#story-201-one-click-scratch-chat-before-touching-any-repo](topics/session-creation.md#story-201-one-click-scratch-chat-before-touching-any-repo)
- **STORY-158** — Standalone session via the full New Session dialog (short, Renata Silva) → [topics/session-creation.md#story-202-standalone-session-via-the-full-new-session-dialog](topics/session-creation.md#story-202-standalone-session-via-the-full-new-session-dialog)
- **STORY-159** — First-time repo session — the baseline happy path (medium, Priya Raman) → [topics/session-creation.md#story-203-first-time-repo-session-the-baseline-happy-path](topics/session-creation.md#story-203-first-time-repo-session-the-baseline-happy-path)
- **STORY-160** — `lastRepo` pre-fills the picker, but doesn't pre-select the tab (short, Priya Raman again) → [topics/session-creation.md#story-204-lastrepo-pre-fills-the-picker-but-doesnt-pre-select-the-tab](topics/session-creation.md#story-204-lastrepo-pre-fills-the-picker-but-doesnt-pre-select-the-tab)
- **STORY-161** — Picking an existing branch instead of the auto-generated one (medium, Théo Lefebvre) → [topics/session-creation.md#story-205-picking-an-existing-branch-instead-of-the-auto-generated-one](topics/session-creation.md#story-205-picking-an-existing-branch-instead-of-the-auto-generated-one)
- **STORY-162** — Creating a brand-new GitHub repo inline, then starting on it (medium, Sienna Park) → [topics/session-creation.md#story-206-creating-a-brand-new-github-repo-inline-then-starting-on-it](topics/session-creation.md#story-206-creating-a-brand-new-github-repo-inline-then-starting-on-it)
- **STORY-163** — Switching GitHub org and hitting the scoped-empty state (medium, Yuki Tanaka) → [topics/session-creation.md#story-207-switching-github-org-and-hitting-the-scoped-empty-state](topics/session-creation.md#story-207-switching-github-org-and-hitting-the-scoped-empty-state)
- **STORY-164** — Reconnect required mid-picker (short, Priya Raman) → [topics/session-creation.md#story-208-reconnect-required-mid-picker](topics/session-creation.md#story-208-reconnect-required-mid-picker)
- **STORY-165** — Runtime mode — switching to managed and repo-default precedence (medium, Alex Kim) → [topics/session-creation.md#story-209-runtime-mode-switching-to-managed-and-repo-default-precedence](topics/session-creation.md#story-209-runtime-mode-switching-to-managed-and-repo-default-precedence)
- **STORY-166** — Git defaults — auto commit/push, auto-PR, and full clone (medium, Renata Silva) → [topics/session-creation.md#story-210-git-defaults-auto-commitpush-auto-pr-and-full-clone](topics/session-creation.md#story-210-git-defaults-auto-commitpush-auto-pr-and-full-clone)
- **STORY-167** — Vercel environment sync — the full branch survey (long, Owen Baptiste) → [topics/session-creation.md#story-211-vercel-environment-sync-the-full-branch-survey](topics/session-creation.md#story-211-vercel-environment-sync-the-full-branch-survey)
- **STORY-168** — Starting a session from the repository dashboard (short, Grace Liu) → [topics/session-creation.md#story-212-starting-a-session-from-the-repository-dashboard](topics/session-creation.md#story-212-starting-a-session-from-the-repository-dashboard)
- **STORY-169** — Sidebar's one-click "Create session" per-repo action (medium, Felix Nakamura) → [topics/session-creation.md#story-213-sidebars-one-click-create-session-per-repo-action](topics/session-creation.md#story-213-sidebars-one-click-create-session-per-repo-action)
- **STORY-170** — Sidebar's "Create from branch" quick action (short, Isla Brennan) → [topics/session-creation.md#story-214-sidebars-create-from-branch-quick-action](topics/session-creation.md#story-214-sidebars-create-from-branch-quick-action)
- **STORY-171** — End-to-end — new repo, managed runtime, full git defaults, Vercel sync, custom title, survives a rate limit (long, Priya Raman) → [topics/session-creation.md#story-215-end-to-end-new-repo-managed-runtime-full-git-defaults-vercel-sync-custom-title-survives-a-rate-limit](topics/session-creation.md#story-215-end-to-end-new-repo-managed-runtime-full-git-defaults-vercel-sync-custom-title-survives-a-rate-limit)

### Workspace Settings & Configuration

- **STORY-172** — New teammate tunes Preferences end to end (long, Priya) → [topics/settings.md#story-1001-new-teammate-tunes-preferences-end-to-end](topics/settings.md#story-1001-new-teammate-tunes-preferences-end-to-end)
- **STORY-173** — Connect GitHub across multiple orgs, one needing admin approval (long, Marcus) → [topics/settings.md#story-1002-connect-github-across-multiple-orgs-one-needing-admin-approval](topics/settings.md#story-1002-connect-github-across-multiple-orgs-one-needing-admin-approval)
- **STORY-174** — GitHub connection degrades quietly, then needs reconnect (short, An existing user whose GitHub OAuth token silently expired.) → [topics/settings.md#story-1003-github-connection-degrades-quietly-then-needs-reconnect](topics/settings.md#story-1003-github-connection-degrades-quietly-then-needs-reconnect)
- **STORY-175** — Check usage, activity, and rank — Usage nav item redirects to Profile (medium, Dana wants to see how many tokens and how much estimated cost her account has burned this month) → [topics/settings.md#story-1004-check-usage-activity-and-rank-usage-nav-item-redirects-to-profile](topics/settings.md#story-1004-check-usage-activity-and-rank-usage-nav-item-redirects-to-profile)
- **STORY-176** — BYO-key inference profile — create, test, manage its models, then a bad key (long, Yuki has her own Anthropic API key and wants Open Agents to bill her directly for some sessions instead of the shared AI Gateway.) → [topics/settings.md#story-1005-byo-key-inference-profile-create-test-manage-its-models-then-a-bad-key](topics/settings.md#story-1005-byo-key-inference-profile-create-test-manage-its-models-then-a-bad-key)
- **STORY-177** — Set the default model, subagent model, and a per-model system prompt (medium, A power user standardizing which model new chats start with) → [topics/settings.md#story-1006-set-the-default-model-subagent-model-and-a-per-model-system-prompt](topics/settings.md#story-1006-set-the-default-model-subagent-model-and-a-per-model-system-prompt)
- **STORY-178** — Create a Model Variant with invalid JSON, then fix it (short, An engineer who wants a named "Claude Adaptive Thinking" preset) → [topics/settings.md#story-1007-create-a-model-variant-with-invalid-json-then-fix-it](topics/settings.md#story-1007-create-a-model-variant-with-invalid-json-then-fix-it)
- **STORY-179** — Build a Composio tool profile and set it as the Main role's default (medium, An admin wants every new Session's Main role to start with Gmail and Linear already connected) → [topics/settings.md#story-1008-build-a-composio-tool-profile-and-set-it-as-the-main-roles-default](topics/settings.md#story-1008-build-a-composio-tool-profile-and-set-it-as-the-main-roles-default)
- **STORY-180** — Bring your own Composio auth config (short, An engineer whose org already has its own OAuth app registered in Composio and wants sessions to use that app's credentials instead of Composio's shared connection.) → [topics/settings.md#story-1009-bring-your-own-composio-auth-config](topics/settings.md#story-1009-bring-your-own-composio-auth-config)
- **STORY-181** — Register an MCP server, edit its headers, then discover tools aren't wired into chat yet (short, An engineer with an internal MCP tool server wants its tools available to agents.) → [topics/settings.md#story-1010-register-an-mcp-server-edit-its-headers-then-discover-tools-arent-wired-into-chat-yet](topics/settings.md#story-1010-register-an-mcp-server-edit-its-headers-then-discover-tools-arent-wired-into-chat-yet)
- **STORY-182** — Author a skill by hand, then AI-generate a draft (long, A teammate wants a reusable `/code-review` instruction her agents can run like a tool) → [topics/settings.md#story-1011-author-a-skill-by-hand-then-ai-generate-a-draft](topics/settings.md#story-1011-author-a-skill-by-hand-then-ai-generate-a-draft)
- **STORY-183** — Customize Main's model and tools, leave Explorer inheriting defaults (long, A team lead wants the Main chat role to use a stronger model with GitHub write permissions) → [topics/settings.md#story-1012-customize-mains-model-and-tools-leave-explorer-inheriting-defaults](topics/settings.md#story-1012-customize-mains-model-and-tools-leave-explorer-inheriting-defaults)
- **STORY-184** — Override a repository's git automation and runtime, then reset everything (long, A maintainer wants one specific repo to always full-clone) → [topics/settings.md#story-1013-override-a-repositorys-git-automation-and-runtime-then-reset-everything](topics/settings.md#story-1013-override-a-repositorys-git-automation-and-runtime-then-reset-everything)
- **STORY-185** — Clone a built-in runtime profile and delete a profile that's the current default (medium, An engineer wants a variant of the built-in "Bun + Playwright" profile with one extra setup command) → [topics/settings.md#story-1014-clone-a-built-in-runtime-profile-and-delete-a-profile-thats-the-current-default](topics/settings.md#story-1014-clone-a-built-in-runtime-profile-and-delete-a-profile-thats-the-current-default)
- **STORY-186** — Enable the learnings agent for a repo and triage its feed (medium, A maintainer wants durable gotchas extracted from merged PRs so future agents don't repeat the same mistakes in this repo.) → [topics/settings.md#story-1015-enable-the-learnings-agent-for-a-repo-and-triage-its-feed](topics/settings.md#story-1015-enable-the-learnings-agent-for-a-repo-and-triage-its-feed)
- **STORY-187** — Non-admin hits /settings/admin directly (short, A regular team member who found `/settings/admin` in a shared link or browser history and opens it out of curiosity.) → [topics/settings.md#story-1016-non-admin-hits-settingsadmin-directly](topics/settings.md#story-1016-non-admin-hits-settingsadmin-directly)

## Redundancy Candidates

### Duplicate paths (same goal, multiple routes)

- STORY-003: PR-review-to-issues loop reachable via template gallery (STORY-001 path) or AI description path with example chip ("AI path and template gallery can converge on nearly the same graph via two different roads")
- STORY-020: Request org app installation reachable from `/get-started?step=github` (Steps) or `/settings/connections` -> "Connect" (Alternate paths)
- STORY-023: Three reconnect surfaces -- settings dropdown, `GitHubReconnectGate` modal, repo picker card -- all hitting same routes; explicitly flagged as "genuine three-surface redundancy" in Alternate paths
- STORY-029: Reconnect-after-disconnect via `/settings/connections` "Connect" button or via `/sessions` onboarding gate
- STORY-031: Sign out from three places -- avatar menu (Steps), settings shell (rendered twice, expanded/collapsed nav), mobile "Me" tab; two use different code paths (server action vs. client `authClient.signOut()`)
- STORY-032, STORY-044: New agent builder reachable via `/repos/[owner]/[repo]/agents` -> "New agent" button OR `/automations/new?repoOwner=&repoName=` with `surface="automation"`
- STORY-043: Run detail at `/background-runs/{runId}` (legacy) OR `/runs/background-agent/[runId]` (canonical) -- both render the identical `nativeDetail` block
- STORY-044: Agent detail/edit at `/automations/background-agent/{agentId}` OR `/repos/{owner}/{repo}/agents/{agentId}` -- same underlying `AgentDetailContent` component
- STORY-044: Deletion affordance exists only at `/settings/background-agents` (no alternate route)
- STORY-066: Open the git panel via keyboard shortcut (`Cmd+Shift+B`) or the panel-toggle button in the session header -- both call the same `handleGitPanelToggle` code path
- STORY-067: View a file's diff by clicking the file row in the Files tab or the Changes tab -- both call `openDiffToFile(path)` and land in the same `DiffTabView`; diff style is remembered per `defaultDiffMode` except it is always forced back to Unified on mobile
- STORY-072: Discard all uncommitted changes via the toolbar trash icon OR by discarding each file individually via the per-row trash icon -- "slower, but reaches the same end state"
- STORY-074: Create a PR via the panel's commit -> PR tab flow, OR the panel's top-bar "Create PR" chip, OR the header's "Create PR" button (sends a templated instruction to the agent), OR the agent auto-creates the PR if the session's git defaults have auto-commit/push and auto-PR enabled
- STORY-078: Resolve a merge conflict via the panel's "Merge blocked" banner "Fix conflicts" button OR the header's "Resolve Conflicts" contextual button -- "both send effectively the same instruction to the agent"
- STORY-081: Merge a PR via the panel's merge button with a method dropdown OR the header's single "Merge PR" button
- STORY-086: Discovering a capability is disabled is handled via four conflicting patterns in the same product -- GTM's silent unbranded 404, Agent Loops creation page's raw `AGENT_LOOPS_ENABLED` env-var text, the loop-run dispatch error's admin-pointed copy, and the admin-settings honest scoped gate. The file states explicitly: "the product has already solved this problem once (the admin gate) and once more in the error-copy layer, but neither pattern was reused for the two flag checks a plain user is most likely to hit"
- STORY-090 vs STORY-091: both are lockouts with a required action, but STORY-090 (archived session) explains what/why/what-to-do with the control living in the sidebar (not co-located), while STORY-091 (MCP run lock) co-locates reason, risk warning, and the resolving action at the point of friction
- STORY-084 vs STORY-085: a dangling ID (deleted session vs. deleted chat) is handled inconsistently -- missing session gets an unbranded 404 with no boundary; missing chat one level deeper gets a dedicated `ChatNotFound` boundary with a "New Chat" button
- STORY-098: Sign-in button accessible via two entry points -- the hero CTA and the nav bar (invisible until scroll reveals the hero buttons)
- STORY-107: `/u/<username>` and `/<username>` are verified identical -- `app/u/[username]/page.tsx` is a one-line re-export to `app/[username]/page.tsx`, both render the exact same server component
- STORY-117: session creation reachable from the dashboard "New Session" card or bypassed entirely via the `/sessions` repo picker
- STORY-118: agents/loops accessible via three routes -- `/project` (condensed combined view), `/agents` (standalone repo-agents dashboard), `/loops` (standalone repo-loops list) -- all showing "the same underlying data with more depth per surface"
- STORY-125: repo settings via the `/repos/{owner}/{repo}` "Repository settings" ghost button OR via `/settings/repositories` -> RepoSelector picker
- STORY-126: the Composio policy editor reachable from an active chat session's workspace settings uses the same component/implementation as `/settings/repositories/{owner}/{repo}`
- STORY-129: the same background-agent run is reachable via five/six live URLs with no redirects -- canonical `/runs/background-agent/{runId}`, legacy `/background-runs/{runId}`, plus run-history lists on `/repos/{owner}/{repo}/agents/{agentId}`, `/automations/background-agent/{agentId}`, and filtered `/runs?automationId=...&automationSource=...`; agent-loop runs have the equivalent five-URL set. Canonical and legacy routes "render the exact same `BackgroundRunDetail` component with identical run data", differing only in wrapper chrome and nav highlighting
- STORY-128, STORY-141: a failed run is reachable either via `/runs?view=attention` + filter + "View evidence", or via `/automations` + "Latest run" link (shorter, but only shows the latest run)
- STORY-135: stalled runs are reachable via `/runs?view=attention` OR directly via `/loops/{loopId}`'s own "Stalled-runs summary" widget
- STORY-149: archiving a session via "Merge & Archive" from the PR panel, OR archiving directly from the session/inbox sidebar without going through merge -- both reach the identical `isArchived` state
- STORY-157 & STORY-158: both reach the same repo-less-session destination -- STORY-157's one-click "Quick chat" button reaches the same server payload (`isNewBranch:false`, no repo fields) as STORY-158's path, "without ever showing the runtime picker"
- STORY-157 (expanded sidebar) & STORY-157 (collapsed rail): the identical "Quick chat (no repo)" action exists in two sidebar states with an identical payload
- STORY-159/STORY-160 & STORY-168: opening "New session" from the sidebar and manually re-selecting the same repo reaches the identical dialog state as starting from the repository dashboard, "with more clicks"
- STORY-161 & STORY-170: the sidebar's per-repo "Create from branch" quick action reaches the identical server-side outcome (an existing-branch session) as the full dialog flow
- STORY-169 & STORY-159: the full `SessionStarter` dialog reaches the same `{repo, isNewBranch: true}` outcome as the sidebar's per-repo `+` icon
- file-wide: the preamble notes four separate entry points that create a repo-bound session -- the full dialog, the per-repo `+` icon (STORY-169), the per-repo branch icon (STORY-170), and the repository dashboard button (STORY-168)
- STORY-172: the default runtime profile is set on Preferences, overridable per-repo (STORY-184) and per-Chat-role (STORY-183) with a fallback hierarchy
- STORY-176: a model's enabled/disabled state for pickers is editable both from the profile card's "Models" button AND the page-wide "Models shown in pickers" list -- both write the same `preferences.enabledModelIds` field
- STORY-177: the default model set here is also overridable per Chat-role (STORY-183) and per-session in the composer selector
- STORY-178: model variants are selectable in the Default model picker, the Subagent model picker, the per-Chat-role picker, and the model system-prompt picker
- STORY-179/STORY-184: tool access is configurable in Composio settings, in repository settings, and in the in-session workspace settings panel (the same component)
- STORY-182: two distinct skill mechanisms exist -- locally-authored skills edited here vs. global skills (repo pointers) configured on `/settings/preferences`
- STORY-183/STORY-184: model is overridable at the account default, Chat-role, and per-session levels; runtime profile at the account default, per-repo, and per-role levels

### Duplicate information (same fact, multiple surfaces)

- STORY-015: Retry budget counter shared between failure-watchdog invocations (STORY-009) and stall-sweep invocations ("same shared per-node counter...stall-triggered retries count against it too")
- STORY-019: "GitHub connected" status shown on three surfaces: get-started page, `/settings/connections`, and the `ProductJourney` checklist
- STORY-020: Approval pending status shown two ways -- amber notice on `/get-started` ("Installation approval pending") and as a "not_installed" org row on `/settings/connections`
- STORY-023: Reconnect required shown as a blocking modal on most pages and an inline amber warning on `/settings/connections`
- STORY-035: Manual test run result shown inline in the builder's `RunTestConsole`, also linkable via "Open full run" to the full run-detail page
- STORY-043: Run metadata proof strip (status, definition, trigger, repository, ref, sandbox, permissions, checks, duration, cost) displayed identically on both canonical and legacy run-detail routes
- STORY-044: Agent configuration/details shown on both `/automations/background-agent/{agentId}` and `/repos/{owner}/{repo}/agents/{agentId}` (same `AgentDetailContent` component)
- STORY-065: Mobile (`/m/*`) and desktop both display the same underlying `activeRunSource`/`isStreaming` tool-approval lock state -- "same underlying state, adapted layout"
- STORY-051: Run outcome shown in the chat transcript (outcome-specific stop text) and again in the `/runs` feed (collapsed to a generic "failed" badge); the `/runs` row's `detailUrl` points back to the same chat
- STORY-074: Diff stats shown in three places -- the Changes tab badge (file count only), the DiffTabView toolbar (full stats), and the PR tab's stats row (GitHub's numbers); branch name independently shown in the commit panel, the git status hook, the download-diff dialog's generated filename, and the PR readiness response's `baseBranch`
- Cross-surface duplication (file-wide): PR number/status rendered in the git panel top-bar chip, the PR tab's `InlineMergePanel`, the session header's contextual button state, and synthetic `data-pr` chat messages -- "can disagree for a few seconds after any git action"
- STORY-090: archived-session state explained via two different strings -- the overlay reads "This session is archived. Unarchive it to resume." vs. the sandbox-tools refusal reason reads "Archived sessions cannot run sandbox tools."
- STORY-094: `retry-after` information is sent twice (JSON body field `retryAfterSeconds` AND the HTTP `Retry-After` header) but the client only reads `.message` and discards both
- STORY-101: shared-chat view renders using the identical `AssistantMessageGroups`/`ToolCall`/`ThinkingBlock` components as the authenticated chat view, just non-interactive
- STORY-102 & STORY-106: the identical `redactSharedEnvContent` function is applied to both the HTML share page (STORY-102) and the markdown export (STORY-106) -- "redaction and its gaps are consistent across the HTML page and the markdown/plain-text export"
- STORY-110 & STORY-111: the same `SCOPE_DESCRIPTIONS` are shown during both the MCP approval screen (STORY-110) and the decline screen (STORY-111)
- STORY-112: the mobile tool-approval bar is wired to the same `addToolApprovalResponse` the desktop approval UI uses -- "the decision surface is shared, only the chrome is mobile-specific"
- STORY-126: integration status shown twice on the settings page -- a read-only "Integrations" group (GitHub/Vercel/Composio rows) AND a separate "Tool access" chip list with toolkit status labels; both use the same `getRepoToolkitStatusCopy` helper the (dead) repo-dashboard Tools tab would also have used
- STORY-118: agent/loop data identical across `/project`, `/agents`, `/loops`
- STORY-128: the list row shows only state/outcome/health badges; the actual attention reason (`attentionReasons` string) only renders on the detail page
- STORY-130: the detail page can show a "Live streaming" label (SSE-driven, when `status === running`) at the same time as an `Attention: stale` row two lines below it -- directly contradictory
- STORY-136: a row can show both a `Succeeded` outcome badge and a warning health badge simultaneously; the detail page's evidence table separately reads `Attention: failed_steps`
- STORY-139: the list badge can't distinguish a known, mild `warning` from a genuine `unknown` status -- only the badge text differs
- STORY-148: the identical `runtimeToolsDisabledReason` text is shown on both the "Start dev server" tooltip and the code editor icon tooltip
- STORY-150: "Connection issue" is rendered on both the Sandbox Activity dialog trigger button and again on the dialog header badge; separately, the trigger button's color (via `resolveTone()`) does not match the computed `_sandboxUiStatus.className`, which is never actually applied to any rendered element
- STORY-156: the same lifecycle state ("Hibernating") is shown across four surfaces -- the status pill, the "Start dev server" tooltip, the Sandbox Activity dialog badge, and the Runtime Inspector -- "reading overlapping but non-identical inputs... with no shared source of truth"
- STORY-166: auto-commit/push and auto-PR defaults are shown in the session-creation dialog, configurable as repo defaults under Settings -> Repository settings, with a fallback chain to account Preferences (`repoDefaults?.X ?? preferences.X`)
- STORY-158/STORY-165: runtime-mode selection appears in the full dialog's "How should the agent work?" radiogroup; server-side precedence follows `repoDefaults.runtimeMode ?? "classic"`
- STORY-160: `lastRepo` invisibly pre-seeds `selectedOwner`/`selectedRepo` state before the dialog is even visible, sourced from `/app/sessions/layout.tsx` -> `getLastRepoByUserId`
- STORY-175: leaderboard rank is shown on both the Profile page (rank badge) and the Leaderboard page; both revalidate the same SWR key (`LEADERBOARD_RANK_SWR_KEY`)

### Overlapping features/tools

- STORY-001: Three entry points split across two UI surfaces -- legacy `/loops/[id]` + `/loops/new` vs automation `/automations/agent-loop/[id]` + `/automations/agent-loop/new` -- rendering same `LoopDetail`/`BuilderCanvas` components with different `surface` prop for branding (copy, URL, redirects)
- STORY-010: Triggers card component on loop detail page ("reused unchanged by both the legacy and automation surfaces")
- STORY-026: Onboarding gate inconsistency -- the home page repo picker bypasses the `requireOnboarded()` gate that applies when entering via `/sessions`
- STORY-027: Two separate repo-creation dialog components (`create-repository-dialog.tsx`, `create-repo-dialog.tsx`) both POST to the same `/api/github/repos` endpoint -- flagged in the story's own Alternate paths as "duplication worth flagging"
- STORY-032, STORY-035, STORY-044, STORY-045: Background Agents accessible through dual surfaces -- repo-scoped legacy (`/repos/*/agents/*`) and global automation (`/automations/*`) -- sharing identical underlying `/api/background-agents` data but differing in copy ("agent" vs "Automation"), navigation targets, and with the automation surface additionally gating the Enable button behind a `readinessReady` check the repo surface does not enforce
- Chat Loop <-> MCP: browser and MCP clients share the same message stream, arbitrated by `useMcpComposerLock`'s `activeRunSource: "mcp"`; five run outcomes fire only when MCP-driven (STORY-052, STORY-053, STORY-054, STORY-055, STORY-057, STORY-065)
- Chat Loop <-> managed runtime: the `task` tool in Delegated mode delegates to managed-runtime workers, rendering as a "Managed worker" card with its own evidence panel (STORY-063)
- Chat Loop <-> Workflows: orchestration templates are selected from the composer, explicitly "separate from Direct vs Coordinated runtime mode" (STORY-062)
- Chat Loop <-> Composio: external tool connections are configured in the composer via Composio profiles/toolkits before send (STORY-062, STORY-063)
- STORY-086 overlaps Agent Loops and Background Agents: covers the loop-creation flag check, the background-dispatch error copy, and GTM surface exposure in one story
- STORY-088/STORY-089 overlap Background Agents & Agent Loops: the automations list aggregates both `background_agent` and `agent_loop` sources, and invalid-item signaling spans both
- STORY-097 overlaps Agent Loops (contrasted directly with STORY-086): "Background agents' creation flow has no equivalent hard stop -- it lets you build something that will never execute" vs. loops' `/loops/new` visibly blocking with "Loops are disabled"
- STORY-110 & STORY-111 overlap: both reference the `forceMcpConsentPrompt` hook forcing `prompt: "consent"` on every authorize call
- STORY-112 overlaps Chat Loop: the tool-approval decision mechanism is explicitly shared with the desktop Session/Chat subsystem
- STORY-113 overlaps Session Creation: desktop's `SessionStarter` has features (runtime mode selector, Vercel project link, full/shallow clone toggle) entirely absent from mobile's `MobileNewSessionScreen` form
- STORY-118: `/project` is explicitly a "condensed combined view of both" Background Agents and Agent Loops topics
- STORY-126: the Composio policy editor is "explicitly the same component/implementation" across Settings and the active chat Session workspace settings
- STORY-124: Actions and Secrets subsystems share an identical permission-boundary gap -- both only check GitHub App installation scope, never the user's actual repo permission, so read-only users see enabled write controls that fail at mutation with no mapped `repo_access_denied` error copy; Settings has an even wider gap with no repo-access check at all
- file preamble: the discovery doc's Feature Map claims a "unified feed across chat_workflow | background_agent | agent_loop", but the verified scope note confirms `/runs` only ever loads `background_agent` and `agent_loop` runs -- `chat_workflow` has a `NormalizedRun` adapter whose only caller is `lib/account-coordinator/snapshot.ts`; interactive chat runs never appear on `/runs`
- STORY-147: sandbox timeout extension has competing implementation paths -- a dedicated `POST /api/sandbox/extend` endpoint (20-minute grant, rate-limited) has no client caller anywhere in `apps/web`; the only way total sandbox lifetime is actually extended today is indirectly, by keeping the chat active
- STORY-152: two independent self-heal paths exist for `lifecycleState = "failed"` -- `/api/sandbox/status` (periodic poll) and `/api/sandbox/reconnect` (on mount) each independently detect and repair it
- STORY-154, STORY-155: managed-runtime profile setup/verification overlaps sandbox-lifecycle provisioning; a profile mismatch is only surfaced in the Runtime Inspector, not in the pill/dialog/startup-logs
- STORY-164: a stale GitHub connection requiring reconnect is detected in at least two places -- session creation and Settings -> Connections -- "not a duplicate flow, but duplicated detection"
- STORY-165/STORY-166: Settings -> Repository settings configures both repo-default runtime mode and git defaults that session creation reads
- STORY-167: Vercel project linking is extensively covered in session creation, with "Connect Vercel" and "Repo settings" deep-links inside the form itself
- STORY-165: managed-runtime profile selection for a repo is configured at `/settings/repositories/{owner}/{repo}` and read as a default during session creation
- STORY-179/STORY-184: tool access configuration overlaps across three surfaces -- Composio settings (profile-level), repository settings (repo-level block/allow), and live in-session workspace settings -- not all editing the same field
- STORY-181: MCP server tools are explicitly described as becoming "available in chats in an upcoming update", overlapping with Chat Loop
- STORY-182: skills split between locally-authored (this page) and global pointers to repo-defined skills (Preferences), explicitly noted in the source as distinct mechanisms
- STORY-183: the main Chat role is labeled "Session coordinator"; the file notes "webhook and scheduled coding work lives in Automations", overlapping with Background Agents/Agent Loops

## Gaps & Recommendations

### Source defects (block the two downstream consumers)

- **`background-agents.md` has no `**Alternate paths**:` field on any of its 16
  stories (STORY-032-STORY-047).** This isn't 16 "none found" answers — the
  field is entirely absent from the file. The flow critique, which reads this
  field to find duplicated routes, has nothing to read for the whole
  Background Agents topic; the redundancy signal reported above for this
  topic (STORY-032, STORY-035, STORY-039/044, STORY-043, STORY-044) came from
  prose in Steps/Variations/Edge Cases instead, mined by hand. Recommend the
  story author backfill the field for all 16 stories.
- **11 of `background-agents.md`'s 16 stories (STORY-037-STORY-047) also have
  no `**Ideal path**:` field.** Only STORY-032-STORY-036 have one. The browser
  walker, which measures friction against this field, has nothing to walk
  against for two-thirds of the Background Agents topic.
- **15 of `public-surfaces.md`'s 16 stories (all but STORY-112) have no
  `**Alternate paths**:` field at all** — same defect as above, smaller
  footprint. Only STORY-112 (the mobile session-check story) has the field
  populated ("none — mobile has no search, no keyboard shortcuts, no
  secondary navigation").
- **None of `runs-automations.md`'s 14 stories (STORY-128-STORY-141) carry a
  `**Topic**:` field.** Every other topic file's stories self-declare a Topic
  string that matches the file; this file's stories have no such field. The
  `## All Stories` grouping above used the file's own H1 title ("Runs &
  Automations: Cross-Surface Monitoring, Filtering, Attention Triage &
  Recovery") as a substitute — accurate, but inferred rather than read from a
  per-story field, and any downstream tool that reads the Topic field directly
  will find nothing for this entire topic.

### Feature-coverage gaps (grounded in `discovery.md`, zero-story areas)

- **Session actions with zero story coverage:** discovery.md's Sessions
  feature-map line names "fork, resend, delete-and-after; share/unshare
  publicly; mark read; debug bundle." Of these, `resend` is covered
  (chat-loop.md, STORY-051 area) and `share/unshare` is covered
  (public-surfaces.md, STORY-101-STORY-106 area). Forking a chat,
  "delete-and-after", marking a chat read, and downloading the session debug
  bundle appear in no story's Steps, Variations, or Edge Cases anywhere in the
  187-story corpus.
- **Hosted code editor happy path, and browser runs:** discovery.md's
  Workspace runtime line names the hosted code editor at
  `/codespace/[sessionId]` and "browser runs" as user-visible surfaces. The
  editor **control** is not unwalked: `sandbox-lifecycle.md` covers it in its
  disabled state twice (STORY-144 — the control is greyed out with
  "Restore the sandbox before using runtime tools."; STORY-148 — a persona
  reads the disabled-tool tooltip to find out why nothing works). What no story reaches is
  the *successful* path into the editor, so treat this as an unwalked happy
  path rather than an untouched surface. "Browser runs" appears in no story at
  all.
- **Product-surface flags are walked only at the gate, not behind it:**
  `failure-states.md` (STORY-086-STORY-097) walks what happens when GTM or
  admin tools are *off*, and no story walks the authenticated GTM suite UI,
  the Verified Build panel, or the Harness UI with its flag *on*. Agent Loops
  is **not** in this gap — STORY-001, STORY-003, STORY-005 and STORY-118 all
  run with `AGENT_LOOPS_ENABLED` on, and STORY-134 covers it off. The workflow catalog
  (`OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG`) is only seen from the outside, as an
  absent picker chip (chat-loop.md, STORY-062 area), never opened.
- **Mobile is thin:** only STORY-112 and STORY-113 are mobile-first stories
  (out of 187). The mobile "Me" tab / settings screen — the third of the
  three bottom-tab destinations discovery.md names — has no dedicated story;
  it surfaces only as a secondhand detail inside auth-onboarding.md's
  STORY-031 (one of three sign-out entry points).

### Recommendation

Before the browser walker or the flow critique run against the Background
Agents or Public Surfaces topics, backfill the missing Ideal path / Alternate
paths fields identified above — both consumers depend on exactly those
fields, and right now they have almost nothing to read for two of twelve
topics. The four zero-coverage feature areas (fork/delete-and-after/mark
read/debug bundle, codespace/browser runs, the four flag-gated feature UIs
themselves, and the mobile Me tab) are candidates for a follow-up story swarm
pass rather than a blocker to consolidation — none of them make the existing
187 stories wrong, they just mean those specific surfaces have never been
walked.
