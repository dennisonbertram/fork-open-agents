# Loop Templates — make loops intuitive to start

**Problem (from the UX walk):** creating a loop starts at a blank JSON textarea or an empty
builder canvas where adding a node drops a disconnected orphan that instantly errors. There's no
on-ramp. **Fix:** ship a small set of *starter templates* that match how loops are actually used,
and let "New loop" start from one — so the user begins with a working, connected graph and just
edits the instructions.

The mental model a template should teach: **a loop is steps + a condition that branches
true/false + (optionally) a loop-back edge**, fired by a trigger.

## The execution model (ground truth, from `apps/web/lib/agent-loops/`)

- Node kinds: `start`, `agent_step`, `github_check`, `condition`, `end`.
- `agent_step`: `instructions` (the prompt), optional `checkCommand`, optional `outputSchema`.
  The agent writes JSON to `/tmp/loop-step-output.json`; it's stored as `context[nodeId]`.
- `github_check`: `list_issues` | `pr_status` | `ci_status` | `deployment_status`.
- `condition`: `{ path, op, value }` reading a dot-path from context (`op`: eq/neq/gt/gte/lt/lte/exists/contains).
- Edge `when`: `success`/`failure`/`always` (normal); `true`/`false` (from a condition).
- Guardrails (`maxIterations`, default 10) bound any loop-back cycle.
- Triggers (cron / GitHub PR / webhook) are attached separately (today via background-agents).

Validity rules templates must satisfy: exactly one `start`, ≥1 reachable `end`, every non-end node
has ≥1 outgoing edge, each `condition` has both a `true` and a `false` edge.

---

## Template 1 — "Review to issues" (linear · trigger-driven)
> Review the code → list issues → file them to GitHub. Run every 20 min or on a new PR.

```jsonc
{
  "nodes": [
    { "id": "start",  "kind": "start",      "label": "Start",          "position": { "x": 0,   "y": 0 } },
    { "id": "review", "kind": "agent_step", "label": "Review code",    "position": { "x": 240, "y": 0 },
      "instructions": "Review the repository for bugs, risks, and missing tests. Write {\"issues\":[{\"title\":\"\",\"body\":\"\"}]} to /tmp/loop-step-output.json." },
    { "id": "file",   "kind": "agent_step", "label": "File issues",    "position": { "x": 480, "y": 0 },
      "instructions": "For each item in context.review.issues, run `gh issue create --title ... --body ...`. Write {\"filed\": <count>} to output." },
    { "id": "end",    "kind": "end",        "label": "Done",           "position": { "x": 720, "y": 0 } }
  ],
  "edges": [
    { "id": "e1", "source": "start",  "target": "review", "when": "always"  },
    { "id": "e2", "source": "review", "target": "file",   "when": "success" },
    { "id": "e3", "source": "file",   "target": "end",    "when": "success" }
  ]
}
```
Suggested trigger: `schedule.cron` (every 20 min) and/or `github.pull_request`.

---

## Template 2 — "Backlog → PR" (branch + loop-back cycle)
> Take an issue → implement → review → if it fails, fix and review again; if it passes, open a PR.

```jsonc
{
  "nodes": [
    { "id": "start",     "kind": "start",      "label": "Start",        "position": { "x": 0,    "y": 0 } },
    { "id": "pick",      "kind": "agent_step", "label": "Pick issue",   "position": { "x": 220,  "y": 0 },
      "instructions": "Take the top open issue off the backlog (`gh issue list`). Write {\"issue\": <number>, \"title\": \"\"} to output." },
    { "id": "implement", "kind": "agent_step", "label": "Implement",    "position": { "x": 440,  "y": 0 },
      "instructions": "Implement context.pick.issue on a feature branch. Write {\"branch\":\"\"} to output." },
    { "id": "review",    "kind": "agent_step", "label": "Review",       "position": { "x": 660,  "y": 0 },
      "instructions": "Review the diff for correctness, tests, and scope. Write {\"passed\": true|false, \"notes\":\"\"} to output." },
    { "id": "gate",      "kind": "condition",  "label": "Passed?",      "position": { "x": 880,  "y": 0 },
      "condition": { "path": "review.passed", "op": "eq", "value": true } },
    { "id": "fix",       "kind": "agent_step", "label": "Fix issues",   "position": { "x": 660,  "y": 180 },
      "instructions": "Address context.review.notes on the same branch. Write {\"fixed\": true} to output." },
    { "id": "pr",        "kind": "agent_step", "label": "Open PR",      "position": { "x": 1100, "y": 0 },
      "instructions": "Open a PR from the working branch with a summary (`gh pr create`). Write {\"pr\": <number>} to output." },
    { "id": "end",       "kind": "end",        "label": "Done",         "position": { "x": 1320, "y": 0 } }
  ],
  "edges": [
    { "id": "e1", "source": "start",     "target": "pick",      "when": "always"  },
    { "id": "e2", "source": "pick",      "target": "implement", "when": "success" },
    { "id": "e3", "source": "implement", "target": "review",    "when": "success" },
    { "id": "e4", "source": "review",    "target": "gate",      "when": "success" },
    { "id": "e5", "source": "gate",      "target": "pr",        "when": "true"    },
    { "id": "e6", "source": "gate",      "target": "fix",       "when": "false"   },
    { "id": "e7", "source": "fix",       "target": "review",    "when": "success" },
    { "id": "e8", "source": "pr",        "target": "end",       "when": "success" }
  ]
}
```
The cycle `review → gate → fix → review` is bounded by `maxIterations`. Edge `e6` (false → fix)
is the loop-back; `e5` (true → pr) is the exit.

---

## Template 3 — "Email triage" (nested branches)
> Check inbox → new email? → is it a feature request? → file it.

```jsonc
{
  "nodes": [
    { "id": "start",    "kind": "start",      "label": "Start",            "position": { "x": 0,   "y": 0 } },
    { "id": "check",    "kind": "agent_step", "label": "Check inbox",      "position": { "x": 220, "y": 0 },
      "instructions": "Check the inbox for unread mail (Gmail tool). Write {\"hasNew\": true|false, \"latest\": {\"subject\":\"\",\"body\":\"\"}} to output." },
    { "id": "hasNew",   "kind": "condition",  "label": "New email?",       "position": { "x": 440, "y": 0 },
      "condition": { "path": "check.hasNew", "op": "eq", "value": true } },
    { "id": "classify", "kind": "agent_step", "label": "Feature request?", "position": { "x": 660, "y": 0 },
      "instructions": "Read context.check.latest. Write {\"isFeatureRequest\": true|false} to output." },
    { "id": "isFeat",   "kind": "condition",  "label": "Is feature?",      "position": { "x": 880, "y": 0 },
      "condition": { "path": "classify.isFeatureRequest", "op": "eq", "value": true } },
    { "id": "file",     "kind": "agent_step", "label": "File request",     "position": { "x": 1100, "y": 0 },
      "instructions": "Open a feature-request issue from context.check.latest (`gh issue create`). Write {\"filed\": true} to output." },
    { "id": "end",      "kind": "end",        "label": "Done",             "position": { "x": 1320, "y": 0 } }
  ],
  "edges": [
    { "id": "e1", "source": "start",    "target": "check",    "when": "always"  },
    { "id": "e2", "source": "check",    "target": "hasNew",   "when": "success" },
    { "id": "e3", "source": "hasNew",   "target": "classify", "when": "true"    },
    { "id": "e4", "source": "hasNew",   "target": "end",      "when": "false"   },
    { "id": "e5", "source": "classify", "target": "isFeat",   "when": "success" },
    { "id": "e6", "source": "isFeat",   "target": "file",     "when": "true"    },
    { "id": "e7", "source": "isFeat",   "target": "end",      "when": "false"   },
    { "id": "e8", "source": "file",     "target": "end",      "when": "success" }
  ]
}
```
**Feasibility caveat:** "check inbox" needs the agent to have an email tool (Composio Gmail)
connected. The graph is valid regardless; the email capability is the dependency to confirm.

---

## Bonus (uses `github_check`) — "Merge when green"
> Wait for CI on a PR → if green, merge; if not, stop. A good template to teach the `github_check`
node. `github_check ci_status` → `condition (state eq success)` → true → merge agent_step → end.

---

## Proposed delivery

1. **Data:** a `loop-templates.ts` module exporting `{ slug, name, description, suggestedTrigger?, definition }[]`
   (the graphs above), validated by the existing `validateLoopDefinition` in a unit test so templates
   can never ship invalid.
2. **Entry point:** on `/loops/new`, lead with a **"Start from a template"** gallery (cards: name +
   one-liner + tiny graph preview) plus "Blank loop" and "Advanced (JSON)". Picking a template creates
   the loop and drops the user into the **builder** with a working, connected graph — which also
   sidesteps the orphan-node/connect-gesture problem because you start from something that runs.
3. **Scope note:** this is additive and low-risk; it doesn't change the engine, only the create on-ramp
   and a static template set.
