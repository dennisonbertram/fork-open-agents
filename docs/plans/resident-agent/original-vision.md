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

## The framing stories (added 2026-08-11)

From a follow-up conversation, kept near-verbatim (lightly cleaned from a
voice transcript). These are the canonical demos the product must make true.

**The backlog fan-out:**

> "I'm an agent. I'm working with you, for example, and we have a skill that
> says for you to work with my Claude agents. I say, 'Hey, I have a backlog
> of issues. Can you go through them?' You would go through each issue, check
> it, then use the MCP server to call this [durable-object] sandbox. You'd
> say, 'Hey agent in the cloud, work on this and create a PR for it.' You'd
> go through all the tasks and then I could close my computer. In the cloud,
> those agents would have been tasked to work through the backlog, and they
> would start working on it."

**Any agent, any device:**

> "Maybe I'm on my phone with ChatGPT and I can say, 'Hey, what's the status
> of my PRs? What's the status of these issues?' It would reach out to my
> same backend and be able to tell me the status. Maybe something would be
> stuck. I'd be using Codex on a different device and I could say, 'Hey
> Codex, just go ahead and check in and fix those issues.' Codex goes in,
> takes a look, applies its knowledge and information to it as well, and then
> it gets fixed."

**The product framing:**

> "I've been framing it like a coding harness for your coding harness — a
> coding harness for your agent. The agent is almost like representing the
> human, because normally the human would go between all the different
> platforms and manually do it. Instead, now I'm just talking to the agent,
> and the agent is going between the platforms and doing it."

What this adds to the shape: **the client of the product is the owner's
agent, not the owner.** The human talks to whichever agent is at hand —
Claude Code at a desk, ChatGPT on a phone, Codex on another machine — and
that agent represents the human against the service. Three product
consequences, recorded as stories 19–24 in [stories.md](stories.md):
fan-out tasking (one command creates many workers), an account-level status
surface any client can query cheaply, and client packaging (skills,
connectors, config) as part of the product rather than an afterthought.
