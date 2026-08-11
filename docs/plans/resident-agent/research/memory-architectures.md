# Survey: Agent Memory & Context Architectures for a Durable, Addressable Worker

Research date: 2026-08-11. All sources fetched live on 2026-08-11 unless noted.

## TL;DR

No surveyed system relies on worker self-report alone as ground truth. Every
mature design either (a) treats a mechanically-derived log as truth and layers
narrative on top without deleting the log (OpenHands' condenser, Anthropic's
own "git log + progress file" harness pattern), or (b) makes the derived
structure itself the primary interface and treats prose as a byproduct (beads'
task graph, LangGraph's `Store`). The two systems that lean hardest on
self-authored memory (Letta memory blocks, Claude Code auto-memory) both ship
with an explicit warning or companion mechanism that narrative can go stale or
be wrong, and both are scoped/sized to stay small and disposable rather than
authoritative. This is the strongest cross-system signal for the "who writes
memory" question: **derived state as ground truth, worker narrative as a
regenerable interpretation layer is not a novel idea — it is what the two most
directly relevant precedents (OpenHands, Anthropic's own long-running-agent
pattern) already do.**

The planned substrate (Durable Object + embedded SQLite with FTS5) is
confirmed current: Cloudflare's SQLite-backed Durable Objects support FTS5,
JSON, and point-in-time recovery to any point in the last 30 days, accessed
via `ctx.storage.sql` (fetched 2026-08-11).

## Status / maturity snapshot (dated)

| System | Maturity signal | Date |
|---|---|---|
| Letta / MemGPT | Sleep-time compute shipped in Letta 0.7.0; MemGPT 2.0 paper (arXiv 2504.13171) | Paper Apr 21 2025; exact current Letta version as of Aug 2026 not confirmed (UNVERIFIED) |
| Claude memory tool | `memory_20250818` tool type, **generally available, no beta header required** per current docs | Fetched 2026-08-11 |
| Claude API compaction | GA, server-side, documented as pairing with memory tool | Fetched 2026-08-11 |
| Claude Code CLAUDE.md / auto-memory | Auto-memory "on by default"; doc references CLI versions up to v2.1.217 | Fetched 2026-08-11 |
| Claude Agent SDK sessions | `resume`/`continue`, automatic compaction, CLAUDE.md re-injected post-`/compact` | Fetched 2026-08-11 |
| Cognition "Don't Build Multi-Agents" | Original position | ~Jun 2025 (per third-party dating) |
| Cognition "Multi-Agents: What's Actually Working" | Revised position, narrower multi-agent pattern endorsed | ~Apr 2026 (per fetched content: "ten months ago... today") |
| Devin Knowledge | Documented product feature, auto Repo Knowledge scanning | Docs current as fetched 2026-08-11 |
| OpenHands condenser | Documented SDK architecture (`software-agent-sdk`) | Fetched 2026-08-11; arXiv SDK paper 2511.03690 |
| OpenHands microagents/skills | Migrating from `.openhands/microagents/` to `.agents/skills/` | Fetched 2026-08-11 |
| beads (Steve Yegge) | v1.0.1 released, storage migrated exclusively to Dolt, repo moved `steveyegge/beads` → `gastownhall/beads` | Release ~2026-04-15 per DoltHub blog dated 2026-04-15 |
| LangGraph checkpoint/store | Stable library APIs (`langgraph-checkpoint`, `BaseStore`/`InMemoryStore`) | Docs fetched via ctx7, 2026-08-11 |
| Vercel Workflow DevKit | Public beta → GA-track durable execution primitive (`"use workflow"`/`"use step"`) | vercel.com/docs/workflows, fetched 2026-08-11 |
| Cloudflare Durable Objects SQLite | GA, FTS5 + JSON extensions, PITR 30 days | developers.cloudflare.com, fetched 2026-08-11 |

---

## 1. Letta (MemGPT lineage)

**Memory blocks.** A block has a `label` (e.g. `human`, `persona`, `knowledge`),
a `value` (string content), a size limit (chars/tokens) that caps its context
footprint, and a description that guides usage. Blocks can be read-only
(developer-controlled) or agent-editable. [Letta docs — Agent memory guide;
letta.com/blog/memory-blocks]

**Core vs. out-of-context memory.** Blocks *attached* to an agent are
"in-context" (pinned into the system prompt); unattached blocks persist in the
DB but are not injected until attached. All state — memories, messages,
reasoning, tool calls — persists in a database, "so they are never lost, even
once evicted from the context window." [docs.letta.com/guides/agents/memory]

**Self-editing.** The agent modifies its own memory via tool calls (e.g. a
`memory_replace`-style tool on the human block) inside its own reasoning loop
— there is no external retrieval pipeline deciding what to write; the model
decides. [docs.letta.com; community walkthrough corroborates but is
secondary]

**Sleep-time compute.** A *separate* sleep-time agent reprocesses context
during idle periods and asynchronously updates shared memory blocks —
described as turning "raw context" into "learned context." This decouples
memory maintenance from the latency of the live conversation. Shipped as part
of MemGPT 2.0 / Letta 0.7.0, paper published 2025-04-21 (arXiv:2504.13171).
[letta.com/blog/sleep-time-compute]

**Multi-agent block sharing.** Blocks can be shared across multiple agents
(e.g., a background agent updates memory that a primary agent later reads),
supporting shared-knowledge-base patterns. [letta.com/blog/memory-blocks]

UNVERIFIED: exact current Letta version/feature set as of August 2026; the
docs fetched did not carry a version banner and I did not find an official
2026 changelog entry to pin against.

---

## 2. Anthropic: memory tool, Claude Code memory, Agent SDK sessions, context engineering

### Claude API memory tool (`memory_20250818`)

Now **generally available on the Messages API — no beta header required**
(this is a change from its original "beta" framing; treat any assumption that
it still requires a beta flag as stale). It is available on all Claude 4+
models. [platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool,
fetched 2026-08-11]

Mechanics:
- Client-side tool: Claude *requests* file operations against a `/memories`
  prefix; the calling application executes them against its own storage
  (filesystem, DB, cloud storage). Anthropic never sees or stores the actual
  memory content beyond the tool_use/tool_result exchange.
- Commands: `view` (dir listing or file content, with `view_range`, 2-levels
  deep listing, hides dotfiles/`node_modules`), `create` (create/overwrite),
  `str_replace` (replace text; errors on non-unique or missing match),
  `insert` (insert after line N), `delete` (recursive on dirs; cannot delete
  `/memories` root), `rename` (cannot rename `/memories` root).
- The API auto-injects a system-prompt instruction telling Claude to always
  view its memory directory first and to assume the context window may be
  reset at any time ("ASSUME INTERRUPTION").
- Security is entirely the caller's job: path traversal protection (reject
  `../`, canonicalize paths, reject anything resolving outside `/memories`) is
  documented as mandatory, not automatic.
- Explicitly designed to pair with **compaction**: "context editing clears
  specific tool results on the client. Compaction automatically summarizes the
  whole conversation on the server... For long-running agents, consider using
  both: compaction keeps the active context small ... and memory preserves the
  information that must survive summarization."
- Documents a **"multisession software development pattern"**: an
  initializer session sets up a progress log + feature checklist + reference
  to a startup script *before* substantive work begins; every subsequent
  session reads those files first; sessions update the progress log before
  ending; a feature is marked complete only after end-to-end verification, not
  when code is written. This is a close conceptual cousin of the worker's
  "anti-lobotomy" requirement, published by the same vendor.

### "Effective harnesses for long-running agents" (companion blog, cited from the memory-tool doc)

A concrete case study of the multisession pattern, independent of the memory
tool: an **initializer agent** produces `init.sh`, `claude-progress.txt`, and
an initial git history; a **`feature_list.json`** with 200+ entries
(`"passes": false` initially) that later sessions may only flip to `true`,
never edit/remove; each new session's onboarding sequence is: check working
dir → read `claude-progress.txt` → run `git log --oneline -20` → read feature
requirements → run `init.sh` to validate current state → then start work.
**Git itself is treated as the recovery/ground-truth substrate** — reverting
broken changes, and giving "clear project history visible across context
windows... eliminating guesswork about previous session states." This
pattern **does not use the memory tool** — continuity comes from inspecting
artifacts (structured JSON + prose log + git log) at session start, not from a
persistent memory store. [anthropic.com/engineering/effective-harnesses-for-long-running-agents]

### "Effective context engineering for AI agents"

Frames context as "a precious, finite resource"; names three long-horizon
strategies: **compaction** (summarize-then-restart, tuned for
recall-vs-precision), **structured note-taking / memory** (persist notes
outside the context window, retrieve on demand — the memory tool is offered
as an implementation of this), and **sub-agent architectures** (specialized
agents return condensed 1,000–2,000 token summaries to a coordinator, keeping
detailed search context isolated in the sub-agent). No single strategy is
declared universally correct; choice is framed as task-shape-dependent.
[anthropic.com/engineering/effective-context-engineering-for-ai-agents]

### Claude Code: CLAUDE.md vs. auto-memory (official docs, fetched 2026-08-11, code.claude.com/docs/en/memory)

Two **complementary**, explicitly distinguished systems:

| | CLAUDE.md | Auto memory |
|---|---|---|
| Who writes it | Human | Claude itself |
| Contents | Instructions/rules | "Learnings and patterns" |
| Scope | Project/user/org (git-hierarchy-resolved, 4 precedence tiers incl. managed-policy) | Per git repository, **shared across worktrees**, machine-local |
| Loaded into | Every session, in full | Every session, **only the first 200 lines or 25KB** of `MEMORY.md`; topic files load on demand |

Key structural facts:
- Auto-memory directory: `~/.claude/projects/<project>/memory/`, with a
  `MEMORY.md` index plus topic files (e.g. `debugging.md`). "Claude decides
  what's worth remembering" — it does **not** save every session.
  Auto-memory is **on by default**.
- If `MEMORY.md` exceeds the 200-line/25KB budget, the write still succeeds
  but Claude Code returns an error telling Claude to rewrite the index,
  because "everything past the limit is dropped on the next load" — i.e. the
  system enforces its own compaction discipline on the self-authored index.
- After `/compact`, project-root `CLAUDE.md` is explicitly **re-read from
  disk and re-injected**; nested CLAUDE.md files and path-scoped rules are
  **not** automatically re-injected — they only reload when a matching file
  is next touched. This is a concrete, documented compaction-survival
  asymmetry worth carrying into worker design (what "always survives" vs.
  what "reloads on access").
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`; the documented
  interop path is an `@AGENTS.md` import or symlink.
- CAVEAT: several third-party 2026 blog posts (e.g. thepromptshelf.dev,
  vectorize.io) describe a "consolidation pipeline built on Anthropic's
  Dreams primitive." **This "Dreams primitive" terminology does not appear
  in the official code.claude.com/docs/en/memory page fetched for this
  research.** Mark as UNVERIFIED / possibly a third-party label for an
  internal mechanism, not confirmed vendor terminology.

### Claude Agent SDK sessions

`resume` continues a specific tracked `session_id` with full history restored
(tool results, reasoning, analyses); `continue` picks up the most recent
session in the working directory. Automatic compaction summarizes older
messages as the context limit approaches; `getSessionMessages` returns the
**post-compaction** chain while the underlying session store retains raw
history. [Multiple secondary sources cross-referencing
platform.claude.com/docs/en/agent-sdk/sessions; I did not independently
re-fetch the primary agent-sdk/sessions page today — treat session-API
specifics as medium-confidence, cross-corroborated by 3+ independent
write-ups rather than a single primary fetch.]

---

## 3. Cognition / Devin

### "Don't Build Multi-Agents" (Walden Yan; cognition.com/blog/dont-build-multi-agents, fetched 2026-08-11)

Core claims:
- **Actions carry implicit decisions; conflicting decisions carry bad
  results.** Illustrated with a Flappy Bird example: one subagent builds a
  Super-Mario-style background while a sibling subagent independently builds
  an incompatible bird sprite — neither had visibility into the other's
  choice.
- Two stated principles: (1) *"Share context, and share full agent traces,
  not just individual messages"* — every component needs the complete
  decision history, not isolated instructions; (2) unstated assumptions
  embedded in one agent's output compound when other agents build on it
  without seeing the reasoning behind it.
- Devin's answer at the time: a **single-threaded linear agent** maintaining
  continuous context, with a context-compression model that summarizes
  history into key decisions/events as the window fills, plus narrowly
  constrained subagents that only answer well-scoped sub-questions (compared
  explicitly to Claude Code's subagent pattern) rather than doing parallel
  writes.

### "Multi-Agents: What's Actually Working" (cognition.com/blog/multi-agents-working, fetched 2026-08-11)

Position **evolved**, dated by the fetched text as "ten months" after the
original post (original ~mid/late-2025 by this framing → follow-up ~Apr
2026). The narrow class that now works: **"multiple agents contribute
intelligence to a task while writes stay single-threaded."** One agent
performs actual code writes; supporting agents (reviewer, planner, verifier)
contribute analysis but never write concurrently. Reviewer/verifier agents
deliberately get a **clean/fresh context** rather than inheriting the
writer's context, which the post frames as improving review quality via "the
math of attention." This is a meaningfully different claim from the original
post's "don't share write access, don't fragment decisions" — it narrows
rather than reverses the original argument.

### Devin Knowledge (docs.devin.ai/product-guides/knowledge, fetched 2026-08-11)

- A knowledge item = a **trigger description** (when to recall it) + a
  **prompt** (the content injected when recalled), optionally with a short
  macro identifier for direct reference.
- Retrieval is **contextual, not eager**: "retrieves Knowledge when relevant,
  not all at once or all at the beginning" — matched against trigger
  descriptions during the session.
- Scoping: unbound (contextual only), pinned to one repo (always applied in
  that repo), or global (all repos).
- **Repo Knowledge is auto-generated**: "Devin will now automatically scan
  your repositories and generate Repo Knowledge" — this is a *derived*
  channel distinct from manually authored Knowledge, and is the clearest
  "derived from workspace" precedent in the Devin product surface (as
  opposed to the worker-authored Knowledge items).
- Best-practice guidance: keep Knowledge entries small/focused ("split up
  your Knowledge into smaller ones") and pair with Playbooks for recurring
  task procedures.

UNVERIFIED: the concrete mechanism by which reviewer/planner agents in the
"what's actually working" pattern receive "full agent traces" (exact format,
size, or whether it's a raw transcript vs. a structured summary) — the
fetched post describes the outcome/principle, not the wire format.

---

## 4. OpenHands

**Event stream as backbone.** State lives in an **append-only event log**.
Memory compression (the condenser), microagent/skill knowledge injection,
sub-agent delegation, security review, and stuck-detection are described as
"auxiliary services hanging off the event stream" — i.e., the event stream is
the single source of truth and everything else is a consumer/annotator of it.
[docs.openhands.dev/sdk/arch/condenser; dev.to deep-dive, corroborating]

**Condensation, not truncation.** When triggered, the condenser produces a
`Condensation` event containing `forgotten_event_ids` (events to hide),
`summary` (LLM-generated compressed text), and `summary_offset` (where the
summary is inserted). Critically, **the original events are never deleted
from the log** — a `View.from_events()` call filters forgotten events and
splices in the summary only for the *view* handed to the LLM. This is
explicitly the "derived ground truth (event log) + narrative interpretation
(summary), narrative never overwrites truth" pattern.

**Triggering.** Automatic (event count exceeds a configured threshold) or
manual (a `CondensationRequest` event, typically issued after a hard context
error). A `RollingCondenser` implementation keeps the first N and last M
events verbatim and only summarizes the middle span — deliberately preserving
head (setup/goal) and tail (recent state) fidelity. Complexity is explicitly
framed against a baseline: "condensed approach scales linearly" vs. quadratic
for uncompressed context growth over time. [docs.openhands.dev/sdk/arch/condenser]

**Microagents / skills.** Markdown files with YAML frontmatter
(`trigger_type: always | keyword | manual`, optional `keywords` list) that
inject domain/repo-specific knowledge when triggered. Directory convention is
migrating: legacy `.openhands/microagents/` and `.openhands/skills/` remain
supported, but **`.agents/skills/` is now the preferred location** for new
work — a cross-tool convention shift worth tracking since it affects where a
"read without waking a model" scan would look. [docs.openhands.dev/overview/skills;
GitHub OpenHands/docs AGENTS.md]

---

## 5. beads (Steve Yegge) — issue graph as agent memory

Repository moved: **`steveyegge/beads` → `gastownhall/beads`**. Current
release **v1.0.1** (DoltHub guest post dated 2026-04-15 discusses it as
current).

**Storage evolution (important, and a real drift/compat risk in its own
right).** Original design combined **SQLite + a git-tracked JSONL export**
for cross-machine sync. As of v1.0/v1.0.1 the backend is **exclusively
Dolt** (a SQL database with git-like branch/merge/diff/push/pull semantics at
the row level). JSONL is now only an optional disaster-recovery export, not
the primary sync mechanism, and — notably — **issues are no longer stored in
the git repo by default** in the new mode. The DoltHub post explicitly notes
this migration "has not been without friction for existing Beads users."
[dolthub.com/blog/2026-04-15-common-beads-workflows; github.com/gastownhall/beads
README]

**Schema shape (as described, not independently inspected as raw SQL).**
Issues carry a type, priority (P0–P3), status, hierarchical IDs (e.g.
`bd-a3f8` for an epic, `bd-a3f8.1` for a child task). Dependency edges are
typed: **`blocks`** (hard dependency), **`parent-child`** (hierarchy),
**`relates-to`** (soft link), **`supersedes`** (replacement). This forms a
"computational graph rather than a flat list."

**Agent interaction surface.** CLI (`bd`) commands include `bd ready` (list
currently unblocked/claimable work — computed from the dependency graph, not
authored), `bd create`, `bd update --claim` (atomic ownership), `bd dep add`,
and `bd remember` (write a persistent memory note). An MCP server is also
provided for MCP-native clients. `bd ready` is the clearest "cheap, derived,
structural read" analog in this survey: no model needs to run to compute
"what's unblocked" — it's a graph query.

**Explicit problem framing.** Yegge names the target failure mode the "50
First Dates problem" — an agent that loses all memory between sessions and
re-derives (or contradicts) prior plans every time. beads' pitch is that a
structured, queryable task graph survives context resets in a way a markdown
TODO list does not, because "ready work" and "blocked work" are graph
properties, not prose an agent has to re-parse and re-interpret correctly
each time.

UNVERIFIED: exact current SQL DDL (table/column names) — no primary schema
file was fetched; the description above is a synthesis of the project's own
README/FAQ-level documentation, not a raw schema dump.

---

## 6. Git/docs-as-memory conventions (ADRs, AGENTS.md, plan.md)

- **AGENTS.md** is increasingly framed by commentators as a spiritual
  successor to Architecture Decision Records for agent-facing repos: a
  single, tool-agnostic, in-repo file multiple coding agents (Claude Code,
  Cursor, Copilot, Devin, Windsurf, Cline) can converge on. Claude Code's own
  docs confirm this convergence pragmatically: it doesn't read `AGENTS.md`
  natively but documents `@AGENTS.md` import / symlink as the supported
  interop path, and `/init` (with `CLAUDE_CODE_NEW_INIT=1`) explicitly reads
  `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
  `.devin/rules/`, `.windsurf/rules/`, `.clinerules` when bootstrapping.
  [code.claude.com/docs/en/memory]
- **Drift risk, named directly in commentary**: "context alone does not
  prevent architectural drift... an agent that produces plausible, working
  code at speed will produce plausible, working, inconsistent code just as
  fast unless something holds it to the recorded decisions." Multiple 2026
  write-ups converge on the same failure mode: a markdown decision record is
  read but not *enforced*, and nothing detects when the record and the
  codebase have diverged. [ai.gopubby.com; mnemehq.com; catio.tech — all
  community/vendor-blog tier, convergent but not independently verified
  against a controlled study]
- **This repository's own convention is a live example of the pattern being
  surveyed**: `CLAUDE.md` at the repo root is explicitly a "routing
  document" that links out to `docs/agents/`, `docs/process/`, and
  `docs/plans/` rather than embedding detail, plus a per-project
  `docs/agents/lessons-learned.md` file described as a "living document."
  This is git-committed, human-and-agent-editable, prose-first memory with
  no automated staleness check other than human review — i.e., exactly the
  "worker-written self-report, can drift from workspace truth" risk profile
  the product brief is trying to avoid for the resident worker.

---

## 7. Framework checkpointing: LangGraph vs. Vercel ecosystem

### LangGraph (ctx7 `/langchain-ai/langgraph`, fetched 2026-08-11)

Two **distinctly named, differently scoped** persistence primitives — a
useful vocabulary split for this design:

1. **Checkpointer** (`langgraph-checkpoint`, with SQLite/Postgres/Redis
   backends) — **per-thread**, short-term. "Checkpointers save graph state at
   every superstep, enabling human-in-the-loop, memory between interactions,
   and durable execution." A checkpoint record includes a schema version
   (`v`), timestamp (`ts`), id, `channel_values` (the actual state), plus
   `channel_versions`/`versions_seen` for conflict/staleness bookkeeping. A
   `thread_id` is mandatory; an optional `checkpoint_id` resumes from a
   specific point in that thread's history — this is a form of point-in-time
   recovery.
2. **Store** (`BaseStore`/`InMemoryStore`) — **cross-thread**, long-term.
   Explicitly separate from checkpoints: "Stores provide long-term memory
   that persists across threads and conversations." Key-value under
   hierarchical namespace tuples (e.g. `("memories", user_id)`), with
   optional TTL and optional vector-embedding-backed semantic search
   (`store.search(namespace, query=...)`). This is architecturally the
   closest precedent to a "durable fact store keyed by topic" independent of
   any single conversation/thread — i.e., closer to what the worker's
   decision log / plan store should look like than the checkpointer is.

### Vercel ecosystem

No single "AI SDK memory" abstraction equivalent to LangGraph's
Store/Checkpointer pair was found. Two separate, narrower primitives exist:

- **AI SDK UI `useChat`**: messages live in **React component state only**
  by default; a page reload wipes them. Persistence is DIY (write to a DB
  after each exchange, rehydrate via the `messages` prop). Stream
  *resumption* (surviving a reload mid-stream) requires wiring Redis
  yourself and is documented as **single-device, Next.js-coupled**. [multiple
  2026 blog sources cross-referencing ai-sdk.dev docs; I did not
  independently re-fetch ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams
  today]
- **Workflow DevKit** (`@vercel/workflows`, `"use workflow"` / `"use step"`):
  a **durable-execution** primitive, not a memory/knowledge store. Each
  successful step is checkpointed so a workflow "can resume from the last
  successfully completed step rather than restarting from the beginning";
  completed steps are memoized and never re-executed. [vercel.com/docs/workflows;
  vercel.com/blog/introducing-workflow — official, fetched 2026-08-11]

**Expectation gap worth flagging**: it would be easy for an LLM (or a
developer) to assume "Vercel's workflow checkpoints" are a drop-in analog to
"LangGraph's Store." They solve different problems — Workflow DevKit
checkpoints are about **surviving process restarts mid-execution**
(execution-level durability), not about **giving a future session/agent a
queryable record of what happened and why** (knowledge-level durability). The
worker's design needs the second; nothing in the Vercel ecosystem as
currently documented provides it out of the box.

---

## 8. Event-sourcing vs. snapshot state; compaction; staleness/drift detection

**OpenHands is a live, shipping example of event-sourced agent memory**: see
§4 above — append-only events, `Condensation` events as derived
summaries/pointers, never mutating the underlying log. This is the strongest,
most directly-verifiable precedent in this survey (not just an argument in a
blog post, but a documented, running architecture).

**The general argument for event sourcing over mutable state** (community
synthesis, arXiv preprint and blog, both dated April 2026 — **treat as
argued position, not established consensus**): mutable "dictionary state"
architectures lose the causal chain — you can see the state before and after
a decision, but not *what the agent believed when it made the decision*.
Event sourcing preserves that trail; a "projection" (computed read-model) is
what the agent actually operates on turn to turn; periodic **snapshots** are
required because unbounded event replay becomes computationally and
token-expensive as history grows. Acknowledged tradeoffs: unbounded log
growth requires checkpointing discipline, event ordering is ambiguous across
concurrent multi-agent writers, schema evolution requires versioned event
adapters, and compliance regimes (GDPR) complicate an immutable log
containing PII. [tianpan.co/blog/2026-04-10-agent-state-event-stream-immutable-event-sourcing
— single-author blog, cite as one perspective, not verified against a
production case study]

**Compaction strategy taxonomy observed across systems surveyed:**
- *Summarize-and-restart* (Claude API server-side compaction; OpenHands
  automatic condensation past a threshold): whole/partial history collapsed
  into an LLM-generated summary; original detail is either discarded
  (Claude compaction, per docs) or retained-but-hidden (OpenHands, per
  `Condensation.forgotten_event_ids` design).
- *Structured extraction into named slots* (Letta memory blocks; Claude
  memory tool files; LangGraph `Store` namespaced key-values): the model (or
  the app) writes discrete, labeled facts instead of a single blob;
  individual facts can be updated/deleted without touching the rest.
- *Head/tail preservation with middle compression* (OpenHands
  `RollingCondenser`): keep first-N and last-M events verbatim, compress only
  the middle — a deliberate bias toward preserving goal-setting context and
  recent state over historical middle detail.

**Staleness/drift detection — this is the weakest-evidenced area of the
survey.** No system surveyed ships a general-purpose "is my memory stale
relative to the workspace" detector as a first-class, documented feature.
The closest concrete mechanisms found:
- Anthropic's multisession harness pattern **manually** cross-checks the
  prose progress log against `git log` at the start of every session — this
  is drift *mitigation by cheap habitual verification*, not automated drift
  *detection*.
- Cloudflare Durable Objects' SQLite **point-in-time recovery** (bookmarks,
  restorable to any point in the last 30 days, `getCurrentBookmark()` /
  `getBookmarkForTime()`) is a rollback safety net for the storage substrate
  itself, not a semantic staleness check between memory and workspace
  content. [developers.cloudflare.com/durable-objects/api/sqlite-storage-api/,
  fetched 2026-08-11]
- A cited definition from an arXiv preprint: "staleness is defined as the
  number of prior sessions not yet persisted to the memory store at query
  time; a system is fresh when staleness is zero" — this is a narrow,
  mechanical definition (has the write happened yet) and does **not** address
  the harder case this brief cares about (has the workspace changed in a way
  the narrative no longer reflects, even though the write "happened").
  UNVERIFIED beyond the preprint abstract; not corroborated by a shipping
  system in this survey.

**Confirmed substrate facts (Cloudflare Durable Objects + embedded SQLite,
directly relevant to the planned substrate):**
- Accessed via `ctx.storage.sql`, standard SQL through `.exec()`.
- **FTS5 module supported**, plus JSON extension and math functions.
- Storage operations are atomic/isolated; `transactionSync()`/`transaction()`
  available; each method call is implicitly wrapped in a transaction.
- Point-in-time recovery to any point in the past 30 days via lexically
  comparable "bookmark" strings.
- Exact capacity/row-size limits were not itemized in the fetched page (it
  deferred to a separate limits page I did not fetch) — UNVERIFIED numeric
  ceiling.

---

## Design options for the resident worker

*(All of this section is labeled PROPOSED. Nothing here is a fabricated
feature of a surveyed system — each option cites the precedent it borrows
from.)*

### (a) Candidate SQLite schema shapes — options, not a final design

**Option 1 — LangGraph-style split: per-run checkpoint + cross-run store.**
PROPOSED, grounded in §7.
```
checkpoints(id, run_id, ts, channel_values JSON, channel_versions JSON, parent_id)
store_items(namespace TEXT, key TEXT, value JSON, created_at, updated_at, ttl,
            PRIMARY KEY (namespace, key))
```
`checkpoints` gives cheap "resume exactly where the last run left off";
`store_items` (namespaced, e.g. `("decisions",)`, `("plan",)`) gives cheap
cross-session facts independent of any one run. Weakness: LangGraph's own
`Store` is a flat key-value bag — it does not natively express a *graph* of
task dependencies, so this option alone under-serves the "task graph"
requirement.

**Option 2 — beads-style relational task graph.** PROPOSED, grounded in §5.
```
issues(id, type, title, status, priority, description, created_at, updated_at)
issue_deps(from_id, to_id, dep_type CHECK(dep_type IN
           ('blocks','parent-child','relates-to','supersedes')))
```
"Ready work" becomes a plain SQL query (issues with no open `blocks` incoming
edge and status != done) — no model invocation required, matching beads'
`bd ready`. Strongest option for the "task graph" half of the requirement;
weakest for "decision log" (a typed issue graph is not naturally a
chronological rationale trail) and for "plan narrative."

**Option 3 — OpenHands-style append-only event/decision log + condensation
view.** PROPOSED, grounded in §4 and §8.
```
events(id INTEGER PRIMARY KEY, ts, actor, event_type, payload JSON)
condensations(id, forgotten_event_ids JSON, summary TEXT, summary_offset,
              created_at)
```
An FTS5 virtual table (`CREATE VIRTUAL TABLE events_fts USING fts5(payload,
content=events)`) gives cheap keyword search over the raw history — directly
usable given the confirmed FTS5 availability in Durable Objects SQLite (§8).
This is the natural home for a **decision log**: each decision is an event;
nothing is ever deleted; a `Condensation` row is a *derived, regenerable*
narrative pointer over a range of events, never a replacement for them.

**Option 4 — memory-tool-style "files in a table."** PROPOSED, grounded in
§2. A single table `memory_files(path TEXT PRIMARY KEY, content TEXT,
updated_at)` simulating the `/memories` filesystem, edited via
view/create/str_replace/insert/delete semantics mirrored from Anthropic's
tool. Cheapest to implement and gives the worker a familiar, self-editable
plan.md-equivalent, but on its own it is unstructured prose again — the
exact drift risk the product brief is trying to design away from. Best used
as a *thin veneer* over Options 2/3, not as the sole store.

**Recommended shape (still PROPOSED, not final):** combine Option 2 (task
graph, structural ground truth) + Option 3 (event/decision log, chronological
ground truth, FTS5-searchable) as the two authoritative tables, with Option 4
retained narrowly as the worker's own scratch "plan.md"-equivalent — a
self-editable, explicitly-labeled-as-interpretive file, not a source of
truth for status. Option 1's checkpoint table is worth keeping *underneath*
all of this purely for run-level resume/replay, separate from the
knowledge-level tables above (mirrors the Vercel Workflow DevKit vs.
LangGraph Store distinction drawn in §7 — execution durability and knowledge
durability are different concerns and conflating them was flagged as a
concrete expectation-gap risk).

### (b) Who writes memory — evaluating the three options against the evidence

1. **Worker self-report only.** Precedents: Letta memory blocks (§1), Claude
   Code auto-memory (§2), Devin manually-authored Knowledge (§3). All three
   are real, shipping, and valuable — but every one of them is bounded and
   supplemented rather than trusted alone: Letta caps block size and
   separates it from archival storage; Claude Code enforces a hard 200-line/
   25KB budget on the self-authored index and errors if exceeded; Anthropic's
   *own* recommended long-running-agent pattern (§2, "effective harnesses")
   pairs the prose progress log with a mandatory `git log` check at the start
   of every session — i.e. even Anthropic does not trust self-report alone
   for exactly the kind of "resume across a context/model reset" scenario
   this worker needs to survive. **Evidence weight: this option is
   well-precedented for the "rich narrative" job but consistently
   *not* precedented as a standalone ground-truth mechanism.**

2. **Derived/indexed from workspace only.** Precedents: beads' `bd ready`
   (§5, pure graph query, no model judgment), Devin's automatic Repo
   Knowledge scan (§3, distinct from manually-taught Knowledge), LangGraph
   checkpoints (§7, written deterministically by the framework at each
   superstep, not by model choice about "what's worth keeping"). Strongest
   for truthfulness and for the "cheap read without a model" requirement,
   because a mechanical derivation needs no model call to produce or trust.
   Weakest for *why* — a dependency graph or an event log tells you *what*
   happened, not the reasoning that connected one decision to the next
   unless every event explicitly encodes rationale as a field (which raises
   the burden on the writer to be disciplined even in a "derived" system —
   derivation only helps if the thing being derived from already contains
   the rationale).

3. **Both, derived as ground truth + narrative as interpretation.**
   Precedent: this is not hypothetical — it is **exactly** OpenHands'
   shipping condenser design (§4/§8): the event log is truth, the
   `Condensation.summary` is a regenerable, model-written interpretation
   that never overwrites or deletes the log it summarizes. It is also the
   *de facto* pattern in Anthropic's own long-running-agent harness (§2):
   `git log` (mechanical, derived) is the ground truth an agent is told to
   consult, and `claude-progress.txt` (self-authored) is the interpretive
   layer read alongside it, not instead of it. Cognition's narrowed
   multi-agent position (§3, "writes stay single-threaded, other agents
   contribute intelligence") is a related but distinct pattern at the
   *coordination* layer rather than the *memory* layer — worth naming as a
   partial, not full, precedent for option 3.

**Recommendation (labeled as recommendation, not settled by the survey
alone): Option 3.** It is the only option with a shipping, verifiable
precedent (OpenHands) at exactly the granularity this worker needs
(event/decision log = ground truth; narrative = derived, regenerable, never
authoritative), and it is reinforced by Anthropic's own operational practice
for the closest analogous problem (resuming a long-running coding agent
across sessions/context resets). The task-graph half (Option 2 above) should
also be treated as ground truth (it's structurally derived the same way
`bd ready` is — a query over typed rows, not a model's opinion), leaving the
worker's free-text plan/self-report as the *only* tier that is explicitly
narrative-not-truth.

### (c) The cheap-read surface: MCP resources vs. tools

Per the MCP spec (§ fetched 2026-08-11, modelcontextprotocol.io): **resources
are read-only, application-driven** data exposed via `resources/list` /
`resources/read`, discoverable and readable without any model-invocation
step baked into the protocol itself — a client can call `resources/read`
purely mechanically. **Tools are model-controlled**: the protocol's intended
usage pattern is that the model decides when to call them, though nothing in
the protocol prevents a client calling a tool directly.

PROPOSED mapping for the worker:
- Expose the task graph, decision log (and its FTS5 index), and current plan
  file each as **MCP resources** with stable URIs (e.g.
  `worker://<id>/tasks`, `worker://<id>/decisions?since=<event_id>`,
  `worker://<id>/plan`), backed directly by SQL reads against the Durable
  Object's embedded SQLite. A visiting agent — or even a plain script using
  an MCP client library — reads these with zero model invocations. Use
  resource `annotations` (`audience`, `priority`, `lastModified` — all part
  of the spec, §7 fetch) so a visiting agent's UI/picker can rank "decision
  log" above "raw event dump" without guessing.
- Reserve **MCP tools** for the one capability that genuinely requires
  waking the worker's model: "what happened so far, at story altitude" —
  because narrative synthesis at the right altitude is exactly the job a
  model does and a SQL query does not. This cleanly separates "cheap
  structured truth" (resources, no model) from "expensive narrated
  interpretation" (tool call, wakes the worker's own model) — which is the
  same split the survey found baked into OpenHands' events-vs-summary
  design and LangGraph's checkpoint-vs-store split, just expressed at the
  MCP transport layer instead of the storage layer.
- Optional support for `resources/subscribe` (also spec-native) would let a
  visiting agent get push notifications on task-graph or decision-log
  changes without polling — worth flagging as a nice-to-have, not required
  for the MVP cheap-read surface.

### (d) Designing the anti-lobotomy (model-swap) test so it actually proves memory sufficiency

The risk with a naive test ("swap the model, ask it to continue, see if it
does something reasonable") is that a capable new model can *appear* to
succeed by re-exploring the workspace from scratch (reading all the code,
inferring intent) rather than by actually using the memory substrate — which
would prove the model is good, not that the memory design is sufficient.
PROPOSED test structure, grounded in precedents above:

1. **Isolate the memory channel.** Run two variants of the same
   swap-and-continue task: (i) *memory-only* — the new model may query the
   MCP resources (task graph, decision log, plan) but is explicitly denied
   read access to the sandbox git history/working tree until it has produced
   a first "what happened so far" narrative and a first next-action; (ii)
   *memory+workspace* — the realistic condition, where it can also inspect
   the repo, mirroring Anthropic's own harness pattern (§2) which
   deliberately combines both (`git log` + progress file). Compare (i) vs
   (ii): if (i) is dramatically worse, the memory design is under-specified
   relative to what the workspace alone reveals — a concrete, measurable
   drift signal.
2. **Score against named, borrowed failure modes, not vibes:**
   - *"50 First Dates" test* (naming borrowed from beads, §5): does the new
     model redo already-completed work, or contradict a decision already
     recorded in the decision log? This is directly checkable — diff the new
     model's first N tool calls / plan edits against the existing task
     graph and decision log for duplicated or contradicted entries.
   - *Trace sufficiency test* (borrowed from Cognition's "share full agent
     traces, not just individual messages," §3): does the decision log
     contain enough of the *rationale*, not just the outcome, for the new
     model to avoid re-litigating a settled tradeoff? Concretely: seed the
     decision log with at least one recorded decision that has a
     non-obvious rationale, and check whether the swapped model's narrative
     and next actions respect it or silently overturn it.
   - *Time-to-productive-action*: how many tool calls/resource reads does
     the new model need before its first real (non-exploratory) action,
     compared to a baseline session that never lost context? Anthropic's
     own multisession pattern (§2) is implicitly optimizing exactly this
     metric — a well-designed progress artifact should make session N+1
     productive almost immediately.
3. **Test both read paths from (c).** Confirm the cheap resource reads alone
   (no model wake) are sufficient for a *scripted* harness to answer "is
   this worker stuck / what's the task graph state" — and separately confirm
   the tool-based narrative path produces a story-altitude summary a human
   would find sufficient. These are different proofs and should not be
   conflated into one pass/fail.
4. **Repeat across at least two swap points per task** (not just once at the
   end) — a single swap can pass by luck; the "anti-lobotomy" claim is about
   the design being robust to swaps happening *anywhere*, which is closer to
   how OpenHands' condenser is exercised continuously rather than once.

---

## Open questions

- Exact current Letta version/feature set as of August 2026 (UNVERIFIED —
  no primary source with a 2026 date found; only the April 2025 sleep-time
  compute paper and undated docs).
- Whether "Dreams primitive" is genuine internal Anthropic terminology for
  Claude Code's auto-memory consolidation, or a third-party blog's invented
  label — not present in the official code.claude.com/docs/en/memory page
  fetched for this research.
- Exact wire format / token budget of "full agent traces" shared between
  Devin's writer and reviewer/planner agents in the newer multi-agent
  pattern (§3) — the blog post states the principle, not the format.
- Raw beads SQL schema (table/column names) — not independently fetched;
  current description is a synthesis of project documentation, not a schema
  dump.
- Whether the AI SDK ecosystem has *any* first-party analog to LangGraph's
  `Store` (cross-thread semantic memory) beyond DIY database wiring — none
  found as of this survey; possible that a newer 2026 package fills this gap
  and simply wasn't surfaced by the queries run.
- No system surveyed has a general, automated "memory vs. workspace drift"
  detector as a shipping feature (§8) — this is a genuine gap in prior art,
  not just a gap in this research. The design options in (d) above propose a
  *test* for the symptom (a swapped model acting on stale memory) but the
  survey found no precedent for a *runtime detector* that would catch drift
  proactively, before a swap/wake even happens.
- Concrete row/size limits for Cloudflare Durable Objects SQLite storage
  were not itemized in the page fetched (deferred to a separate limits page
  not fetched in this pass).

---

## Sources

- Letta docs — Agent memory guide. `docs.letta.com/guides/agents/memory`. Official. Accessed 2026-08-11.
- Letta blog — Sleep-time compute. `letta.com/blog/sleep-time-compute`. Vendor-blog. Accessed 2026-08-11.
- Letta blog — Memory Blocks: The Key to Agentic Context Management. `letta.com/blog/memory-blocks/`. Vendor-blog. Accessed 2026-08-11.
- MemGPT 2.0 / sleep-time compute paper, arXiv:2504.13171. Third-party (academic). Accessed 2026-08-11 (via search synthesis, not directly fetched).
- Anthropic — Memory tool docs. `platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool` (redirected from docs.claude.com). Official. Accessed 2026-08-11.
- Anthropic — Effective context engineering for AI agents. `anthropic.com/engineering/effective-context-engineering-for-ai-agents`. Official (vendor engineering blog). Accessed 2026-08-11.
- Anthropic — Effective harnesses for long-running agents. `anthropic.com/engineering/effective-harnesses-for-long-running-agents`. Official (vendor engineering blog). Accessed 2026-08-11.
- Claude Code — How Claude remembers your project. `code.claude.com/docs/en/memory`. Official. Accessed 2026-08-11.
- Third-party blogs on Claude Code memory ("Dreams primitive" claim, MEMORY.md structure corroboration): thepromptshelf.dev, vectorize.io, ianlpaterson.com. Community/vendor-adjacent. Accessed 2026-08-11 via search snippets — flagged where used because "Dreams primitive" is unconfirmed against the official page.
- Claude Agent SDK sessions (secondary corroboration; primary page not independently re-fetched this session): `platform.claude.com/docs/en/agent-sdk/sessions`, cross-referenced via heyclau.de, claudecertificationguide.com, ksred.com. Mixed official/community. Accessed 2026-08-11.
- Cognition — Don't Build Multi-Agents. `cognition.com/blog/dont-build-multi-agents`. Official (vendor blog). Accessed 2026-08-11.
- Cognition — Multi-Agents: What's Actually Working. `cognition.com/blog/multi-agents-working`. Official (vendor blog). Accessed 2026-08-11.
- Devin docs — Knowledge. `docs.devin.ai/product-guides/knowledge`. Official. Accessed 2026-08-11.
- OpenHands docs — Condenser architecture. `docs.openhands.dev/sdk/arch/condenser`. Official. Accessed 2026-08-11.
- OpenHands docs/GitHub — Skills overview and microagents directory migration. `docs.openhands.dev/overview/skills`; `github.com/OpenHands/docs/blob/main/AGENTS.md`. Official/vendor repo. Accessed 2026-08-11.
- OpenHands Software Agent SDK paper, arXiv:2511.03690. Third-party (academic, vendor-authored). Accessed 2026-08-11 via search synthesis.
- beads — GitHub repository (README). `github.com/steveyegge/beads` and `github.com/gastownhall/beads`. Official (project repo). Accessed 2026-08-11. Note: FAQ.md fetch returned 404; not independently verified.
- DoltHub blog — Common Beads Classic Workflows. `dolthub.com/blog/2026-04-15-common-beads-workflows/`. Vendor-blog (Dolt/DoltHub, storage partner, not Yegge). Dated 2026-04-15. Accessed 2026-08-11.
- Steve Yegge — "Gas Town: from Clown Show to v1.0" (Medium), dated 2026-04-03. Vendor/author blog. Accessed 2026-08-11 via search snippet, not independently fetched in full.
- LangGraph docs (checkpoint, store, base classes) via ctx7 `/langchain-ai/langgraph`. Official (source repo README/docstrings). Accessed 2026-08-11.
- Vercel — Workflows docs. `vercel.com/docs/workflows`. Official. Accessed 2026-08-11 (via search synthesis of official page content).
- Vercel blog — Introducing Workflow Development Kit. `vercel.com/blog/introducing-workflow`. Official (vendor blog). Accessed 2026-08-11.
- AI SDK UI — Chatbot Resume Streams (not independently re-fetched; relied on secondary summaries). `ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams`. Official page, community-summarized. Accessed 2026-08-11.
- Model Context Protocol spec — Resources. `modelcontextprotocol.io/specification/2025-06-18/server/resources`. Official (spec). Accessed 2026-08-11.
- Model Context Protocol spec/community explainers on tools-vs-resources control model. `modelcontextprotocol.io/specification/2025-06-18/server/tools`; Zuplo, Microsoft Community Hub, philschmid.de. Mixed official/community. Accessed 2026-08-11.
- Cloudflare Durable Objects — SQLite Storage API. `developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`. Official. Accessed 2026-08-11.
- tianpan.co blog — "Agent State as Event Stream: Why Immutable Event Sourcing Beats Internal Agent Memory," dated 2026-04-10. Community/independent blog, single-author argument, not a verified production case study. Accessed 2026-08-11.
- ai.gopubby.com, mnemehq.com, catio.tech — ADR/AGENTS.md drift commentary. Community/vendor-blog tier, convergent framing but not independently verified. Accessed 2026-08-11.
