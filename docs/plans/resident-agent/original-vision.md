# Original Vision

Captured 2026-08-11 from a voice transcript of the product conversation that
started this package. Kept close to the source so later decisions can be
checked against the original intent.

## The starting point

The author was evaluating Vercel's Open Agents template and noticed it
separates the agent from the sandbox — the agent runs as a durable workflow
and connects to a sandbox via tools, enabling hibernation and resume.

First instinct: expose that sandbox layer as the product over MCP, so any
agent can attach. Durable workspaces with a small operation set — attach,
run, inspect, checkpoint, resume — with ChatGPT, Claude Code, Codex, and
future agents as clients.

## The rejection of "sandbox as a service"

In the author's words:

> "I don't want all of my different agents to directly connect to the
> sandbox, because then that means that all of these agents have to have full
> context of everything that's happened. Then it becomes very difficult for
> Claude to connect to that sandbox and then ChatGPT to connect to that
> sandbox — they'll both have context on their end that won't be in the
> sandbox, isn't transferable."

A bare cloud sandbox holds the *files* but not the *narrative*. Every
visiting agent would re-ingest the full diff/history, and the product
degrades into commodity infrastructure.

## The actual idea: the resident worker

> "The MCP server allows my agent, my Claude, my ChatGPT, whatever, to
> connect to the agent in the Vercel Open Agents — and that agent has control
> of the sandbox. So I basically have my agent task that agent, and then talk
> to that agent. That agent is the one that understands the task that it's
> working on and what it's done. So then I can have another agent connect to
> it, and it doesn't have to understand the full diff. It could look at the
> diff if it wants, but it actually can just talk to the agent that owns that
> sandbox to understand what's happened."

The unit of the product is a **resident worker agent per task**:

- One long-lived worker owns a task and its sandbox.
- External agents connect to the *worker* over MCP — task it, ask it what
  happened, delegate to it.
- The worker is the context holder; visiting agents are stateless.
- Analogy from the conversation: a project has an owner, and newcomers ask
  the owner for state rather than reading every commit.

## The structured-memory amendment

Raised in the same conversation and accepted as core: the worker's memory
must not live only in its model context window. It continuously materializes
state into structured artifacts — plans, decision logs, task graphs — so the
project survives swapping the worker's underlying model. Without this,
replacing the model lobotomizes the project.

Resulting shape: **resident maintainer + structured memory + visiting
specialists.**

## Clarifications from later discussion

- **Agent-neutral, not infrastructure-neutral** (2026-08-11): the product
  does not need to be portable across cloud platforms — building on Vercel or
  Cloudflare infra is fine. What must be neutral is the *client*: "I can use
  Codex, it can use Claude, I can use Devin — any agent anywhere, and they
  all access my same account with my sandboxes."
- **The canonical flow** the author pictures: an agent on the desktop calls
  the service over MCP, talks to a worker, says "hey, do this." The worker
  has GitHub tools (clone a repo into its sandbox), takes its instructions,
  works, answers follow-up questions, and is inspectable.
- **Brain-pluggability** emerged as a second neutrality axis: the coding
  agent *inside* the sandbox (Pi, Claude Code, future tools) is also
  interchangeable. The durable thing is the worker's identity, memory, and
  workspace — brains and clients both churn.
