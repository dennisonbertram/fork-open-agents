# UX Path Catalog: Open Agents API

Consolidated index of the 134 user-journey stories in `topics/`, cross-checked
against the 164-route inventory in [`discovery.md`](discovery.md).

Source of truth: `docs/ux-paths/discovery.md` (route inventory) and the 12 files in
`docs/ux-paths/topics/`. Counts below were computed by parsing those files, not estimated.

## Summary (counts by type)

| Type | Stories |
|---|---|
| short | 57 |
| medium | 59 |
| long | 18 |
| **Total** | **134** |

Other computed totals:

| Measure | Value |
|---|---|
| Topic files | 12 |
| Route files in `apps/web/app/api/**` (per discovery.md) | 164 |
| Unique `/api/**` paths in the discovery inventory | 164 |
| Method+path rows in the discovery inventory | 230 |
| Unique paths referenced by at least one topic file | 149 (90.9%) |
| Unique paths referenced by **no** topic file | 15 (9.1%) |

Coverage is measured at **path** level (does any story in the topic file reference this
route path). Method-level coverage (e.g. whether the `DELETE` of a multi-method route is
exercised) was **not** computed — treat the per-path numbers as an upper bound.

## Coverage Matrix

"API routes exercised" counts unique discovery-inventory paths referenced anywhere in that
topic file, including supporting routes borrowed from other topics — so the column sums to
more than 164.

| Feature Area | Stories | API routes exercised | Gaps |
|---|---|---|---|
| Account & GitHub connection (`account-and-github.md`) | 11 | 19 | No story touches `/api/github/repos/[owner]/[repo]/secrets*` or `/api/github/repos/[owner]/[repo]/actions/workflows*` (both nominally GitHub-integration surface); `/api/vercel/repo-projects` untouched. |
| Session lifecycle & sandbox (`session-and-sandbox.md`) | 11 | 38 | `/api/sessions/[sessionId]/browser-runs` (managed browser checks) never exercised anywhere. |
| Core chat loop (`chat-loop.md`) | 12 | 22 | `/api/sessions/[sessionId]/chats/[chatId]/debug-bundle` (both methods, incl. the signed-token read path) never exercised; `/api/transcribe` (voice input into chat) never exercised. |
| Git & PR workflow (`git-and-pr.md`) | 12 | 35 | Actions manager is only half-covered: `actions/workflows`, `actions/workflows/[workflowId]/dispatch`, and `actions/jobs/[jobId]/logs` are never called. |
| Background agents (`background-agents.md`) | 10 | 16 | Covers its own surface fully; the unified cross-source views `/api/runs` and `/api/automations` that also list its runs are never called. |
| Agent loops (`agent-loops.md`) | 10 | 14 | Full own-surface coverage. Same `/api/runs` + `/api/automations` gap. |
| Verified Build harness (`harness.md`) | 10 | 20 | Full own-surface coverage (all 14 harness paths). |
| Managed runtime profiles (`managed-runtime.md`) | 10 | 18 | Full own-surface coverage. `browser-runs`, the other managed-runtime-gated route, is missed. |
| Composio tools & repo policy (`composio.md`) | 12 | 17 | Full own-surface coverage. |
| GTM coordinator (`gtm.md`) | 12 | 11 | Full own-surface coverage (all 11 `/api/gtm/*` paths). |
| Settings & preferences (`settings.md`) | 12 | 30 | `/api/workflows/catalog` and `/api/usage/rank` never called; `/api/usage` is referenced but only from this topic. |
| Public / unauthenticated & service surfaces (`public-surfaces.md`) | 12 | 44 | Full coverage of the known public set. |
| **Repo learnings** | **0** | **0** | **No topic file exists.** `/api/learnings` and `/api/learnings/[learningId]` are wholly unexercised — a documented product subsystem with zero stories. |
| **Unified automation views** | **0** | **0** | **No topic file exists.** `/api/runs` and `/api/automations` unexercised. |

### Routes NO story exercises (15 of 164)

| Path | Methods (discovery.md) | Subsystem |
|---|---|---|
| `/api/automations` | GET | Unified automations list |
| `/api/runs` | GET | Unified automation runs list |
| `/api/learnings` | GET, POST | Repo learnings |
| `/api/learnings/[learningId]` | GET, PATCH, DELETE | Repo learnings |
| `/api/github/repos/[owner]/[repo]/secrets` | GET, POST | GitHub Secrets manager |
| `/api/github/repos/[owner]/[repo]/secrets/[name]` | PUT, DELETE | GitHub Secrets manager |
| `/api/github/repos/[owner]/[repo]/actions/workflows` | GET | GitHub Actions manager |
| `/api/github/repos/[owner]/[repo]/actions/workflows/[workflowId]/dispatch` | POST | GitHub Actions manager |
| `/api/github/repos/[owner]/[repo]/actions/jobs/[jobId]/logs` | GET | GitHub Actions manager |
| `/api/sessions/[sessionId]/browser-runs` | GET, POST | Managed browser checks |
| `/api/sessions/[sessionId]/chats/[chatId]/debug-bundle` | GET, POST | Diagnostics bundle (incl. signed-token public read) |
| `/api/transcribe` | POST | Voice input (ElevenLabs) |
| `/api/usage/rank` | GET | Usage leaderboard rank |
| `/api/vercel/repo-projects` | GET | Vercel project linking |
| `/api/workflows/catalog` | GET | Workflow catalog |

Two of these are security-relevant and unexercised: the Secrets manager (write access to
repository secrets) and the signed-token read path on `debug-bundle` (the only non-share
route that serves session data without a cookie).

## Story Dependency Graph

Edges are taken from each story's stated **Preconditions**. Unqualified `STORY-NN`
references inside a topic file resolve to that topic. Cross-topic edges are stated in
prose ("a session and a chat owned by the caller"), not as story ids — those are marked
*(inferred)*.

### Global setup (every authenticated story depends on this)

- `STORY-account-and-github-02` mints the test-auth cookie (`GET /api/dev/managed-runtime-demo`) that all 12 topics replay. Everything except the explicitly-anonymous stories depends on it.
- `STORY-session-and-sandbox-01` / `-02` create the session (and sandbox) that chat, git, harness, managed-runtime, and composio stories reuse *(inferred from prose preconditions)*.

### Within-topic edges

```
account-and-github:  01  02 → 03; 02 → 04 → 05 → 06 → 07; 02 → 08; 09; 02..07 → 10 → 11
session-and-sandbox: 01 → 05; 02 → 03 → 08; 02 → 04, 06, 07, 09, 10; 02 + 07 → 11
chat-loop:           01 → 02, 03, 06, 10; 03 → 04; 01/04 → 05; 07 → 08, 09; 11; 12 (self-contained)
git-and-pr:          03 → 01, 02, 04, 05, 06, 07, 10; 08; 09; 11; 12 (independent)
background-agents:   01 → 02 → 03, 04, 09; 05 → 06; 07; 08; 10 (self-contained)
agent-loops:         01; 02; 03 → 04 → 05, 07; 06; 08 (self-contained); 09; 10
harness:             01; 02 → 04, 05; 03 → 04; 06; 07; 08; 09; 10 (self-contained)
managed-runtime:     01 → 02 → 03; 01 → 04 → 05 → 10; 04 → 07; 06; 08; 01 → 09
composio:            01 → 02 → 03 → 04, 05; 03+05 → 06 → 07 → 08; 06 → 09; 10; 11; 12
gtm:                 01 → 02; 03 → 04 → 05 → 06; 03+04+05 → 11; 07 → 08; 03+07 → 09; 10; 12
settings:            01 → 12; 02; 03 → 04; 05; 06; 08 → 07; 09; 10; 11
public-surfaces:     01; 02 → 03, 04, 11; 05 → 06?, 11; 06; 07; 08; 09; 10; 12 (self-contained)
```

### Cross-topic state producers

| Story | State it creates that other topics need |
|---|---|
| `STORY-account-and-github-02` | Test-auth cookie (all topics) |
| `STORY-account-and-github-04`–`07` | Linked GitHub account + App installation (session/sandbox, git-and-pr, background-agents, agent-loops) |
| `STORY-session-and-sandbox-02` | Repo-backed session with a live sandbox (chat-loop long stories, git-and-pr, managed-runtime, harness) |
| `STORY-chat-loop-01` | Session + chat + persisted user message (harness `-02` needs `latestUserMessageId`) |
| `STORY-chat-loop-09` / `STORY-public-surfaces-02` | A `shareId` (public-surfaces `-03`, `-04`, `-11`) |
| `STORY-composio-03` | A Composio tool profile (settings `-07` step 4, background-agents preflight) |
| `STORY-background-agents-02` / `-05` | A background agent with cron and webhook triggers (public-surfaces `-05`, `-07`, `-11`, `-12`; composio `-09`) |
| `STORY-agent-loops-04` | A running loop run (public-surfaces `-07` sweep needs a stuck run) |
| `STORY-managed-runtime-04` | A saved runtime profile (`savedProfileId`) used by managed-runtime `-05`, `-07`, `-10`, and settings `-11`'s account-default twin |
| `STORY-settings-08` | Tool-authoring enabled + proposed tool entries (settings `-07`) |
| `STORY-git-and-pr-03` | Branch, commit, and open PR 1042 (git-and-pr `-01`, `-02`, `-04`, `-05`, `-06`, `-07`, `-10`; public-surfaces `-06` PR webhook) |

**Known conflict**: `STORY-git-and-pr-05` (merge PR 1042) and `STORY-git-and-pr-06`
(close PR 1042) are mutually exclusive terminal states on the same PR. Run `-06` against
a second PR, or run them in separate sessions.

## Execution Order

Flat, dependency-respecting order for a sequential run against a fresh local server
started with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`. Anonymous stories are placed where their
prerequisites exist, not where they could theoretically run.

1. STORY-public-surfaces-01
2. STORY-public-surfaces-08
3. STORY-account-and-github-01
4. STORY-public-surfaces-10
5. STORY-account-and-github-02
6. STORY-account-and-github-03
7. STORY-account-and-github-04
8. STORY-account-and-github-05
9. STORY-account-and-github-06
10. STORY-account-and-github-07
11. STORY-account-and-github-08
12. STORY-account-and-github-09
13. STORY-account-and-github-10
14. STORY-account-and-github-11
15. STORY-settings-01
16. STORY-settings-02
17. STORY-settings-09
18. STORY-settings-10
19. STORY-settings-03
20. STORY-settings-04
21. STORY-settings-05
22. STORY-settings-06
23. STORY-settings-11
24. STORY-settings-12
25. STORY-session-and-sandbox-01
26. STORY-session-and-sandbox-02
27. STORY-session-and-sandbox-04
28. STORY-session-and-sandbox-05
29. STORY-session-and-sandbox-10
30. STORY-session-and-sandbox-03
31. STORY-session-and-sandbox-06
32. STORY-session-and-sandbox-07
33. STORY-session-and-sandbox-11
34. STORY-session-and-sandbox-08
35. STORY-session-and-sandbox-09
36. STORY-chat-loop-01
37. STORY-chat-loop-02
38. STORY-chat-loop-03
39. STORY-chat-loop-04
40. STORY-chat-loop-05
41. STORY-chat-loop-06
42. STORY-chat-loop-10
43. STORY-chat-loop-11
44. STORY-chat-loop-07
45. STORY-chat-loop-08
46. STORY-chat-loop-09
47. STORY-chat-loop-12
48. STORY-managed-runtime-01
49. STORY-managed-runtime-02
50. STORY-managed-runtime-03
51. STORY-managed-runtime-04
52. STORY-managed-runtime-05
53. STORY-managed-runtime-09
54. STORY-managed-runtime-10
55. STORY-managed-runtime-06
56. STORY-managed-runtime-07
57. STORY-managed-runtime-08
58. STORY-git-and-pr-03
59. STORY-git-and-pr-01
60. STORY-git-and-pr-02
61. STORY-git-and-pr-04
62. STORY-git-and-pr-11
63. STORY-git-and-pr-07
64. STORY-git-and-pr-10
65. STORY-git-and-pr-05
66. STORY-git-and-pr-08
67. STORY-git-and-pr-09
68. STORY-git-and-pr-06
69. STORY-git-and-pr-12
70. STORY-harness-01
71. STORY-harness-02
72. STORY-harness-04
73. STORY-harness-05
74. STORY-harness-03
75. STORY-harness-06
76. STORY-harness-07
77. STORY-harness-08
78. STORY-harness-09
79. STORY-harness-10
80. STORY-composio-01
81. STORY-composio-12
82. STORY-composio-02
83. STORY-composio-03
84. STORY-composio-04
85. STORY-composio-05
86. STORY-composio-06
87. STORY-composio-07
88. STORY-composio-08
89. STORY-settings-08
90. STORY-settings-07
91. STORY-background-agents-01
92. STORY-background-agents-02
93. STORY-background-agents-03
94. STORY-background-agents-04
95. STORY-background-agents-05
96. STORY-background-agents-06
97. STORY-composio-09
98. STORY-background-agents-07
99. STORY-background-agents-08
100. STORY-background-agents-10
101. STORY-background-agents-09
102. STORY-agent-loops-01
103. STORY-agent-loops-02
104. STORY-agent-loops-03
105. STORY-agent-loops-04
106. STORY-agent-loops-05
107. STORY-agent-loops-06
108. STORY-agent-loops-07
109. STORY-agent-loops-10
110. STORY-agent-loops-08
111. STORY-agent-loops-09
112. STORY-public-surfaces-02
113. STORY-public-surfaces-03
114. STORY-public-surfaces-04
115. STORY-public-surfaces-05
116. STORY-public-surfaces-06
117. STORY-public-surfaces-07
118. STORY-public-surfaces-09
119. STORY-public-surfaces-11
120. STORY-public-surfaces-12
121. STORY-gtm-01
122. STORY-gtm-12
123. STORY-gtm-03
124. STORY-gtm-02
125. STORY-gtm-04
126. STORY-gtm-05
127. STORY-gtm-06
128. STORY-gtm-11
129. STORY-gtm-07
130. STORY-gtm-08
131. STORY-gtm-09
132. STORY-gtm-10
133. STORY-composio-10
134. STORY-composio-11

Notes on the order:

- `STORY-gtm-12` (cold-start empty state) must run before any GTM write story; it is placed at 122, immediately after the first read.
- `STORY-composio-10` (Composio API unreachable) needs the network to Composio broken, so it is last with `STORY-composio-11` — run those two in a separate pass with the fault injected.
- `STORY-public-surfaces-10` needs the test-auth flag toggled off in a second environment; step 4 is its enabled half only.
- Stories requiring external fault injection or seeded broken state (`account-and-github-09` revoked token, `session-and-sandbox-06` dead VM, `harness-07` failed run, `agent-loops-06` failed step, `agent-loops-09` stalled run) cannot be produced by the preceding stories alone.

## All Stories

### Account & GitHub connection — `topics/account-and-github.md` (11 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-account-and-github-01](topics/account-and-github.md) | short | First look before signing in | Find out whether she is signed in and what the app needs from her, without creating anything. |
| [STORY-account-and-github-02](topics/account-and-github.md) | short | Establish a session and read the account baseline | Get an authenticated session and see the empty starting state of her account. |
| [STORY-account-and-github-03](topics/account-and-github.md) | short | Kick off the GitHub App install before linking GitHub | Install the app on her account. |
| [STORY-account-and-github-04](topics/account-and-github.md) | medium | Complete the GitHub link and land back in the app | Have the app recognize her GitHub identity and pull in any existing App installations. |
| [STORY-account-and-github-05](topics/account-and-github.md) | medium | Install the app on the personal account and confirm it took | Install the GitHub App on her personal account and verify the app sees it. |
| [STORY-account-and-github-06](topics/account-and-github.md) | medium | Add an organization installation | Install on a second (org) account and confirm both installations coexist. |
| [STORY-account-and-github-07](topics/account-and-github.md) | medium | Browse installation repos and pick a working branch | Find `acme-labs/payments-api` through the installation and confirm its branches. |
| [STORY-account-and-github-08](topics/account-and-github.md) | short | Repository creation is a dead end | Create a new repo from inside the app. |
| [STORY-account-and-github-09](topics/account-and-github.md) | medium | Diagnose and repair a broken GitHub connection | Understand why GitHub stopped working and restore it. |
| [STORY-account-and-github-10](topics/account-and-github.md) | long | Full onboarding, end to end, with account defaults | Go from no account to a fully connected workspace with account-level and per-repo defaults set the way her team works. |
| [STORY-account-and-github-11](topics/account-and-github.md) | medium | The GitHub App webhook keeps installation state honest | Keep the app's installation records in sync with GitHub without the user doing anything. |

### Session lifecycle & sandbox — `topics/session-and-sandbox.md` (11 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-session-and-sandbox-01](topics/session-and-sandbox.md) | short | Start a scratch chat session with no repo | Get a session + initial chat id to talk to, without paying sandbox provisioning cost. |
| [STORY-session-and-sandbox-02](topics/session-and-sandbox.md) | medium | Create a repo-backed session and provision its sandbox | A running sandbox with the repo cloned on a working branch. |
| [STORY-session-and-sandbox-03](topics/session-and-sandbox.md) | medium | Pause a sandbox and resume it later | Stop paying for a running VM, then come back to the same workspace. |
| [STORY-session-and-sandbox-04](topics/session-and-sandbox.md) | short | Keep a long-running session alive (heartbeat + extend) | Prevent inactivity hibernation and push out the hard expiry. |
| [STORY-session-and-sandbox-05](topics/session-and-sandbox.md) | medium | Attach a sandbox on demand to an existing no-repo chat | Turn a sandbox-free session into one with a live VM. |
| [STORY-session-and-sandbox-06](topics/session-and-sandbox.md) | medium | Recover a session whose sandbox died upstream | Detect that the VM is gone and get back to a working state. |
| [STORY-session-and-sandbox-07](topics/session-and-sandbox.md) | medium | Archive a finished session, then bring it back | Clear the session from the active list (and stop its VM), then reactivate it. |
| [STORY-session-and-sandbox-08](topics/session-and-sandbox.md) | short | Delete a session outright | Remove the session and its chats. |
| [STORY-session-and-sandbox-09](topics/session-and-sandbox.md) | long | Full working day — provision, work, pause, resume, ship, archive | Exercise the whole session+sandbox state machine end to end alongside the surfaces that depend on a live sandbox. |
| [STORY-session-and-sandbox-10](topics/session-and-sandbox.md) | long | Multi-turn chat that drives sandbox state (message → tool run → approval → follow-up) | Hold a real conversation whose tool calls execute in the sandbox, keeping the VM alive across turns and inspecting what the agent did. |
| [STORY-session-and-sandbox-11](topics/session-and-sandbox.md) | short | Session list & status polling loop (what the dashboard actually does) | Confirm the three overlapping status surfaces agree, and quantify the redundancy. |

### Core chat loop — `topics/chat-loop.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-chat-loop-01](topics/chat-loop.md) | short | First message in a brand-new session | Create a session and get one assistant reply. |
| [STORY-chat-loop-02](topics/chat-loop.md) | short | Reload the tab mid-answer and reattach to the live stream | Get the in-flight response back without re-sending the prompt. |
| [STORY-chat-loop-03](topics/chat-loop.md) | short | Stop a runaway answer and keep the partial output | Cancel the run without losing the text already produced. |
| [STORY-chat-loop-04](topics/chat-loop.md) | medium | Retry a bad prompt by deleting it and re-asking | Remove the bad user turn plus everything after it, then ask again cleanly. |
| [STORY-chat-loop-05](topics/chat-loop.md) | medium | Fork a chat to explore a second approach | Branch the conversation at a specific assistant answer and continue differently. |
| [STORY-chat-loop-06](topics/chat-loop.md) | short | Two tabs race the same chat | Confirm only one workflow ever owns a chat. |
| [STORY-chat-loop-07](topics/chat-loop.md) | long | Multi-turn debugging session with tool results | Hold a real conversation — multiple prompts, tool output persisted between turns, a model switch mid-thread, a stop, and a resume. |
| [STORY-chat-loop-08](topics/chat-loop.md) | short | Recover from a provider that rejects reasoning history | Strip reasoning from the transcript and continue on the new model. |
| [STORY-chat-loop-09](topics/chat-loop.md) | medium | Share a finished conversation publicly, then revoke it | Publish a read-only link, verify it works logged out, then take it down. |
| [STORY-chat-loop-10](topics/chat-loop.md) | medium | Multi-chat workspace — create, rename, prune | Manage several chats in a session and delete the ones he's done with. |
| [STORY-chat-loop-11](topics/chat-loop.md) | short | Client-side assistant message persistence after a dropped connection | Push the locally buffered assistant message to the server so the transcript isn't missing a turn. |
| [STORY-chat-loop-12](topics/chat-loop.md) | long | Full lifecycle — send, share, fork, archive, delete the session | Take one session from first message to permanently deleted, touching every chat-loop surface. |

### Git & PR workflow — `topics/git-and-pr.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-git-and-pr-01](topics/git-and-pr.md) | short | See where the working tree stands before touching anything | Know the current branch, whether there are uncommitted changes, and whether a PR already exists. |
| [STORY-git-and-pr-02](topics/git-and-pr.md) | short | Review the diff three ways and pull a patch file | Read the working-tree diff, open one changed file, and download a `.patch` to apply locally. |
| [STORY-git-and-pr-03](topics/git-and-pr.md) | long | First change to first PR — the happy path | Start a session, have the agent make an edit, branch, commit, generate a PR body, open the PR. |
| [STORY-git-and-pr-04](topics/git-and-pr.md) | short | The legacy one-shot PR route | Branch and generate PR content through `/api/generate-pr`. |
| [STORY-git-and-pr-05](topics/git-and-pr.md) | medium | Merge readiness, then squash-merge and delete the branch | Confirm the PR can merge, merge it with squash, delete the branch. |
| [STORY-git-and-pr-06](topics/git-and-pr.md) | medium | Abandon the change — discard, then close the PR | Throw away working-tree edits and close the PR she opened. |
| [STORY-git-and-pr-07](topics/git-and-pr.md) | long | Multi-turn — CI fails, the agent fixes it, the PR merges | Get failing checks explained, feed them back to the agent, land the follow-up commit, merge. |
| [STORY-git-and-pr-08](topics/git-and-pr.md) | medium | Branch off an existing feature branch, not main | Start work from `feat/session-git-http-routes` rather than `main`. |
| [STORY-git-and-pr-09](topics/git-and-pr.md) | medium | Draft PR with auto-merge armed for later | Open a draft, mark it ready by opening a non-draft PR with auto-merge, verify auto-merge state. |
| [STORY-git-and-pr-10](topics/git-and-pr.md) | medium | Recover a stale session and finish the PR | Discover the sandbox is dead, resume it, and merge the PR that was already open. |
| [STORY-git-and-pr-11](topics/git-and-pr.md) | medium | Validation sweep across every git route | Confirm each git route rejects malformed input before doing sandbox or GitHub work. |
| [STORY-git-and-pr-12](topics/git-and-pr.md) | short | Repo-level PR overview instead of session-level | See open PRs, issues, Actions state, and agent runs for one repo in one place. |

### Background agents — `topics/background-agents.md` (10 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-background-agents-01](topics/background-agents.md) | short | Check readiness before creating the first agent | Learn whether the feature is enabled and whether she has write access to `acme-corp/checkout-service`. |
| [STORY-background-agents-02](topics/background-agents.md) | short | Create a cron-scheduled dependency-audit agent | Have an agent run every weekday morning and open a PR bumping vulnerable dependencies. |
| [STORY-background-agents-03](topics/background-agents.md) | medium | Manual test dispatch and watch the run stream | Prove the agent actually runs before waiting for the cron window. |
| [STORY-background-agents-04](topics/background-agents.md) | short | Cron sweep fires the schedule (service auth) | Dispatch every agent whose `nextRunAt` window has arrived. |
| [STORY-background-agents-05](topics/background-agents.md) | medium | External error webhook triggers an incident-triage agent | A production error creates a run that investigates and comments on the tracking issue. |
| [STORY-background-agents-06](topics/background-agents.md) | short | Preflight external toolkits before enabling an agent | Confirm the Linear and Slack toolkits will actually be available to the next run. |
| [STORY-background-agents-07](topics/background-agents.md) | long | Full lifecycle of a PR-review agent (multi-turn, event-driven) | An agent that reviews opened PRs, is tuned across several dispatches based on observed run evidence, and finally gets merge authority. |
| [STORY-background-agents-08](topics/background-agents.md) | medium | Deployment-failure agent with a repo-scoped run feed | React to failed production deployments and open a rollback PR, then audit the last week of runs for that repo only. |
| [STORY-background-agents-09](topics/background-agents.md) | short | Delete an agent and confirm the runs outlive it | Remove the agent without losing the audit trail. |
| [STORY-background-agents-10](topics/background-agents.md) | long | Two agents on one repo, one cron sweep, ping-pong guarded | Have the fixer respond to the reviewer's findings without the two agents triggering each other forever. |

### Agent loops — `topics/agent-loops.md` (10 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-agent-loops-01](topics/agent-loops.md) | short | Check whether loops are usable for my repo before building one | Find out whether the loops feature is on and whether her repo is allowlisted, before wasting time in the builder. |
| [STORY-agent-loops-02](topics/agent-loops.md) | short | Draft a loop from a plain-English description | Turn "keep the nightly build green" into a starting loop definition. |
| [STORY-agent-loops-03](topics/agent-loops.md) | short | Hand-author a loop and fix a rejected definition | Create a loop from a hand-written definition, recovering from a validation rejection. |
| [STORY-agent-loops-04](topics/agent-loops.md) | medium | Activate a loop and run it manually end to end | Activate the loop, start a run by hand, watch it, and confirm completion. |
| [STORY-agent-loops-05](topics/agent-loops.md) | medium | Pause, inspect, resume, and finish a long run | Halt a running loop mid-flight, read where it got to, then let it continue. |
| [STORY-agent-loops-06](topics/agent-loops.md) | medium | Retry a failed step, then give up and cancel | Retry the current step once; when it fails again, cancel the run and read the failure evidence. |
| [STORY-agent-loops-07](topics/agent-loops.md) | medium | Put a loop on a nightly schedule | Add a cron trigger, verify its humanized text, retune it, then disable it. |
| [STORY-agent-loops-08](topics/agent-loops.md) | long | Full lifecycle — draft, tune guardrails, enable the watchdog, run, intervene, archive | Exercise the whole loop surface in one sitting, including a multi-turn. |
| [STORY-agent-loops-09](topics/agent-loops.md) | short | Operator sweeps stalled runs on a cron | Mark runs stalled when their latest event is older than `AGENT_LOOPS_STALL_MINUTES`. |
| [STORY-agent-loops-10](topics/agent-loops.md) | medium | Diagnose "why did my loop stop doing anything?" | Work out whether the cause is the trigger, the allowlist, the loop status, or a failing run. |

### Verified Build harness — `topics/harness.md` (10 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-harness-01](topics/harness.md) | short | Check whether Verified Build is even switched on | Know if the harness is reachable before telling a user to start a run. |
| [STORY-harness-02](topics/harness.md) | short | Start a Verified Build run explicitly for a chat | Get a `verifiedBuildRun` queued against an existing session + chat. |
| [STORY-harness-03](topics/harness.md) | short | Chat message auto-routes into Verified Build | Have a code-changing request intercepted and turned into a gated run rather than a free-form agent stream. |
| [STORY-harness-04](topics/harness.md) | medium | Watch a run live over SSE, disconnect, and replay | Stream events, survive a dropped connection, and not lose or double-count events. |
| [STORY-harness-05](topics/harness.md) | medium | Approve a pending gate and let the run continue | Unblock a run sitting at `pending_approval`. |
| [STORY-harness-06](topics/harness.md) | short | Cancel a run that is going the wrong way | Stop the run and confirm the local record reflects it. |
| [STORY-harness-07](topics/harness.md) | medium | Diagnose a failed run and repair from a capsule | Read the failure capsule, then relaunch the failed step. |
| [STORY-harness-08](topics/harness.md) | medium | Collect the evidence pack after a successful run | Pull artifacts, the final report, the audit trail, and an export plan. |
| [STORY-harness-09](topics/harness.md) | short | Inspect a workcell referenced by run events | Resolve a workcell id seen in the event stream to its detail record. |
| [STORY-harness-10](topics/harness.md) | long | Full multi-turn build — chat, gates, failure, repair, evidence | Take one plain-English request all the way to an approved, evidenced, succeeded run. |

### Managed runtime profiles — `topics/managed-runtime.md` (10 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-managed-runtime-01](topics/managed-runtime.md) | short | See what runtimes are available before starting work | Find out which runtime profiles exist and which one the session is on. |
| [STORY-managed-runtime-02](topics/managed-runtime.md) | short | Agent drafts a profile and the user reads it back | Persist the agent's `setup_managed_runtime_profile` tool call as a reviewable draft. |
| [STORY-managed-runtime-03](topics/managed-runtime.md) | medium | Test the draft in the live sandbox before approving | Execute the draft's verification (then setup+verification) commands in the session sandbox and read the evidence. |
| [STORY-managed-runtime-04](topics/managed-runtime.md) | long | Multi-turn draft → revise → re-test → approve | Land a working profile through a full revise/approve conversation, ending with the profile applied to the session. |
| [STORY-managed-runtime-05](topics/managed-runtime.md) | medium | Edit a saved session profile and re-earn its badge | Update the saved profile's commands and get a fresh passing test. |
| [STORY-managed-runtime-06](topics/managed-runtime.md) | short | Test a profile with no sandbox, then after resuming | Understand why the test button fails and recover. |
| [STORY-managed-runtime-07](topics/managed-runtime.md) | short | Delete a session profile and fall back to the built-in | Remove the saved profile and confirm affected sessions fall back safely. |
| [STORY-managed-runtime-08](topics/managed-runtime.md) | medium | Promote a runtime to an account-wide default | Create a user-default profile and make it the account default for new sessions. |
| [STORY-managed-runtime-09](topics/managed-runtime.md) | short | Switch a running session between classic and managed runtime | Flip the session to managed runtime with a specific profile. |
| [STORY-managed-runtime-10](topics/managed-runtime.md) | medium | Reviewer audits a profile's evidence across every surface | Cross-check the same test evidence wherever the API exposes it, and spot disagreement. |

### Composio tools & repo policy — `topics/composio.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-composio-01](topics/composio.md) | short | First look at tool integrations | Find out whether Composio is configured on this deployment and what can be connected. |
| [STORY-composio-02](topics/composio.md) | short | Connect a Gmail account via managed OAuth | Get a redirect URL, complete OAuth, confirm the account shows connected. |
| [STORY-composio-03](topics/composio.md) | short | Create a reusable tool profile | Persist a named profile the agents can be pointed at. |
| [STORY-composio-04](topics/composio.md) | short | Edit and delete a profile | Rename one profile, delete another. |
| [STORY-composio-05](topics/composio.md) | medium | Set per-agent-role defaults | Main agent gets the support profile and may be overridden per chat; explorer/executor/design get nothing. |
| [STORY-composio-06](topics/composio.md) | medium | Lock a repository down to one profile and block a toolkit | Only the vetted profile is selectable on this repo, and Gmail is pre-emptively blocked. |
| [STORY-composio-07](topics/composio.md) | medium | Chat-level profile selection is refused by repo policy | Confirm the repo allowlist actually blocks the selection at chat level. |
| [STORY-composio-08](topics/composio.md) | short | Fork a chat and confirm the tool selection carries | Verify the forked chat inherits `composioSelection`. |
| [STORY-composio-09](topics/composio.md) | medium | Background agent tool preflight before a scheduled run | Predict, without running anything, whether the agent's toolkits will actually be available under repo policy. |
| [STORY-composio-10](topics/composio.md) | medium | Composio is down — every surface degrades honestly | Distinguish "genuinely no connections" from "couldn't check right now" across every read surface. |
| [STORY-composio-11](topics/composio.md) | long | End-to-end governed rollout, multi-turn chat with tool approvals | Connect two toolkits, build two profiles, govern the repo, wire agent roles, run a real multi-turn chat that uses the tools, then tighten policy mid-flight and see the chat selection reconciled. |
| [STORY-composio-12](topics/composio.md) | short | Repo policy with no Composio profiles at all | Save a policy that allows nothing, without having created any profile. |

### GTM coordinator — `topics/gtm.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-gtm-01](topics/gtm.md) | short | Founder checks the morning GTM brief | See what changed in GTM over the last day before standup. |
| [STORY-gtm-02](topics/gtm.md) | short | Drill into one GTM work item from the brief | Get the detailed diagnosis behind a single brief row. |
| [STORY-gtm-03](topics/gtm.md) | short | Research an inbound account and get a cited brief | Turn raw findings into a brief where only cited claims survive. |
| [STORY-gtm-04](topics/gtm.md) | short | Prep for a discovery call | Generate a concise call brief with risks and questions. |
| [STORY-gtm-05](topics/gtm.md) | medium | Debrief the call and approve the follow-up it proposes | Capture notes, get structured next steps, and release the proposed follow-up. |
| [STORY-gtm-06](topics/gtm.md) | medium | Draft outbound email and hold it behind the approval gate | Stage an email that cannot leave the system until explicitly approved. |
| [STORY-gtm-07](topics/gtm.md) | medium | Run the activation watcher over at-risk signups | Classify signup telemetry into activation signals with drafted interventions. |
| [STORY-gtm-08](topics/gtm.md) | short | Deny an activation intervention | Reject the drafted intervention so it never fires. |
| [STORY-gtm-09](topics/gtm.md) | medium | Weekly review — approve, deny, and merge learnings | Convert the week's experiments into durable learnings under an approval gate. |
| [STORY-gtm-10](topics/gtm.md) | long | Full account cycle — research to signed pilot | Take an inbound account from cold research to an approved outbound follow-up and a recorded learning. |
| [STORY-gtm-11](topics/gtm.md) | long | Multi-turn approval negotiation across a single opportunity | Iterate on an outbound message through several rejected drafts until one is approved. |
| [STORY-gtm-12](topics/gtm.md) | short | Cold-start account with no GTM data | Confirm every GTM read returns a usable empty state rather than an error. |

### Settings & preferences — `topics/settings.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-settings-01](topics/settings.md) | short | First-run preference tour | See what defaults are in effect and change the diff view to split. |
| [STORY-settings-02](topics/settings.md) | short | Pick the default model and trim the model picker | Default new chats to a cheap model and hide models they never use. |
| [STORY-settings-03](topics/settings.md) | medium | Bring your own inference endpoint end to end | Register a BYO endpoint, verify it works, and make it the account default. |
| [STORY-settings-04](topics/settings.md) | short | Delete an inference profile that is currently the default | Remove the profile and confirm nothing still points at it. |
| [STORY-settings-05](topics/settings.md) | medium | Author, refine, and retire a Skill | Create a Skill, restrict its tools, enable it globally, then delete it. |
| [STORY-settings-06](topics/settings.md) | short | Draft a Skill with AI, then save the edited draft | Generate a draft, tweak the name, and persist it. |
| [STORY-settings-07](topics/settings.md) | medium | Configure the four agent roles | Give each role its own model and instructions, enable GitHub tools on main only, then reset one role. |
| [STORY-settings-08](topics/settings.md) | long | Multi-turn tool-authoring approval loop | Enable tool authoring, let the agent propose tools across a chat, then approve one and reject another. |
| [STORY-settings-09](topics/settings.md) | medium | Custom model variant with provider options | Create a named variant, use it as the default, then delete it. |
| [STORY-settings-10](topics/settings.md) | medium | MCP server registration lifecycle | Register a server with auth headers, toggle transport, disable it, delete it. |
| [STORY-settings-11](topics/settings.md) | medium | Custom managed-runtime profile as an account default | Create a reusable runtime profile, make it the account default, then delete it and see the preference reset. |
| [STORY-settings-12](topics/settings.md) | medium | Per-repo overrides and reset to inherited | Override sandbox size, clone depth, and auto-PR for one repo only, then reset it. |

### Public / unauthenticated & service surfaces — `topics/public-surfaces.md` (12 stories)

| ID | Type | Story | One-line summary |
|---|---|---|---|
| [STORY-public-surfaces-01](topics/public-surfaces.md) | short | Uptime monitor probes the deployment without credentials | Confirm the deployment is alive and that the Redis rate-limit backend behind authenticated routes is actually reachable. |
| [STORY-public-surfaces-02](topics/public-surfaces.md) | medium | Anonymous visitor reads a shared chat as markdown | Read the full transcript of a shared chat, and grab the raw markdown to paste into a PR description. |
| [STORY-public-surfaces-03](topics/public-surfaces.md) | short | Env content in a shared chat must stay redacted | Prove that secrets pasted into a chat are not leaked through the public markdown endpoint. |
| [STORY-public-surfaces-04](topics/public-surfaces.md) | medium | Anonymous client polls a live shared chat | Know when the shared chat stops streaming so they can re-fetch the final transcript. |
| [STORY-public-surfaces-05](topics/public-surfaces.md) | medium | External error tracker triggers a background agent by signed webhook | When a production error fires, have the matching background agent open a run automatically. |
| [STORY-public-surfaces-06](topics/public-surfaces.md) | medium | GitHub App delivers a PR-closed webhook and the session is archived | When a PR linked to an Open Agents session is merged or closed, mark the session's PR status and archive its sandbox. |
| [STORY-public-surfaces-07](topics/public-surfaces.md) | medium | Scheduler drives the two cron service endpoints | Dispatch due background agents and sweep stalled agent-loop runs on a schedule, and confirm both refuse unauthenticated callers. |
| [STORY-public-surfaces-08](topics/public-surfaces.md) | medium | Signed-out visitor discovers what the app offers before creating an account | See which models the platform supports and whether Verified Build is enabled, then start sign-in — without hitting a wall of 401s. |
| [STORY-public-surfaces-09](topics/public-surfaces.md) | short | Caller hits the deprecated and permanently-disabled stubs | Find out which endpoints were retired and what replaced them, from the responses alone. |
| [STORY-public-surfaces-10](topics/public-surfaces.md) | short | Dev-only test-auth surface must be invisible in production | Confirm `/api/dev/managed-runtime-demo` 404s unless test auth is explicitly enabled, and that when enabled it sets a test-auth cookie. |
| [STORY-public-surfaces-11](topics/public-surfaces.md) | long | Full public-surface sweep for a security review | Enumerate the unauthenticated attack surface, confirm each route's failure mode, and confirm nothing outside the known public set answers without a cookie. |
| [STORY-public-surfaces-12](topics/public-surfaces.md) | long | Signed webhook drives a full unattended agent run, end to end | Have a production alert fan out into an automated triage run, watch it, approve the gated step, and read the result — with the only unauthenticated actor being the alerting service. |
## Redundancy Candidates

All items below are quoted or condensed from the redundancy notes the topic authors
recorded while reading the route code. Nothing here has been verified as safe to remove.

### Duplicate paths (same goal, multiple routes)

| Goal | Routes | Note |
|---|---|---|
| Pause a sandbox | `DELETE /api/sandbox`, `POST /api/sandbox/snapshot` | Both call `connectSandbox(...).stop()` and clear `sandboxState`; differ only in response shape, `lifecycleVersion` bump, and rate limiting. |
| Create/resume a sandbox | `POST /api/sandbox`, `PUT /api/sandbox/snapshot` | Create-or-resume vs. resume-only; both reach "running" for a hibernated named sandbox. |
| Attach a sandbox to a no-repo session | `POST /api/sessions/[sessionId]/sandbox`, `POST /api/sandbox` | The former is a DB-only intent flag; only the latter creates a VM. |
| Reconnect to a live chat stream | `GET /api/chat/[chatId]/stream`, re-`POST /api/chat` (returns `action:"resume"`) | Same readable replayed. |
| Persist an assistant message | `POST .../chats/[chatId]/messages`, `POST /api/chat/[chatId]/stop` with `assistantMessage`, implicit persistence inside `POST /api/chat` | Three write paths. |
| Set a chat title | `POST /api/generate-title`, `PATCH .../chats/[chatId]` `{title}`, auto-title inside the chat workflow | Three. |
| Create a branch | `POST /api/sessions/[sessionId]/git/branch`, `POST /api/generate-pr` `{createBranchOnly:true}` | Both auto-name and persist `session.branch`. |
| Generate PR title/body | `POST .../git/pr/generate`, `POST /api/generate-pr` | Both call `generatePullRequestContentFromSandbox`; error contracts disagree (409 vs 400 for "Sandbox not initialized"). |
| Start a Verified Build run | `POST /api/harness/runs`, `POST /api/chat` (auto-route) | Same DB record, different contracts (202 JSON vs 200 SSE). |
| Act on a harness approval gate | `POST .../approve`, `POST .../repair` with `approvalKind` | `/repair` does not validate the kind. |
| Managed runtime profile CRUD | `/api/settings/runtime-profiles*`, `/api/sessions/[sessionId]/managed-runtime/profiles*` | `commandSchema` + `updateProfileSchema` literally duplicated in both files; only the session-scoped one can run a test. |
| Cron/sweep endpoints | `GET` and `POST /api/background-agents/cron`; `GET` and `POST /api/agent-loops/sweep` | Each pair shares one handler with identical semantics. |
| Trigger a background-agent run | signed background webhook, signed GitHub webhook, cron secret endpoint, authenticated manual test | Four convergent paths, four auth schemes, one result shape. |
| Force an installation sync | `/api/github/connection-status`, `/api/github/orgs/install-status`, `/api/github/app/install`, `/api/github/app/callback`, `/api/github/post-link` | Five routes fire `syncUserInstallations` as a side effect; there is no dedicated `POST /sync`. |

### Duplicate information (same data from multiple endpoints)

| Data | Endpoints |
|---|---|
| Sandbox liveness | `GET /api/sandbox/status`, `GET /api/sandbox/reconnect` (byte-identical `lifecycle` block), `GET /api/sessions/[sessionId]` (raw `sandboxState`) |
| Chat streaming state | `GET .../chats/[chatId]` (`isStreaming`), `GET /api/chat/[chatId]/stream` (204 vs stream), `GET /api/shared/[shareId]/status` |
| Background-agent run status + output URL | `/api/background-agent-runs`, `/api/background-agent-runs/[runId]`, `.../[runId]/stream`, `/api/background-agents/[agentId]/status`, `/api/account/diagnosis?source=background_agent` — five surfaces |
| Loop run data | `/api/agent-loops/[loopId]/runs` (has `failedStepCount`), `/api/agent-loop-runs/[runId]` (has steps/events, no `failedStepCount`), `/api/account/diagnosis?source=agent_loop` — no single endpoint gives both |
| Loop triggers | embedded in `GET /api/agent-loops/[loopId]` and standalone at `.../triggers` (only the standalone adds `humanizedSchedule`) |
| Harness run events | SSE `/events`, `GET /api/harness/runs/[runId]`, `GET /api/harness/runs?sessionId&chatId` |
| Harness pending-approval kind | `run.pendingApprovalKind`, `harnessRun.pending_approvals[]`, `harnessRun.pending_approval_details[].approval_kind` — `collectPendingApprovalKinds` unions all three because they are known to disagree |
| Harness artifacts | `/runs/[runId]/artifacts` and `/artifacts/[artifactId]?runId=` |
| Managed runtime test evidence | profiles list, profile detail GET, profile `/test` POST, and `/api/sessions/[sessionId]/observability` — four |
| Runtime profile listing | `/api/sessions/[sessionId]/managed-runtime/profiles` and `/api/settings/runtime-profiles` — same built-ins, differ only in `source` |
| GitHub link state | `/api/auth/info`, `/api/github/connection-status`, `/api/github/orgs/install-status` |
| Installation list | `/api/github/installations`, `/api/github/orgs/install-status`, `/api/auth/info` (boolean only) |
| GitHub user profile | `/api/github/user`, `/api/github/orgs/install-status` |
| Org list | `/api/github/orgs`, `/api/github/orgs/install-status` |
| Composio config status | `GET /api/composio/status` and the `status` block inside `GET /api/settings/composio` — both call `connectedAccounts.list` |
| Composio repo policy + profile options | `GET /api/settings/composio?repoOwner=&repoName=` and `GET /api/settings/repositories/[owner]/[repo]/composio` — same payload plus an echo |
| Composio profile list | `GET /api/settings/composio` and every repo-scoped GET/PATCH response |
| Windowed activity snapshot | `/api/gtm/brief` and `/api/account/status` — same query contract |
| Diagnosis | `/api/gtm/diagnosis` and `/api/account/diagnosis` — differ only in the allowed `source` enum |
| GTM approval ids | returned inline by outbound drafts, activation watcher, call debrief, and weekly review, plus the approvals route — at least five places |
| `shareId` | returned identically by `POST` and `GET` on `.../chats/[chatId]/share` |
| Default model id | `/api/settings/preferences` and `GET /api/sessions/[sessionId]/chats` (`defaultModelId`) |
| Unauthenticated liveness-ish probes | `/api/health`, `/api/models`, `/api/harness/ready`, `/api/auth/info` |

### Overlapping features

- **Model selection is writable at four layers** — preferences `defaultModelId`, agent role, chat `PATCH`, and background-agent/loop `modelId`. No endpoint reports the effective winner.
- **Two "Skills" concepts share a name** — `/api/settings/skills` (DB rows) vs `/api/sessions/[sessionId]/skills` (sandbox filesystem discovery).
- **Two per-agent toolkit assignment mechanisms** — profile-based (`/api/settings/composio` defaults + repo `agentDefaults`) and row-based (`/api/settings/agents` `composioProfileId`/`composioToolkitSlugs`).
- **Composio state is split four ways** — `/api/composio/status`, `/api/composio/connected-accounts`, `/api/settings/composio`, `/api/settings/repositories/.../composio`.
- **Three autonomous-execution subsystems with parallel shapes** — background agents, agent loops, and the Verified Build harness each have their own runs, events, triggers, cron/sweep, and status routes; `/api/runs` and `/api/automations` exist to re-unify them (and are exercised by no story).
- **Two proactive-vs-reactive readiness idioms** — `/api/agent-loops/readiness` and `/api/background-agents/readiness` vs. discovering the same allowlist rejection from a failed run POST.
- **Dead or disabled routes still in the surface** — `POST|DELETE /api/sessions/[sessionId]/share` (410), `POST /api/github/create-repo` (501), `GET /api/vercel/projects/[idOrName]/env` (404 stub), and the unreachable `fetchPublicGitHubBranches` fallback inside `/api/github/branches`.

## Gaps & Recommendations

**Coverage gaps (computed, not estimated)**

1. **15 of 164 routes (9.1%) have no story at all.** The two clusters that matter most:
   - *Repo learnings* (`/api/learnings`, `/api/learnings/[learningId]`) — a subsystem named in `CLAUDE.md` and in discovery's Feature Map, with zero stories. It needs its own topic file.
   - *GitHub Secrets + Actions workflows* (5 routes) — the highest-privilege routes in the app (write repo secrets, dispatch workflows) and none are exercised. `git-and-pr.md` covers Actions *runs* but stops before workflows, dispatch, job logs, and secrets.
2. **`/api/runs` and `/api/automations`** — the unified cross-subsystem views — are untested despite being the aggregation layer over three subsystems that *are* heavily tested.
3. **`debug-bundle`'s signed-token read path** is the only cookie-free route that serves private session data and it appears in no story, including the security-review sweep (`STORY-public-surfaces-11`).
4. **`/api/sessions/[sessionId]/browser-runs`** is missed by both the session and the managed-runtime topics even though it is managed-runtime-gated.
5. **`/api/transcribe`, `/api/usage/rank`, `/api/vercel/repo-projects`, `/api/workflows/catalog`** are single-route features with no story each.
6. **Method-level coverage is unknown.** Path coverage was computed; whether every `DELETE`/`PATCH` on a multi-method route is exercised was not. 230 method+path rows exist against 164 paths, so up to 66 method variants may be uncovered inside "covered" paths.

**Execution gaps**

7. Five stories require state no other story can produce (revoked GitHub token, dead VM, failed harness run, failed loop step, stalled loop run). A fixture/seed script is a prerequisite for a fully automated sequential run.
8. `STORY-git-and-pr-05` and `-06` contend for the same PR; the catalog order runs `-06` after `-05`, which will fail unless a second PR is opened.
9. `STORY-composio-10` requires the Composio API to be unreachable — it cannot share a process with the other Composio stories.

**Recommendations, in priority order**

1. Add a `topics/learnings-and-automations.md` covering `/api/learnings*`, `/api/runs`, and `/api/automations` (6 routes, closes 6 of the 15 gaps).
2. Extend `git-and-pr.md` (or add `topics/github-actions-and-secrets.md`) for workflows/dispatch/job-logs/secrets — 5 routes, and the ones with the worst blast radius if broken.
3. Add a story for the `debug-bundle` mint + signed-token fetch, and add it to the public-surfaces security sweep as an "expected to require a token" case.
4. Fold `browser-runs`, `transcribe`, `usage/rank`, `vercel/repo-projects`, and `workflows/catalog` into their nearest existing topics as short stories.
5. Compute method-level coverage before treating this catalog as a completeness claim.
6. Write the fixture/seed script for the five fault states in item 7, then the execution order above becomes runnable end to end.
7. Treat the redundancy tables as an inventory only. The two highest-value consolidations by duplicated-code weight are the runtime-profile CRUD twins (schemas literally duplicated across two files) and the five status/liveness surfaces for background-agent runs.
