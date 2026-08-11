# Stories — Resident Agent Service

Scope lock for what we are building, expressed as stories. Derived from
[original-vision.md](original-vision.md) and the architecture discussion;
validated by the [spike](spike-plan.md) before any build commitment. Stories
marked **[spike]** are proven or disproven by the spike, not assumed.

Personas:

- **Owner** — the human who owns the account, the repos, and the workers.
- **Visitor** — an external agent (Claude Code, Codex, Devin, ChatGPT, future
  agents) connecting over MCP as an OAuth client.
- **Worker** — a resident agent, one per task, owning a sandbox and its
  memory.
- **Brain** — the pluggable coding agent inside the worker's sandbox.

## Client connection

1. As a Visitor, I can discover the service's MCP endpoint and register
   myself as an OAuth client without human setup, so that any conforming
   agent can attach to the Owner's account. **[spike: M4]**
2. As the Owner, I can see which clients are connected and revoke any of
   them, so that access to my workers stays under my control.
3. As a Visitor, my access is scoped — I can only see and task the workers
   the Owner's grants allow.

## Tasking a worker

4. As a Visitor, I can create a worker for a task — a repo plus instructions
   — so that work begins without me managing any infrastructure. **[spike:
   M1, M2]**
5. As a Worker, I clone the repo into my sandbox through my own GitHub tools,
   so that credentials never enter the sandbox or reach the Brain. **[spike:
   M2 — network-layer token injection]**
6. As a Worker, I decompose the instructions into a plan and record it as a
   structured artifact before and while I work, so that my reasoning is
   inspectable and survives me.
7. As a Worker, I delegate open-ended coding to my Brain and verify the
   result myself — run the tests, read the diff — before I report anything
   done, so that no self-report is ever trusted.

## Talking to the owner

8. As a Visitor, I can ask a worker what has happened so far and get the
   owner's account — current plan, key decisions, blockers — rather than a
   raw transcript, so that I stay at story altitude. **[spike: M3, M4]**
9. As a Visitor, I can cheaply read a worker's structured state (plan,
   decision log, task graph) without waking a model at all, so that routine
   inspection is fast and near-free.
10. As a Visitor, I can inspect the worker's workspace — diff, files, test
    results — when I want ground truth instead of narrative.

## Durability

11. As the Owner, idle workers hibernate and cost ~nothing, and wake with
    their full context when addressed — even days later. **[spike: M1, M3 —
    wake and restore latency are the product-feel numbers]**
12. As the Owner, I can swap a worker's model — or its Brain — without losing
    the project, because memory lives in structured artifacts, not in a
    context window. **[spike: M5 — the anti-lobotomy test]**
13. As a Worker, my workspace survives sandbox sleep, because persistence is
    choreographed (backup/restore), not assumed. **[spike: M3]**

## Delegation (the recursion)

14. As a Worker, I can task another worker through the same MCP surface
    Visitors use, so that sub-tasks get their own resident owners. (Post-MVP;
    the SDK supports it natively.)
15. As the Owner, every worker — however deep in a delegation tree — is
    visible in my registry with its status and spend.

## Operations

16. As the Owner, I can list, stop, and destroy workers, and audit what each
    one did — including every externally visible action (push, PR, comment).
17. As the Owner, externally visible actions are gated by grants per worker,
    so a worker can only push where I've allowed.
18. As the Owner, I can see cost per worker and per task, measured from real
    usage. **[spike: M5]**

## Explicit non-stories (out of scope)

- No human-facing web UI in v1 — the MCP surface is the product. (A minimal
  Owner dashboard for stories 2, 15–18 is the first UI candidate.)
- No multi-tenant teams or orgs — one Owner per account.
- No billing/subscription mechanics.
- No guarantee of Brain interchangeability beyond one proven Brain at launch
  — story 12's Brain-swap half is a fast-follow, not day one.
- No sandbox portability across clouds — the platform is chosen (Vercel fork
  or Cloudflare), and that choice is allowed to be permanent.
